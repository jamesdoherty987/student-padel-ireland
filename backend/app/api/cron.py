"""Internal cron endpoints (GitHub Actions / Render). Protected by CRON_SECRET."""

from __future__ import annotations

import hmac
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, user_can_manage_tournament
from app.core.config import get_settings
from app.db.session import get_db
from app.models import Tournament, User
from app.services.reminders import run_day_before_reminders, send_reminders_for_tournament

logger = logging.getLogger(__name__)
router = APIRouter(tags=["cron"])


def _require_cron_secret(
    authorization: str | None = Header(default=None),
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
) -> None:
    settings = get_settings()
    expected = (settings.cron_secret or "").strip()
    if not expected:
        raise HTTPException(
            503,
            "CRON_SECRET is not configured on the API",
        )
    provided = (x_cron_secret or "").strip()
    if not provided and authorization:
        parts = authorization.split(" ", 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            provided = parts[1].strip()
    # compare_digest raises on length mismatch in some Python versions
    if (
        not provided
        or len(provided) != len(expected)
        or not hmac.compare_digest(provided, expected)
    ):
        raise HTTPException(401, "Invalid cron secret")


@router.post("/cron/tournament-reminders")
def cron_tournament_reminders(
    db: Session = Depends(get_db),
    dry_run: bool = Query(False),
    _: None = Depends(_require_cron_secret),
):
    """Send day-before reminder emails for tournaments starting tomorrow (Ireland)."""
    result = run_day_before_reminders(db, dry_run=dry_run)
    logger.info("Tournament reminders cron: %s", result.get("totals"))
    return result


@router.post("/tournaments/{tournament_id}/reminders")
def send_tournament_reminders(
    tournament_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    dry_run: bool = Query(False),
):
    """Organiser: manual send for day-before / day-of only (avoids burning the real reminder early)."""
    from app.services.reminders import ireland_today

    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if not user_can_manage_tournament(user, t, db):
        raise HTTPException(403, "Not allowed")
    if t.status in ("DRAFT", "CANCELLED", "COMPLETED"):
        raise HTTPException(400, "Reminders aren’t available for this tournament status")
    days = (t.event_date - ireland_today()).days
    if days > 1:
        raise HTTPException(
            400,
            "Reminders go out automatically the day before. "
            "You can send manually from the day before (or on the day).",
        )
    if days < 0:
        raise HTTPException(400, "This event date has already passed")
    row = send_reminders_for_tournament(db, t, dry_run=dry_run)
    return {"ok": True, **row}
