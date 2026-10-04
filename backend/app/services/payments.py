"""Stripe Checkout helpers — create/confirm/expire sessions and mark registrations paid.

Aligned with Stripe hosted Checkout fulfillment guidance:
https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Payment, PaymentStatus, Registration, Team, TeamPlayer, Tournament


def expire_checkout_session(session_id: str | None) -> None:
    """Best-effort expire of an open Stripe Checkout session after leave/re-checkout."""
    if not session_id:
        return
    settings = get_settings()
    if not settings.stripe_secret_key:
        return
    try:
        import stripe

        stripe.api_key = settings.stripe_secret_key
        stripe.checkout.Session.expire(session_id)
    except Exception:
        # Already expired/paid/complete — ignore
        pass


def _payment_intent_id(session: Any) -> str | None:
    pi = getattr(session, "payment_intent", None)
    if isinstance(pi, str) and pi:
        return pi
    if pi is not None and getattr(pi, "id", None):
        return str(pi.id)
    return None


def _session_is_paid(session: Any) -> bool:
    """Hosted Checkout: fulfill when funds are confirmed (or no payment required)."""
    status = getattr(session, "payment_status", None)
    return status in ("paid", "no_payment_required")


def mark_registration_paid(
    db: Session,
    reg: Registration,
    *,
    stripe_payment_id: str | None = None,
    stripe_session_id: str | None = None,
) -> Registration:
    """Idempotently mark a PENDING registration as PAID. Safe under concurrent webhook + redirect."""
    if reg.status == PaymentStatus.PAID.value:
        return reg

    if reg.status != PaymentStatus.PENDING.value:
        raise HTTPException(
            400,
            "This registration was cancelled or is no longer awaiting payment. "
            "Contact the organiser if you were charged.",
        )

    # Lock tournament row to reduce last-spot double-pay races (Postgres)
    t = (
        db.query(Tournament)
        .filter(Tournament.id == reg.tournament_id)
        .with_for_update()
        .first()
    )
    team = db.get(Team, reg.team_id)
    if not team or team.withdrawn:
        raise HTTPException(
            400,
            "This entry was withdrawn. Contact the organiser if you were charged.",
        )

    if t and t.max_teams:
        paid_count = (
            db.query(Registration)
            .join(Team, Team.id == Registration.team_id)
            .filter(
                Registration.tournament_id == reg.tournament_id,
                Registration.status == PaymentStatus.PAID.value,
                Team.withdrawn.is_(False),
            )
            .count()
        )
        if paid_count >= t.max_teams:
            raise HTTPException(
                400,
                "This event is full — payment cannot be completed. Contact the organiser for a refund if you were charged.",
            )

    player_ids = [
        row[0]
        for row in db.query(TeamPlayer.user_id).filter(TeamPlayer.team_id == reg.team_id).all()
    ]
    if player_ids:
        conflict = (
            db.query(TeamPlayer)
            .join(Team, Team.id == TeamPlayer.team_id)
            .join(Registration, Registration.team_id == Team.id)
            .filter(
                Team.tournament_id == reg.tournament_id,
                Team.withdrawn.is_(False),
                TeamPlayer.user_id.in_(player_ids),
                Registration.status.in_(
                    [PaymentStatus.PAID.value, PaymentStatus.PENDING.value]
                ),
                Registration.id != reg.id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(
                400,
                "A player on this entry is already entered on another team for this tournament.",
            )

    reg.status = PaymentStatus.PAID.value
    reg.paid_at = datetime.now(timezone.utc)
    if stripe_session_id:
        reg.stripe_session_id = stripe_session_id
    if stripe_payment_id:
        reg.stripe_payment_intent_id = stripe_payment_id

    already_logged = (
        db.query(Payment)
        .filter(
            Payment.registration_id == reg.id,
            Payment.status == PaymentStatus.PAID.value,
        )
        .first()
    )
    if not already_logged:
        db.add(
            Payment(
                registration_id=reg.id,
                tournament_id=reg.tournament_id,
                amount_cents=reg.amount_cents,
                currency=reg.currency,
                status=PaymentStatus.PAID.value,
                stripe_payment_id=stripe_payment_id or stripe_session_id or "paid",
            )
        )
    return reg


def _resolve_registration_for_session(db: Session, session: Any) -> Registration | None:
    reg_id = (getattr(session, "metadata", None) or {}).get("registration_id")
    if not reg_id and isinstance(session, dict):
        reg_id = (session.get("metadata") or {}).get("registration_id")
    reg: Registration | None = None
    if reg_id:
        try:
            reg = db.get(Registration, UUID(str(reg_id)))
        except (ValueError, TypeError):
            reg = None
    session_id = getattr(session, "id", None) or (session.get("id") if isinstance(session, dict) else None)
    if not reg and session_id:
        reg = db.query(Registration).filter(Registration.stripe_session_id == session_id).first()
    return reg


def _assert_session_matches_registration(session: Any, reg: Registration) -> None:
    """Reject mismatched amount/currency so a wrong session can't fulfill an entry."""
    amount_total = getattr(session, "amount_total", None)
    currency = getattr(session, "currency", None)
    if amount_total is not None and int(amount_total) != int(reg.amount_cents):
        raise HTTPException(400, "Paid amount does not match this registration")
    if currency and str(currency).lower() != str(reg.currency or "").lower():
        raise HTTPException(400, "Paid currency does not match this registration")


