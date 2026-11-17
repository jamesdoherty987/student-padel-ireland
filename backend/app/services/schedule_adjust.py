"""Bulk schedule adjustments for organisers (push times / lunch gaps)."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import Match, MatchStatus, Tournament

# Don't rewrite kickoffs for matches already in play or finished
_SKIP_STATUSES = {
    MatchStatus.LIVE.value,
    MatchStatus.CALLED.value,
    MatchStatus.AWAITING_CONFIRM.value,
    MatchStatus.COMPLETED.value,
    MatchStatus.WALKOVER.value,
    MatchStatus.CANCELLED.value,
}


def _dublin_tz():
    try:
        return ZoneInfo("Europe/Dublin")
    except Exception:
        # Prefer UTC over a fixed +1h guess (Irish winter is GMT).
        return timezone.utc


def event_local_cutoff(tournament: Tournament, hhmm: time) -> datetime:
    """Cutoff instant in UTC for “at/after HH:MM” on the event date (Ireland)."""
    tz = _dublin_tz()
    local = datetime.combine(tournament.event_date, hhmm, tzinfo=tz)
    return local.astimezone(timezone.utc)


def match_start_utc(m: Match) -> datetime | None:
    if not m.scheduled_start:
        return None
    start = m.scheduled_start
    if start.tzinfo is None:
        return start.replace(tzinfo=timezone.utc)
    return start.astimezone(timezone.utc)


def _match_eligible(
    m: Match,
    *,
    cutoff: datetime,
    stage_set: set[str] | None,
) -> datetime | None:
    if (m.status or "") in _SKIP_STATUSES:
        return None
    start = match_start_utc(m)
    if start is None or start < cutoff:
        return None
    if stage_set is not None and (m.stage or "").upper() not in stage_set:
        return None
    return start


def shift_matches_after(
    db: Session,
    tournament: Tournament,
    *,
    after_time: time,
    shift_minutes: int,
    stages: list[str] | None = None,
) -> dict:
    """
    Push (or pull) scheduled_start for open matches at/after after_time on the event day.

    stages: optional filter e.g. ["KNOCKOUT", "PLATE"]. None = all stages.
    Skips live / called / confirm / finished matches.
    """
    if shift_minutes == 0:
        return {"updated": 0, "shift_minutes": 0, "after_time": after_time.strftime("%H:%M")}

    cutoff = event_local_cutoff(tournament, after_time)
    delta = timedelta(minutes=shift_minutes)
    stage_set = {s.upper() for s in stages} if stages else None

    matches = db.query(Match).filter(Match.tournament_id == tournament.id).all()
    updated = 0
    skipped_active = 0
    samples: list[dict] = []

    for m in matches:
        if (m.status or "") in _SKIP_STATUSES:
            start = match_start_utc(m)
            if (
                start is not None
                and start >= cutoff
                and (stage_set is None or (m.stage or "").upper() in stage_set)
            ):
                skipped_active += 1
            continue
        start = _match_eligible(m, cutoff=cutoff, stage_set=stage_set)
        if start is None:
            continue
        m.scheduled_start = start + delta
        updated += 1
        if len(samples) < 5:
            samples.append(
                {
                    "id": str(m.id),
                    "stage": m.stage,
                    "from": start.isoformat(),
                    "to": (start + delta).isoformat(),
                }
            )

    db.commit()
    return {
        "updated": updated,
        "skipped_active": skipped_active,
        "shift_minutes": shift_minutes,
        "after_time": after_time.strftime("%H:%M"),
        "stages": sorted(stage_set) if stage_set else None,
        "samples": samples,
    }


def preview_shift_count(
    db: Session,
    tournament: Tournament,
    *,
    after_time: time,
    stages: list[str] | None = None,
) -> dict:
    cutoff = event_local_cutoff(tournament, after_time)
    stage_set = {s.upper() for s in stages} if stages else None
    updated = 0
    skipped_active = 0
    for m in db.query(Match).filter(Match.tournament_id == tournament.id).all():
        if (m.status or "") in _SKIP_STATUSES:
            start = match_start_utc(m)
            if (
                start is not None
                and start >= cutoff
                and (stage_set is None or (m.stage or "").upper() in stage_set)
            ):
                skipped_active += 1
            continue
        if _match_eligible(m, cutoff=cutoff, stage_set=stage_set) is not None:
            updated += 1
    return {"updated": updated, "skipped_active": skipped_active}


def lunch_window_utc(
    tournament: Tournament,
) -> tuple[datetime, datetime] | None:
    """Return (start, end) UTC for configured lunch, or None if unset/zero."""
    mins = int(getattr(tournament, "lunch_break_minutes", 0) or 0)
    start_t = getattr(tournament, "lunch_break_start", None)
    if mins <= 0 or not start_t:
        return None
    start = event_local_cutoff(tournament, start_t)
    return start, start + timedelta(minutes=mins)
