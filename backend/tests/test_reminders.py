from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Base,
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
    UserRole,
)
from app.services.reminders import (
    format_event_when,
    ireland_today,
    recipients_for_tournament,
    run_day_before_reminders,
    send_reminder_to_user,
    send_reminders_for_tournament,
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
        assert kwargs["subject"] == "Reminder: UL Open"
        assert kwargs["html_body"] and "Open live board" in kwargs["html_body"]
        assert "Download the app" in kwargs["html_body"]
        assert "spi-logo.png" in kwargs["html_body"]
        assert "/login?next=" in kwargs["text"]
        assert "Student Padel Ireland app" in kwargs["text"]
        assert "apps.apple.com" in kwargs["text"]
        assert "Your matches:" in kwargs["text"]
        assert "playing tomorrow" in kwargs["html_body"]
        assert "/padel-rules" in kwargs["text"]
        assert "#tour-rules" in kwargs["text"]
        assert "/fixtures" in kwargs["text"]
        assert "Match format:" in kwargs["text"]
        assert "Common padel rules:" in kwargs["text"]

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
        # Subject uses editable template; title still says today
        assert "UL Open" in mock_send.call_args.kwargs["subject"]
        assert "playing today" in mock_send.call_args.kwargs["html_body"]


def test_auto_reminders_disabled_skips_cron_but_force_sends():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    t.reminders_enabled = False
    player = _add_paid_player(db, t, email="off@ul.ie", name="Off Auto")
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        auto = run_day_before_reminders(db)
        assert auto["totals"]["sent"] == 0
        assert auto["totals"]["tournaments"] == 0
        mock_send.assert_not_called()

        forced = send_reminders_for_tournament(db, t, force=True)
        assert forced["sent"] == 1
        assert mock_send.call_count == 1
        assert player.email == mock_send.call_args.kwargs["to"]


def test_custom_message_and_schedule_in_email():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    t.reminder_subject = "See you · {event}"
    t.reminder_body = "Hi {name} — park at the side gate.\nBring water."
    t.is_official = True
    player = _add_paid_player(db, t, email="sched@ul.ie", name="Aoife Murphy")
    opp = User(
        id=uuid4(),
        email="opp@ul.ie",
        password_hash="x",
        full_name="Opponent",
        role=UserRole.PLAYER.value,
    )
    db.add(opp)
    opp_team = Team(id=uuid4(), tournament_id=t.id, name="Opp Pair")
    db.add(opp_team)
    db.flush()
    my_team = db.query(Team).filter(Team.tournament_id == t.id, Team.name == "Aoife Murphy").one()
    db.add(
        Match(
            id=uuid4(),
            tournament_id=t.id,
            round="GROUP_A",
            stage="GROUP",
            court_number=2,
            scheduled_start=datetime(2026, 11, 18, 10, 0, tzinfo=timezone.utc),
            team_a_id=my_team.id,
            team_b_id=opp_team.id,
            status=MatchStatus.SCHEDULED.value,
            sort_order=1,
        )
    )
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        status = send_reminder_to_user(db, t, player)
        assert status == "sent"
        kwargs = mock_send.call_args.kwargs
        assert kwargs["subject"] == "See you · UL Open"
        assert "park at the side gate" in kwargs["text"]
        # Custom body has no {schedule}, so the auto schedule block is still appended
        assert "Your schedule" in kwargs["text"]
        assert "vs Opp Pair" in kwargs["text"]
        assert "Court 2" in kwargs["text"]
        assert "Your schedule" in kwargs["html_body"]
        # Custom body without link placeholders still gets Useful links appended
        assert "Useful links" in kwargs["text"]
        assert "/fixtures" in kwargs["text"]
        assert "/padel-rules" in kwargs["text"]
        assert "#tour-rules" in kwargs["text"]
        assert "Useful links" in kwargs["html_body"]


def test_schedule_and_time_placeholders_inline_per_player():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    t.reminder_body = (
        "Hi {name}, first match at {time}.\n"
        "Your matches:\n"
        "{schedule}\n"
        "Get the app: {app}"
    )
    player = _add_paid_player(db, t, email="ph@ul.ie", name="Place Holder")
    opp_team = Team(id=uuid4(), tournament_id=t.id, name="Rivals")
    db.add(opp_team)
    db.flush()
    my_team = db.query(Team).filter(Team.tournament_id == t.id, Team.name == "Place Holder").one()
    db.add(
        Match(
            id=uuid4(),
            tournament_id=t.id,
            round="GROUP_A",
            stage="GROUP",
            court_number=3,
            scheduled_start=datetime(2026, 11, 18, 11, 0, tzinfo=timezone.utc),
            team_a_id=my_team.id,
            team_b_id=opp_team.id,
            status=MatchStatus.SCHEDULED.value,
            sort_order=1,
        )
    )
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        assert send_reminder_to_user(db, t, player) == "sent"
        text = mock_send.call_args.kwargs["text"]
        assert "Hi Place," in text or "Hi Place" in text
        assert "first match at 11:00" in text
        assert "vs Rivals" in text
        assert "Court 3" in text
        assert "apps.apple.com" in text
        # Inline {schedule} should not also append the automatic "Your schedule" block
        assert text.count("vs Rivals") == 1


def test_schedule_sort_handles_naive_datetimes():
    db = _session()
    tomorrow = ireland_today() + timedelta(days=1)
    _, t = _seed_tournament(db, event_date=tomorrow)
    player = _add_paid_player(db, t, email="naive@ul.ie", name="Naive Time")
    my_team = db.query(Team).filter(Team.tournament_id == t.id, Team.name == "Naive Time").one()
    opp_team = Team(id=uuid4(), tournament_id=t.id, name="Other")
    db.add(opp_team)
    db.flush()
    db.add(
        Match(
            id=uuid4(),
            tournament_id=t.id,
            round="GROUP_A",
            stage="GROUP",
            court_number=1,
            # Naive timestamp (as some DBs may return)
            scheduled_start=datetime(2026, 11, 18, 9, 30),
            team_a_id=my_team.id,
            team_b_id=opp_team.id,
            status=MatchStatus.SCHEDULED.value,
            sort_order=0,
        )
    )
    db.commit()

    with patch("app.services.reminders.send_email", return_value=True) as mock_send:
        assert send_reminder_to_user(db, t, player) == "sent"
        assert "vs Other" in mock_send.call_args.kwargs["text"]
        assert "09:30" in mock_send.call_args.kwargs["text"] or "9:30" in mock_send.call_args.kwargs["text"]
