"""Day-before tournament reminder emails for registered players."""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import (
    PaymentStatus,
    Registration,
    Team,
    TeamPlayer,
    Tournament,
    TournamentReminderLog,
    TournamentStatus,
    User,
)
from app.services.email import render_simple_email, send_email

logger = logging.getLogger(__name__)

IRELAND_TZ = ZoneInfo("Europe/Dublin")

_SKIP_STATUSES = {
    TournamentStatus.DRAFT.value,
    TournamentStatus.CANCELLED.value,
    TournamentStatus.COMPLETED.value,
}


def ireland_today(*, now: datetime | None = None) -> date:
    when = now or datetime.now(timezone.utc)
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(IRELAND_TZ).date()


def format_event_when(event_date: date, start_time) -> str:
    """e.g. Saturday 25 Oct · 10:00"""
    # %-d is POSIX-only; fall back for platforms that reject it
    try:
        day = event_date.strftime("%A %-d %b")
    except ValueError:
        day = event_date.strftime("%A %d %b").replace(" 0", " ")
    st = start_time.strftime("%H:%M") if start_time else "TBC"
    return f"{day} · {st}"


def _eligible_tournaments(db: Session, event_date: date) -> list[Tournament]:
    return (
        db.query(Tournament)
        .filter(
            Tournament.event_date == event_date,
            Tournament.status.notin_(list(_SKIP_STATUSES)),
        )
        .all()
    )


def recipients_for_tournament(db: Session, tournament_id: UUID) -> list[User]:
    """Paid, non-withdrawn team members who have not yet been reminded."""
    already = {
        row[0]
        for row in db.query(TournamentReminderLog.user_id)
        .filter(TournamentReminderLog.tournament_id == tournament_id)
        .all()
    }
    rows = (
        db.query(User)
        .join(TeamPlayer, TeamPlayer.user_id == User.id)
        .join(Team, Team.id == TeamPlayer.team_id)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            Registration.status == PaymentStatus.PAID.value,
            User.is_active.is_(True),
            User.is_suspended.is_(False),
        )
        .all()
    )
    seen: set[UUID] = set()
    out: list[User] = []
    for u in rows:
        if u.id in already or u.id in seen:
            continue
        if not (u.email or "").strip():
            continue
        seen.add(u.id)
        out.append(u)
    return out


def _build_reminder(tournament: Tournament, user: User) -> tuple[str, str, str]:
    settings = get_settings()
    next_path = quote(f"/t/{tournament.slug}/live", safe="")
    login_url = f"{settings.frontend_url}/login?next={next_path}"
    when = format_event_when(tournament.event_date, tournament.start_time)
    venue_line = f"{tournament.venue}, {tournament.location}"
    first = (user.full_name or "there").strip().split()[0] or "there"
    today = ireland_today()
    if tournament.event_date == today:
        subject = f"Today: {tournament.name}"
        title = "You're playing today"
    else:
        subject = f"Tomorrow: {tournament.name}"
        title = "You're playing tomorrow"

    text, html_body = render_simple_email(
        title=title,
        greeting=f"Hi {first},",
        paragraphs=[
            f"Quick reminder - you're registered for {tournament.name}.",
            "Log in to check your entry, draw, and court updates.",
        ],
        detail_lines=[
            ("When", when),
            ("Where", venue_line),
        ],
        cta_label="Log in",
        cta_url=login_url,
    )
    return subject, text, html_body


def send_reminder_to_user(db: Session, tournament: Tournament, user: User, *, dry_run: bool = False) -> str:
    """
    Send one reminder. Returns status: sent | skipped | dry_run | failed.

    Claims a TournamentReminderLog row before sending so concurrent workers cannot
    double-email. Releases the claim if the send fails.
    """
    existing = (
        db.query(TournamentReminderLog)
        .filter(
            TournamentReminderLog.tournament_id == tournament.id,
            TournamentReminderLog.user_id == user.id,
        )
        .first()
    )
    if existing:
        return "skipped"

    subject, text, html_body = _build_reminder(tournament, user)
    if dry_run:
        logger.info("DRY RUN reminder → %s · %s", user.email, subject)
        return "dry_run"

    claim = TournamentReminderLog(
        tournament_id=tournament.id,
        user_id=user.id,
        sent_at=datetime.now(timezone.utc),
    )
    db.add(claim)
    try:
        db.commit()
    except Exception:
        db.rollback()
        # Another worker claimed this (tournament, user) — treat as already sent
        again = (
            db.query(TournamentReminderLog)
            .filter(
                TournamentReminderLog.tournament_id == tournament.id,
                TournamentReminderLog.user_id == user.id,
            )
            .first()
        )
        if again:
            return "skipped"
        logger.exception("Failed to claim reminder for %s / %s", tournament.id, user.id)
        return "failed"

    ok = send_email(to=user.email, subject=subject, text=text, html_body=html_body)
    if not ok:
        try:
            db.query(TournamentReminderLog).filter(
                TournamentReminderLog.tournament_id == tournament.id,
                TournamentReminderLog.user_id == user.id,
            ).delete(synchronize_session=False)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Failed to release reminder claim for %s / %s", tournament.id, user.id)
        return "failed"
    return "sent"


def send_reminders_for_tournament(
    db: Session,
    tournament: Tournament,
    *,
    dry_run: bool = False,
) -> dict:
    users = recipients_for_tournament(db, tournament.id)
    counts = {
        "tournament_id": str(tournament.id),
        "name": tournament.name,
        "sent": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
    }
    for user in users:
        status = send_reminder_to_user(db, tournament, user, dry_run=dry_run)
        counts[status] = counts.get(status, 0) + 1
    return counts


def run_day_before_reminders(
    db: Session,
    *,
    dry_run: bool = False,
    as_of: date | None = None,
) -> dict:
    """Email all paid players for tournaments happening tomorrow (Ireland calendar)."""
    today = as_of or ireland_today()
    target = today + timedelta(days=1)
    tournaments = _eligible_tournaments(db, target)
    results = []
    totals = {"sent": 0, "skipped": 0, "failed": 0, "dry_run": 0, "tournaments": 0}
    for t in tournaments:
        row = send_reminders_for_tournament(db, t, dry_run=dry_run)
        results.append(row)
        totals["tournaments"] += 1
        for key in ("sent", "skipped", "failed", "dry_run"):
            totals[key] += int(row.get(key, 0))
    return {
        "ok": True,
        "ireland_today": today.isoformat(),
        "event_date": target.isoformat(),
        "totals": totals,
        "tournaments": results,
    }


def maybe_remind_team_after_paid(db: Session, tournament_id: UUID, team_id: UUID) -> None:
    """If the event is today or tomorrow (Ireland), remind teammates who just got a paid spot."""
    try:
        tournament = db.get(Tournament, tournament_id)
        if not tournament or tournament.status in _SKIP_STATUSES:
            return
        today = ireland_today()
        if tournament.event_date not in (today, today + timedelta(days=1)):
            return
        members = (
            db.query(User)
            .join(TeamPlayer, TeamPlayer.user_id == User.id)
            .filter(
                TeamPlayer.team_id == team_id,
                User.is_active.is_(True),
                User.is_suspended.is_(False),
            )
            .all()
        )
        for user in members:
            send_reminder_to_user(db, tournament, user, dry_run=False)
    except Exception:
        logger.exception("Imminent reminder failed for tournament %s team %s", tournament_id, team_id)