def fulfill_checkout_session(db: Session, session_id: str) -> Registration | None:
    """Fulfill a Checkout Session (webhook + success-page). Idempotent.

    Retrieves the session from Stripe, checks payment_status, then marks the
    linked registration paid. Returns None if not paid yet / unknown session.
    """
    settings = get_settings()
    if not settings.stripe_secret_key:
        # Demo / no Stripe
        return db.query(Registration).filter(Registration.stripe_session_id == session_id).first()

    import stripe

    stripe.api_key = settings.stripe_secret_key
    try:
        session: Any = stripe.checkout.Session.retrieve(session_id)
    except Exception as exc:
        raise HTTPException(400, f"Could not verify Stripe session: {exc}") from exc

    if not _session_is_paid(session):
        return None

    reg = _resolve_registration_for_session(db, session)
    if not reg:
        return None

    # If already paid, still verify this session is the one on file (idempotent OK)
    if reg.status == PaymentStatus.PAID.value:
        return reg

    _assert_session_matches_registration(session, reg)

    mark_registration_paid(
        db,
        reg,
        stripe_payment_id=_payment_intent_id(session),
        stripe_session_id=session_id,
    )
    db.commit()
    db.refresh(reg)
    return reg


# Back-compat alias used by routes
def confirm_stripe_session(db: Session, session_id: str) -> Registration | None:
    return fulfill_checkout_session(db, session_id)


def create_checkout_session(
    *,
    tournament_name: str,
    team_name: str,
    amount_cents: int,
    currency: str,
    success_url: str,
    cancel_url: str,
    registration_id: UUID,
    tournament_id: UUID,
    customer_email: str | None = None,
    previous_session_id: str | None = None,
) -> Any:
    """Create a hosted Checkout Session; expires any prior open session for this entry."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise RuntimeError("Stripe is not configured")

    import stripe

    stripe.api_key = settings.stripe_secret_key

    # Prevent double-charge if the player retries checkout while an old session is still open
    if previous_session_id:
        expire_checkout_session(previous_session_id)

    params: dict[str, Any] = {
        "mode": "payment",
        "line_items": [
            {
                "price_data": {
                    "currency": currency.lower(),
                    "product_data": {"name": f"{tournament_name} - {team_name}"},
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }
        ],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(registration_id),
        "metadata": {
            "registration_id": str(registration_id),
            "tournament_id": str(tournament_id),
        },
    }
    if customer_email:
        params["customer_email"] = customer_email.strip().lower()

    # Fresh UUID per attempt — extracted as a request option by the Stripe SDK
    params["idempotency_key"] = str(uuid4())
    return stripe.checkout.Session.create(**params)
