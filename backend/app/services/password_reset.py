"""Forgot / reset password tokens + email."""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models import PasswordResetToken, User
from app.services.email import render_simple_email, send_email

logger = logging.getLogger(__name__)

TOKEN_TTL = timedelta(hours=1)
_GENERIC_OK = "If an account exists for that email, we sent a reset link."


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def request_password_reset(db: Session, email: str) -> str:
    """Create a reset token and email it when the account is eligible. Always return the same message."""
    normalized = (email or "").strip().lower()
    user = db.query(User).filter(User.email == normalized).first()
    if (
        user
        and user.is_active
        and not user.is_suspended
        and not (user.email or "").endswith(".deleted.local")
    ):
        # Invalidate outstanding unused tokens for this user
        now = datetime.now(timezone.utc)
        db.query(PasswordResetToken).filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        ).update({PasswordResetToken.used_at: now}, synchronize_session=False)

        raw = secrets.token_urlsafe(32)
        row = PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_token(raw),
            expires_at=now + TOKEN_TTL,
        )
        db.add(row)
        db.commit()

        settings = get_settings()
        base = (settings.frontend_url or "").rstrip("/")
        reset_url = f"{base}/reset-password?token={raw}"
        first = (user.full_name or "there").strip().split()[0] or "there"
        text, html_body = render_simple_email(
            title="Reset your password",
            greeting=f"Hi {first},",
            paragraphs=[
                "We got a request to reset the password for your Student Padel Ireland account.",
                "This link expires in 1 hour. If you didn’t ask for this, you can ignore the email.",
            ],
            cta_label="Choose a new password",
            cta_url=reset_url,
            footer="Student Padel Ireland · Password reset",
        )
        sent = send_email(
            to=user.email,
            subject="Reset your Student Padel Ireland password",
            text=text,
            html_body=html_body,
        )
        if not sent:
            logger.warning("Password reset email not sent for user %s", user.id)
    return _GENERIC_OK


def reset_password_with_token(db: Session, *, token: str, password: str) -> User:
    raw = (token or "").strip()
    if len(raw) < 20:
        raise HTTPException(400, "This reset link is invalid or has expired")

    now = datetime.now(timezone.utc)
    row = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == _hash_token(raw))
        .first()
    )
    if not row or row.used_at is not None:
        raise HTTPException(400, "This reset link is invalid or has expired")

    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        raise HTTPException(400, "This reset link is invalid or has expired")

    user = db.get(User, row.user_id)
    if not user or not user.is_active or user.is_suspended:
        raise HTTPException(400, "This reset link is invalid or has expired")

    user.password_hash = hash_password(password)
    user.must_set_password = False
    row.used_at = now
    # Burn any other outstanding tokens
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.id != row.id,
    ).update({PasswordResetToken.used_at: now}, synchronize_session=False)
    db.commit()
    db.refresh(user)
    return user
