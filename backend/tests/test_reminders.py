from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Base,
    PaymentStatus,
    Registration,
    Team,
    TeamPlayer,
    Tournament,
    TournamentReminderLog,
    TournamentStatus,
    User,
    UserRole,
)
from app.services.reminders import (
    format_event_when,
    ireland_today,
    recipients_for_tournament,
    run_day_before_reminders,
    send_reminder_to_user,
)


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def _seed_tournament(db, *, event_date: date, status: str = TournamentStatus.REGISTRATION_OPEN.value):
    organiser = User(
        id=uuid4(),
        email=f"org-{uuid4().hex[:8]}@example.com",
        password_hash="x",
        full_name="Org User",
        role=UserRole.PLAYER.value,
    )
    db.add(organiser)
    t = Tournament(
        id=uuid4(),
        name="UL Open",
        slug=f"ul-open-{uuid4().hex[:6]}",
        location="Limerick",
        venue="Arena",
        event_date=event_date,
        start_time=time(10, 0),
        organiser_id=organiser.id,
        status=status,
    )
    db.add(t)
    db.flush()
    return organiser, t


def _add_paid_player(db, tournament: Tournament, *, email: str, name: str) -> User:
    user = User(
        id=uuid4(),
        email=email,
        password_hash="x",
        full_name=name,
        role=UserRole.PLAYER.value,
    )
    db.add(user)
    team = Team(id=uuid4(), tournament_id=tournament.id, name=name)
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=user.id, slot=1))
    db.add(
        Registration(
            tournament_id=tournament.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=5000,
            currency="EUR",
        )
    )
    db.flush()
    return user


def test_ireland_today_uses_dublin_calendar():
    # 23:30 UTC on 24 Oct is already 24 Oct in Dublin (IST = UTC+1 → 00:30)
    utc = datetime(2026, 10, 24, 23, 30, tzinfo=timezone.utc)
    assert ireland_today(now=utc) == date(2026, 10, 25)


def test_format_event_when():
    s = format_event_when(date(2026, 10, 25), time(10, 0))
    assert "25" in s
    assert "10:00" in s
    assert "·" in s


def test_run_day_before_sends_once_and_is_idempotent():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    player = _add_paid_player(db, t, email="james@ul.ie", name="James Doherty")
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        first = run_day_before_reminders(db)
        assert first["totals"]["sent"] == 1
        assert first["totals"]["tournaments"] == 1
        assert mock_send.call_count == 1
        kwargs = mock_send.call_args.kwargs
        assert kwargs["to"] == "james@ul.ie"
        assert "Tomorrow" in kwargs["subject"]
        assert kwargs["html_body"] and "Log in" in kwargs["html_body"]
        assert "/login?next=" in kwargs["text"]

        second = run_day_before_reminders(db)
        assert second["totals"]["sent"] == 0
        # Already-reminded players are filtered before send (not counted as skipped)
        assert second["totals"]["skipped"] == 0
        assert mock_send.call_count == 1

    logs = db.query(TournamentReminderLog).filter(TournamentReminderLog.user_id == player.id).all()
    assert len(logs) == 1
    assert recipients_for_tournament(db, t.id) == []


def test_skips_draft_and_withdrawn_and_unpaid():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, draft = _seed_tournament(db, event_date=tomorrow, status=TournamentStatus.DRAFT.value)
    _add_paid_player(db, draft, email="a@ul.ie", name="A")

    _, open_t = _seed_tournament(db, event_date=tomorrow)
    unpaid = User(
        id=uuid4(),
        email="pending@ul.ie",
        password_hash="x",
        full_name="Pending",
        role=UserRole.PLAYER.value,
    )
    db.add(unpaid)
    team = Team(id=uuid4(), tournament_id=open_t.id, name="Pending")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=unpaid.id, slot=1))
    db.add(
        Registration(
            tournament_id=open_t.id,
            team_id=team.id,
            status=PaymentStatus.PENDING.value,
            amount_cents=5000,
            currency="EUR",
        )
    )

    withdrawn_user = User(
        id=uuid4(),
        email="out@ul.ie",
        password_hash="x",
        full_name="Out",
        role=UserRole.PLAYER.value,
    )
    db.add(withdrawn_user)
    wteam = Team(id=uuid4(), tournament_id=open_t.id, name="Out", withdrawn=True)
    db.add(wteam)
    db.flush()
    db.add(TeamPlayer(team_id=wteam.id, user_id=withdrawn_user.id, slot=1))
    db.add(
        Registration(
            tournament_id=open_t.id,
            team_id=wteam.id,
            status=PaymentStatus.PAID.value,
            amount_cents=5000,
            currency="EUR",
        )
    )
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        result = run_day_before_reminders(db)
        assert result["totals"]["sent"] == 0
        mock_send.assert_not_called()


def test_dry_run_does_not_log():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    player = _add_paid_player(db, t, email="dry@ul.ie", name="Dry Run")
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        result = run_day_before_reminders(db, dry_run=True)
        assert result["totals"]["dry_run"] == 1
        mock_send.assert_not_called()

    assert db.query(TournamentReminderLog).filter(TournamentReminderLog.user_id == player.id).count() == 0
    assert len(recipients_for_tournament(db, t.id)) == 1


def test_failed_send_not_logged():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    player = _add_paid_player(db, t, email="fail@ul.ie", name="Fail")
    db.commit()

    with patch("app.services.reminders.send_email", return_value=False):
        status = send_reminder_to_user(db, t, player)
        assert status == "failed"

    assert db.query(TournamentReminderLog).count() == 0


def test_skips_suspended_users():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    player = _add_paid_player(db, t, email="sus@ul.ie", name="Suspended")
    player.is_suspended = True
    db.commit()
    assert recipients_for_tournament(db, t.id) == []


def test_today_copy_uses_today_not_tomorrow():
    db = _session()
    today = ireland_today()
    _, t = _seed_tournament(db, event_date=today)
    player = _add_paid_player(db, t, email="today@ul.ie", name="Today Player")
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        status = send_reminder_to_user(db, t, player)
        assert status == "sent"
        assert "Today" in mock_send.call_args.kwargs["subject"]
        assert "playing today" in mock_send.call_args.kwargs["html_body"]
