"""Payment helpers - Stripe Checkout confirm + webhook marking."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Payment, PaymentStatus, Registration, Team, Tournament


def mark_registration_paid(
    db: Session,
    reg: Registration,
    *,
    stripe_payment_id: str | None = None,
    stripe_session_id: str | None = None,
) -> Registration:
    if reg.status == PaymentStatus.PAID.value:
        return reg

    t = db.get(Tournament, reg.tournament_id)
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
    session = stripe.checkout.Session.retrieve(session_id)
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
