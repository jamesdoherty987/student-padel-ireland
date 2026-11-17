from datetime import date, datetime, time, timedelta, timezone
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Base,
    Match,
    MatchStatus,
    Tournament,
    TournamentStatus,
    User,
    UserRole,
)
from app.services.schedule_adjust import preview_shift_count, shift_matches_after
from app.services.tournament_generator import _avoid_lunch_window


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_avoid_lunch_pushes_overlap():
    lunch = datetime(2026, 11, 18, 14, 0, tzinfo=timezone.utc)
    lunch_end = lunch + timedelta(minutes=60)
    slot = timedelta(minutes=20)
    assert (
        _avoid_lunch_window(datetime(2026, 11, 18, 13, 50, tzinfo=timezone.utc), slot, lunch, 60)
        == lunch_end
    )
    early = datetime(2026, 11, 18, 11, 0, tzinfo=timezone.utc)
    assert _avoid_lunch_window(early, slot, lunch, 60) == early


def test_shift_knockout_after_2pm():
    db = _session()
    org = User(
        id=uuid4(),
        email="org@ul.ie",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    db.add(org)
    t = Tournament(
        id=uuid4(),
        name="Limerick Open",
        slug="limerick-open-test",
        location="Limerick",
        venue="LK",
        event_date=date(2026, 11, 18),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_CLOSED.value,
    )
    db.add(t)
    db.flush()

    group = Match(
        id=uuid4(),
        tournament_id=t.id,
        round="GROUP_A",
        stage="GROUP",
        scheduled_start=datetime(2026, 11, 18, 13, 40, tzinfo=timezone.utc),
        status=MatchStatus.SCHEDULED.value,
        sort_order=0,
    )
    ko = Match(
        id=uuid4(),
        tournament_id=t.id,
        round="R16",
        stage="KNOCKOUT",
        scheduled_start=datetime(2026, 11, 18, 14, 10, tzinfo=timezone.utc),
        status=MatchStatus.SCHEDULED.value,
        sort_order=1,
    )
    plate = Match(
        id=uuid4(),
        tournament_id=t.id,
        round="R16",
        stage="PLATE",
        scheduled_start=datetime(2026, 11, 18, 15, 50, tzinfo=timezone.utc),
        status=MatchStatus.SCHEDULED.value,
        sort_order=2,
    )
    db.add_all([group, ko, plate])
    db.commit()

    preview = preview_shift_count(
        db, t, after_time=time(14, 0), stages=["KNOCKOUT", "PLATE"]
    )
    assert preview["updated"] == 2
    assert preview["skipped_active"] == 0

    result = shift_matches_after(
        db,
        t,
        after_time=time(14, 0),
        shift_minutes=60,
        stages=["KNOCKOUT", "PLATE"],
    )
    assert result["updated"] == 2
    assert result["skipped_active"] == 0
    db.refresh(group)
    db.refresh(ko)
    db.refresh(plate)
    assert group.scheduled_start.replace(tzinfo=timezone.utc) == datetime(
        2026, 11, 18, 13, 40, tzinfo=timezone.utc
    )
    assert ko.scheduled_start.replace(tzinfo=timezone.utc) == datetime(
        2026, 11, 18, 15, 10, tzinfo=timezone.utc
    )
    assert plate.scheduled_start.replace(tzinfo=timezone.utc) == datetime(
        2026, 11, 18, 16, 50, tzinfo=timezone.utc
    )


def test_shift_skips_live_matches():
    db = _session()
    org = User(
        id=uuid4(),
        email="org2@ul.ie",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    db.add(org)
    t = Tournament(
        id=uuid4(),
        name="Live Skip",
        slug="live-skip",
        location="Limerick",
        venue="LK",
        event_date=date(2026, 11, 18),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.LIVE.value,
    )
    db.add(t)
    db.flush()
    live = Match(
        id=uuid4(),
        tournament_id=t.id,
        round="R16",
        stage="KNOCKOUT",
        scheduled_start=datetime(2026, 11, 18, 14, 10, tzinfo=timezone.utc),
        status=MatchStatus.LIVE.value,
        sort_order=0,
    )
    open_m = Match(
        id=uuid4(),
        tournament_id=t.id,
        round="QF",
        stage="KNOCKOUT",
        scheduled_start=datetime(2026, 11, 18, 14, 50, tzinfo=timezone.utc),
        status=MatchStatus.SCHEDULED.value,
        sort_order=1,
    )
    db.add_all([live, open_m])
    db.commit()

    result = shift_matches_after(
        db, t, after_time=time(14, 0), shift_minutes=60, stages=["KNOCKOUT"]
    )
    assert result["updated"] == 1
    assert result["skipped_active"] == 1
    db.refresh(live)
    db.refresh(open_m)
    assert live.scheduled_start.replace(tzinfo=timezone.utc).hour == 14
    assert open_m.scheduled_start.replace(tzinfo=timezone.utc).hour == 15
