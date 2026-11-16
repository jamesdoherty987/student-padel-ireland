"""Organiser bulk email to tournament entrants."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import PaymentStatus, Registration, Team, TeamPlayer, Tournament, User
from app.services.email import render_simple_email, send_email

logger = logging.getLogger(__name__)


def entrant_recipients(
    db: Session,
    tournament_id: UUID,
    *,
    paid_only: bool = True,
) -> list[User]:
    """Unique active players on non-withdrawn teams (optionally paid only)."""
    q = (
        db.query(User)
        .join(TeamPlayer, TeamPlayer.user_id == User.id)
        .join(Team, Team.id == TeamPlayer.team_id)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            User.is_active.is_(True),
            User.is_suspended.is_(False),
        )
    )
    if paid_only:
        q = q.filter(Registration.status == PaymentStatus.PAID.value)
    else:
        q = q.filter(
            Registration.status.in_(
                [PaymentStatus.PAID.value, PaymentStatus.PENDING.value]
            )
        )

    seen: set[UUID] = set()
    out: list[User] = []
    for u in q.all():
        if u.id in seen:
            continue
        email = (u.email or "").strip()
        if not email or email.endswith(".deleted.local"):
            continue
        seen.add(u.id)
        out.append(u)
    return out


def send_bulk_email_to_entrants(
    db: Session,
    tournament: Tournament,
    *,
    subject: str,
    body: str,
    paid_only: bool = True,
    reply_to: str | None = None,
) -> dict[str, int]:
    settings = get_settings()
    front = (settings.frontend_url or "https://www.studentpadel.ie").rstrip("/")
    live_url = f"{front}/t/{tournament.slug}/live"
    recipients = entrant_recipients(db, tournament.id, paid_only=paid_only)

    # Split body into short paragraphs for the HTML template
    paragraphs = [p.strip() for p in (body or "").replace("\r\n", "\n").split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [(body or "").strip()]
    # Cap how many blocks we pass to the template
    paragraphs = paragraphs[:12]

    sent = 0
    failed = 0
    for user in recipients:
        first = (user.full_name or "there").strip().split()[0] or "there"
        text, html_body = render_simple_email(
            title=subject.strip(),
            greeting=f"Hi {first},",
            paragraphs=paragraphs,
            detail_lines=[("Event", tournament.name)],
            cta_label="Open event",
            cta_url=live_url,
            footer="Student Padel Ireland · Message from the organiser",
        )
        ok = send_email(
            to=user.email,
            subject=f"{subject.strip()} · {tournament.name}",
            text=text,
            html_body=html_body,
            reply_to=reply_to,
        )
        if ok:
            sent += 1
        else:
            failed += 1
            logger.warning("Bulk entrant email failed for %s", user.email)

    return {
        "recipients": len(recipients),
        "sent": sent,
        "failed": failed,
    }
