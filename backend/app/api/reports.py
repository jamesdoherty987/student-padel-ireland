"""User reports for objectionable profiles / media (App Store guideline 1.2)."""

from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.models import ProfileMedia, User
from app.services.email import send_email

logger = logging.getLogger(__name__)
router = APIRouter(tags=["reports"])


class ReportIn(BaseModel):
    target_type: Literal["user", "media"]
    target_id: UUID
    reason: str = Field(min_length=3, max_length=1000)


@router.post("/reports")
def create_report(
    body: ReportIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rate_limit(request, key="report", limit=10, window_seconds=3600)

    if body.target_type == "user":
        target = db.get(User, body.target_id)
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.id == user.id:
            raise HTTPException(status_code=400, detail="You cannot report yourself")
        detail = f"User: {target.full_name} <{target.email}> ({target.id})"
    else:
        media = db.get(ProfileMedia, body.target_id)
        if not media:
            raise HTTPException(status_code=404, detail="Content not found")
        if media.user_id == user.id:
            raise HTTPException(status_code=400, detail="You cannot report your own content")
        owner = db.get(User, media.user_id)
        detail = (
            f"{media.media_type} {media.id} ({media.url})\n"
            f"Owner: {owner.full_name if owner else '?'} <{owner.email if owner else '?'}> ({media.user_id})"
        )

    text = (
        f"New report on Student Padel Ireland\n\n"
        f"Reported {body.target_type}: {detail}\n\n"
        f"Reason:\n{body.reason}\n\n"
        f"Reported by: {user.full_name} <{user.email}> ({user.id})"
    )
    logger.warning("REPORT %s", text)
    send_email(
        to=get_settings().report_email,
        subject=f"[Report] {body.target_type} reported",
        text=text,
        reply_to=user.email,
    )
    return {"ok": True}
