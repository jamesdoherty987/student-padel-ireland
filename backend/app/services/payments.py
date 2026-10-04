"""Payment helpers - Stripe Checkout confirm + webhook marking."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Payment, PaymentStatus, Registration, Team, TeamPlayer, Tournament


def expire_checkout_session(session_id: str | None) -> None:
    """Best-effort expire of an open Stripe Checkout session after leave/cancel."""
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
        # Session may already be expired/paid — ignore
        pass


def mark_registration_paid(
    db: Session,
    reg: Registration,
    *,
    stripe_payment_id: str | None = None,
    stripe_session_id: str | None = None,
) -> Registration:
    if reg.status == PaymentStatus.PAID.value:
        return reg

    if reg.status != PaymentStatus.PENDING.value:
        raise HTTPException(
            400,
            "This registration was cancelled or is no longer awaiting payment. "
            "Contact the organiser if you were charged.",
        )

    # Lock tournament row to reduce last-spot double-pay races
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
        # This registration is still PENDING, so it is not in paid_count yet
        if paid_count >= t.max_teams:
            raise HTTPException(
                400,
                "This event is full — payment cannot be completed. Contact the organiser for a refund if you were charged.",
            )

    # Prevent the same player ending up on two active teams (paid or pending)
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


def confirm_stripe_session(db: Session, session_id: str) -> Registration | None:
    """Verify a Checkout Session with Stripe and mark the registration paid."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        # Demo / no Stripe - look up by session id if stored
        return db.query(Registration).filter(Registration.stripe_session_id == session_id).first()

    import stripe

    stripe.api_key = settings.stripe_secret_key
    session: Any = stripe.checkout.Session.retrieve(session_id)
    if session.payment_status != "paid":
        return None

    reg_id = (session.metadata or {}).get("registration_id")
    reg = None
    if reg_id:
        from uuid import UUID

        reg = db.get(Registration, UUID(reg_id))
    if not reg:
        reg = db.query(Registration).filter(Registration.stripe_session_id == session_id).first()
    if not reg:
        return None

    mark_registration_paid(
        db,
        reg,
        stripe_payment_id=session.payment_intent if isinstance(session.payment_intent, str) else None,
        stripe_session_id=session_id,
    )
    db.commit()
    db.refresh(reg)
    return reg
