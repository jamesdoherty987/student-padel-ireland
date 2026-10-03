"""Minimal Resend wrapper. Never raises: failures are logged so callers keep working."""

from __future__ import annotations

import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def send_email(*, to: str, subject: str, text: str, reply_to: str | None = None) -> bool:
    settings = get_settings()
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not set; email not sent. Subject: %s\n%s", subject, text)
        return False
    try:
        import resend

        resend.api_key = settings.resend_api_key
        params: dict = {"from": settings.email_from, "to": [to], "subject": subject, "text": text}
        if reply_to:
            params["reply_to"] = reply_to
        resend.Emails.send(params)
        return True
    except Exception:
        logger.exception("Failed to send email: %s", subject)
        return False
