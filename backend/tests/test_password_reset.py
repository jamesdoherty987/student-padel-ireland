from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import verify_password
from app.models import Base, PasswordResetToken, User, UserRole
from app.services.password_reset import request_password_reset, reset_password_with_token


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _user(db, email="player@ex.com"):
    u = User(
        id=uuid4(),
        email=email,
        password_hash="old-hash",
        full_name="Test Player",
        role=UserRole.PLAYER.value,
    )
    db.add(u)
    db.commit()
    return u


def test_forgot_unknown_email_is_silent():
    db = _session()
    msg = request_password_reset(db, "nobody@ex.com")
    assert "reset link" in msg.lower()
    assert db.query(PasswordResetToken).count() == 0


def test_reset_flow_happy_path(monkeypatch):
    db = _session()
    user = _user(db)
    captured: dict = {}

    def fake_send(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr("app.services.password_reset.send_email", fake_send)
    monkeypatch.setattr(
        "app.services.password_reset.get_settings",
        lambda: type("S", (), {"frontend_url": "https://studentpadel.ie"})(),
    )

    request_password_reset(db, user.email)
    assert "reset-password?token=" in captured.get("text", "")
    row = db.query(PasswordResetToken).one()
    assert row.used_at is None

    # Pull raw token from emailed URL
    import re

    match = re.search(r"token=([A-Za-z0-9_\-]+)", captured["text"])
    assert match
    raw = match.group(1)

    updated = reset_password_with_token(db, token=raw, password="newpass123")
    assert updated.id == user.id
    assert verify_password("newpass123", updated.password_hash)
    db.refresh(row)
    assert row.used_at is not None

    try:
        reset_password_with_token(db, token=raw, password="anotherpass1")
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_expired_token_rejected(monkeypatch):
    db = _session()
    user = _user(db, "exp@ex.com")
    monkeypatch.setattr("app.services.password_reset.send_email", lambda **_: True)
    monkeypatch.setattr(
        "app.services.password_reset.get_settings",
        lambda: type("S", (), {"frontend_url": "https://studentpadel.ie"})(),
    )
    # Create token manually with past expiry
    import hashlib
    import secrets

    raw = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    db.commit()
    try:
        reset_password_with_token(db, token=raw, password="newpass123")
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400
