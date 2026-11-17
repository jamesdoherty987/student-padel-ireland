"""Late entries lock when event start date/time is reached."""

from datetime import date, datetime, time, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api import tournaments as mod
from app.api.tournaments import (
    _assert_accepting_new_entries,
    _autoclose_registration_if_needed,
    _event_started,
)
from app.models import Tournament, TournamentStatus


def _tournament(
    *,
    event_date: date,
    start_time: time,
    status: str = TournamentStatus.REGISTRATION_OPEN.value,
):
    return Tournament(
        id=uuid4(),
        name="Lock test",
        slug=f"lock-{uuid4().hex[:8]}",
        event_date=event_date,
        start_time=start_time,
        venue="Test",
        location="Dublin",
        max_teams=16,
        status=status,
        organiser_id=uuid4(),
    )


def _freeze_now(monkeypatch, when: datetime):
    class FakeDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is not None:
                return when.astimezone(tz)
            return when

    monkeypatch.setattr(mod, "datetime", FakeDateTime)


def test_accepts_entries_before_start(monkeypatch):
    t = _tournament(event_date=date(2030, 6, 1), start_time=time(10, 0))
    _freeze_now(monkeypatch, datetime(2030, 6, 1, 7, 0, tzinfo=timezone.utc))
    assert _event_started(t) is False
    _assert_accepting_new_entries(t)


def test_rejects_entries_after_start(monkeypatch):
    t = _tournament(event_date=date(2020, 1, 1), start_time=time(10, 0))
    _freeze_now(monkeypatch, datetime(2030, 6, 1, 12, 0, tzinfo=timezone.utc))
    assert _event_started(t) is True
    with pytest.raises(HTTPException) as ei:
        _assert_accepting_new_entries(t)
    assert ei.value.status_code == 400
    assert "started" in str(ei.value.detail).lower()


def test_autoclose_on_start(monkeypatch):
    t = _tournament(event_date=date(2020, 1, 1), start_time=time(9, 0))
    _freeze_now(monkeypatch, datetime(2030, 1, 1, 12, 0, tzinfo=timezone.utc))
    assert _autoclose_registration_if_needed(t) is True
    assert t.status == TournamentStatus.REGISTRATION_CLOSED.value
