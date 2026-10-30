"""Stripe Checkout helpers - create/confirm/expire sessions and mark registrations paid.

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


def platform_service_fee_cents() -> int:
    """Fixed platform fee (cents) added to Stripe Checkout when entry fee > 0."""
    return max(0, int(get_settings().service_fee_cents or 0))


def stripe_checkout_total_cents(entry_fee_cents: int) -> int:
    """Total charged via Stripe = entry fee + platform service fee (when entry > 0)."""
    entry = max(0, int(entry_fee_cents or 0))
    if entry <= 0:
        return 0
    return entry + platform_service_fee_cents()


def entry_revenue_cents(amount_cents: int, *, stripe_session_id: str | None = None) -> int:
    """Organiser revenue excludes the platform service fee on Stripe charges."""
    amount = max(0, int(amount_cents or 0))
    session = (stripe_session_id or "").strip()
    if session.startswith("cs_"):
        return max(0, amount - platform_service_fee_cents())
    return amount


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
        # Already expired/paid/complete - ignore
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
                "This event is full - payment cannot be completed. Contact the organiser for a refund if you were charged.",
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


def _as_mapping(value: Any) -> dict[str, Any]:
    """Normalize Stripe metadata / webhook payloads to a plain dict.

    stripe-python returns StripeObject for Session.metadata - it is mapping-like
    but must not be treated as a dict (``.get`` raises AttributeError).
    """
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        try:
            converted = to_dict()
            if isinstance(converted, dict):
                return converted
        except Exception:
            pass
    try:
        return dict(value)
    except Exception:
        pass
    out: dict[str, Any] = {}
    for key in ("registration_id", "tournament_id"):
        try:
            item = value[key]
        except Exception:
            continue
        if item is not None:
            out[key] = item
    return out


def _session_field(session: Any, key: str) -> Any:
    if isinstance(session, dict):
        return session.get(key)
    return getattr(session, key, None)


def _resolve_registration_for_session(db: Session, session: Any) -> Registration | None:
    meta = _as_mapping(_session_field(session, "metadata"))
    reg_id = meta.get("registration_id") or _session_field(session, "client_reference_id")
    reg: Registration | None = None
    if reg_id:
        try:
            reg = db.get(Registration, UUID(str(reg_id)))
        except (ValueError, TypeError):
            reg = None
    session_id = _session_field(session, "id")
    if not reg and session_id:
        reg = db.query(Registration).filter(Registration.stripe_session_id == session_id).first()
    return reg


def _assert_session_matches_registration(session: Any, reg: Registration) -> None:
    """Reject mismatched amount/currency so a wrong session can't fulfill an entry.

    Trust the session when (a) its id is already bound on the registration, or
    (b) Checkout metadata/client_reference_id points at this registration — the
    latter covers the race where the webhook arrives before we finish committing
    ``stripe_session_id``. Sync amount/currency from Stripe so a later fee edit
    cannot block fulfillment after the player has paid.
    """
    session_id = _session_field(session, "id")
    bound = bool(
        session_id
        and reg.stripe_session_id
        and str(session_id) == str(reg.stripe_session_id)
    )
    meta = _as_mapping(_session_field(session, "metadata"))
    meta_reg = meta.get("registration_id") or _session_field(session, "client_reference_id")
    metadata_match = bool(meta_reg and str(meta_reg) == str(reg.id))
    amount_total = _session_field(session, "amount_total")
    currency = _session_field(session, "currency")
    if bound or metadata_match:
        if amount_total is not None:
            reg.amount_cents = int(amount_total)
        if currency:
            reg.currency = str(currency).upper()
        return
    if amount_total is not None and int(amount_total) != int(reg.amount_cents):
        raise HTTPException(400, "Paid amount does not match this registration")
    if currency and str(currency).lower() != str(reg.currency or "").lower():
        raise HTTPException(400, "Paid currency does not match this registration")


def fulfill_checkout_session(db: Session, session_id: str) -> Registration | None:
    """Fulfill a Checkout Session (webhook + success-page). Idempotent.

    Retrieves the session from Stripe, checks payment_status, then marks the
    linked registration paid. Returns None if not paid yet / unknown session.
    """
    import logging

    logger = logging.getLogger(__name__)
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
        logger.info("Stripe session %s not paid yet (status=%s)", session_id, _session_field(session, "payment_status"))
        return None

    reg = _resolve_registration_for_session(db, session)
    if not reg:
        logger.error(
            "Stripe session %s is paid but no registration matched (metadata/client_reference_id/session_id)",
            session_id,
        )
        return None

    team = db.get(Team, reg.team_id)
    if team and team.withdrawn:
        raise HTTPException(
            400,
            "This entry was withdrawn. Contact the organiser for a refund if you were charged.",
        )

    _assert_session_matches_registration(session, reg)
    pi = _payment_intent_id(session)

    # Already confirmed pay-on-arrival - upgrade metadata when they pay online later
    if reg.status == PaymentStatus.PAID.value:
        via = (reg.stripe_payment_intent_id or "").strip().lower()
        if via == "pay_on_arrival":
            reg.stripe_session_id = session_id
            if pi:
                reg.stripe_payment_intent_id = pi
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
                        stripe_payment_id=pi or session_id or "paid",
                    )
                )
            else:
                # Replace sentinel pay_on_arrival id with the real Stripe payment
                already_logged.stripe_payment_id = pi or session_id or already_logged.stripe_payment_id
            db.commit()
            db.refresh(reg)
        return reg

    mark_registration_paid(
        db,
        reg,
        stripe_payment_id=pi,
        stripe_session_id=session_id,
    )
    db.commit()
    db.refresh(reg)
    from app.services.reminders import maybe_remind_team_after_paid

    maybe_remind_team_after_paid(db, reg.tournament_id, reg.team_id)
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
    service_fee_cents: int | None = None,
) -> Any:
    """Create a hosted Checkout Session; expires any prior open session for this entry.

    ``amount_cents`` is the tournament entry fee. When ``service_fee_cents`` (or the
    platform default) is > 0, Checkout shows a second line item so players see
    e.g. €15 entry + €1.50 service fee.
    """
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise RuntimeError("Stripe is not configured")

    import stripe

    stripe.api_key = settings.stripe_secret_key

    # Prevent double-charge if the player retries checkout while an old session is still open
    if previous_session_id:
        expire_checkout_session(previous_session_id)

    entry = max(0, int(amount_cents or 0))
    fee = platform_service_fee_cents() if service_fee_cents is None else max(0, int(service_fee_cents))
    if entry <= 0:
        fee = 0

    line_items: list[dict[str, Any]] = [
        {
            "price_data": {
                "currency": currency.lower(),
                "product_data": {"name": f"{tournament_name} - {team_name}"},
                "unit_amount": entry,
            },
            "quantity": 1,
        }
    ]
    if fee > 0:
        line_items.append(
            {
                "price_data": {
                    "currency": currency.lower(),
                    "product_data": {
                        "name": "Service fee",
                        "description": "Platform processing fee",
                    },
                    "unit_amount": fee,
                },
                "quantity": 1,
            }
        )

    params: dict[str, Any] = {
        "mode": "payment",
        "line_items": line_items,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(registration_id),
        "metadata": {
            "registration_id": str(registration_id),
            "tournament_id": str(tournament_id),
            "entry_fee_cents": str(entry),
            "service_fee_cents": str(fee),
        },
    }
    if customer_email:
        params["customer_email"] = customer_email.strip().lower()

    # Fresh UUID per attempt - extracted as a request option by the Stripe SDK
    params["idempotency_key"] = str(uuid4())
    return stripe.checkout.Session.create(**params)
