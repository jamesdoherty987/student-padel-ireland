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
    Match,
    MatchStatus,
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

_SCHEDULE_SKIP = {
    MatchStatus.CANCELLED.value,
    MatchStatus.WALKOVER.value,
    MatchStatus.COMPLETED.value,
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


def _reminders_on(tournament: Tournament) -> bool:
    return getattr(tournament, "reminders_enabled", True) is not False


def _eligible_tournaments(db: Session, event_date: date) -> list[Tournament]:
    rows = (
        db.query(Tournament)
        .filter(
            Tournament.event_date == event_date,
            Tournament.status.notin_(list(_SKIP_STATUSES)),
        )
        .all()
    )
    return [t for t in rows if _reminders_on(t)]


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


def _court_labels(db: Session, tournament_id: UUID) -> dict[int, str]:
    from app.models import Court

    rows = (
        db.query(Court)
        .filter(Court.tournament_id == tournament_id)
        .order_by(Court.court_number)
        .all()
    )
    return {
        int(c.court_number): (c.name or f"Court {c.court_number}").strip() or f"Court {c.court_number}"
        for c in rows
    }


def _format_match_time(scheduled_start: datetime | None) -> str:
    if not scheduled_start:
        return "TBC"
    when = scheduled_start
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    local = when.astimezone(IRELAND_TZ)
    return local.strftime("%H:%M")


def _opponent_label(match: Match, my_team_id: UUID, team_names: dict[UUID, str]) -> str:
    if match.team_a_id == my_team_id:
        if match.team_b_id and match.team_b_id in team_names:
            return team_names[match.team_b_id]
        return (match.team_b_placeholder or "TBD").strip() or "TBD"
    if match.team_a_id and match.team_a_id in team_names:
        return team_names[match.team_a_id]
    return (match.team_a_placeholder or "TBD").strip() or "TBD"


def _round_label(round_name: str | None, stage: str | None) -> str:
    raw = (round_name or "").replace("_", " ").strip()
    if not raw:
        return (stage or "Match").title()
    upper = raw.upper()
    mapping = {
        "QF": "Quarter-final",
        "SF": "Semi-final",
        "FINAL": "Final",
        "3RD PLACE": "3rd place",
    }
    if upper in mapping:
        return mapping[upper]
    if upper.startswith("GROUP"):
        return raw.title()
    return raw.title()


def schedule_lines_for_user(db: Session, tournament: Tournament, user: User) -> list[str]:
    """Match times for this player's team(s), once a draw exists."""
    team_ids = [
        row[0]
        for row in (
            db.query(Team.id)
            .join(TeamPlayer, TeamPlayer.team_id == Team.id)
            .filter(
                Team.tournament_id == tournament.id,
                Team.withdrawn.is_(False),
                TeamPlayer.user_id == user.id,
            )
            .all()
        )
    ]
    if not team_ids:
        return []

    matches = (
        db.query(Match)
        .filter(
            Match.tournament_id == tournament.id,
            Match.status.notin_(list(_SCHEDULE_SKIP)),
            ((Match.team_a_id.in_(team_ids)) | (Match.team_b_id.in_(team_ids))),
        )
        .order_by(Match.sort_order.asc(), Match.scheduled_start.asc())
        .all()
    )
    if not matches:
        return []

    def _sort_key(m: Match):
        start = m.scheduled_start
        if start is None:
            return (1, datetime.max.replace(tzinfo=timezone.utc), m.sort_order or 0)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        else:
            start = start.astimezone(timezone.utc)
        return (0, start, m.sort_order or 0)

    # Prefer timed matches first for the email
    matches = sorted(matches, key=_sort_key)

    involved = set()
    for m in matches:
        if m.team_a_id:
            involved.add(m.team_a_id)
        if m.team_b_id:
            involved.add(m.team_b_id)
    teams = db.query(Team).filter(Team.id.in_(list(involved))).all() if involved else []
    team_names = {t.id: t.name for t in teams}
    courts = _court_labels(db, tournament.id)

    lines: list[str] = []
    for m in matches:
        my_id = m.team_a_id if m.team_a_id in team_ids else m.team_b_id
        if not my_id:
            continue
        time_bit = _format_match_time(m.scheduled_start)
        if m.court_number is not None:
            court_bit = courts.get(m.court_number) or f"Court {m.court_number}"
        else:
            court_bit = "Court TBC"
        opp = _opponent_label(m, my_id, team_names)
        round_bit = _round_label(m.round, m.stage)
        lines.append(f"{time_bit} · {court_bit} · vs {opp} ({round_bit})")
        if len(lines) >= 12:
            break
    return lines


def _apply_template(template: str, *, mapping: dict[str, str]) -> str:
    out = template
    for key, value in mapping.items():
        out = out.replace("{" + key + "}", value)
    return out


def _build_reminder(
    db: Session,
    tournament: Tournament,
    user: User,
) -> tuple[str, str, str]:
    settings = get_settings()
    next_path = quote(f"/t/{tournament.slug}/live", safe="")
    login_url = f"{settings.frontend_url}/login?next={next_path}"
    when = format_event_when(tournament.event_date, tournament.start_time)
    venue_line = f"{tournament.venue}, {tournament.location}"
    first = (user.full_name or "there").strip().split()[0] or "there"
    today = ireland_today()
    is_today = tournament.event_date == today

    mapping = {
        "name": first,
        "event": tournament.name,
        "when": when,
        "venue": venue_line,
    }

    custom_subject = (getattr(tournament, "reminder_subject", None) or "").strip()
    custom_body = (getattr(tournament, "reminder_body", None) or "").strip()

    if custom_subject:
        subject = _apply_template(custom_subject, mapping=mapping)[:120]
    elif is_today:
        subject = f"Today: {tournament.name}"
    else:
        subject = f"Tomorrow: {tournament.name}"

    if is_today:
        title = "You're playing today"
    else:
        title = "You're playing tomorrow"

    if custom_body:
        paragraphs = [
            _apply_template(p.strip(), mapping=mapping)
            for p in custom_body.replace("\r\n", "\n").split("\n")
            if p.strip()
        ][:10]
    else:
        paragraphs = [
            f"Quick reminder - you're registered for {tournament.name}.",
            "Log in to check your entry, draw, and court updates.",
        ]

    schedule = schedule_lines_for_user(db, tournament, user)
    if schedule:
        # Point players at live board for updates once they have times
        if not custom_body:
            paragraphs = [
                f"Quick reminder - you're registered for {tournament.name}.",
                "Here’s your current schedule. Times can move - check Live for updates.",
            ]

    text, html_body = render_simple_email(
        title=title,
        greeting=f"Hi {first},",
        paragraphs=paragraphs,
        detail_lines=[
            ("When", when),
            ("Where", venue_line),
        ],
        schedule_lines=schedule or None,
        schedule_heading="Your schedule",
        cta_label="Open live board",
        cta_url=login_url,
    )
    return subject, text, html_body


def send_reminder_to_user(
    db: Session,
    tournament: Tournament,
    user: User,
    *,
    dry_run: bool = False,
) -> str:
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

    subject, text, html_body = _build_reminder(db, tournament, user)
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
        # Another worker claimed this (tournament, user) - treat as already sent
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
    force: bool = False,
) -> dict:
    """Send reminders. Auto/cron respects reminders_enabled unless force=True (manual Send now)."""
    counts = {
        "tournament_id": str(tournament.id),
        "name": tournament.name,
        "sent": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
        "disabled": 0,
    }
    if not force and not _reminders_on(tournament):
        counts["disabled"] = 1
        return counts

    users = recipients_for_tournament(db, tournament.id)
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
    totals = {
        "sent": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": 0,
        "disabled": 0,
        "tournaments": 0,
    }
    for t in tournaments:
        row = send_reminders_for_tournament(db, t, dry_run=dry_run, force=False)
        results.append(row)
        totals["tournaments"] += 1
        for key in ("sent", "skipped", "failed", "dry_run", "disabled"):
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
        if not _reminders_on(tournament):
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
