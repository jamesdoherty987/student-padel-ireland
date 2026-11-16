from datetime import time, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import joinedload, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import deps
from app.db.session import get_db
from app.main import app
from app.models import (
    Base,
    PaymentStatus,
    PlayFormat,
    Registration,
    Team,
    TeamPlayer,
    Tournament,
    TournamentStatus,
    User,
    UserRole,
)
from app.services.reminders import ireland_today


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_resolve_partner_allow_missing_and_create_stub():
    from app.api.tournaments import _resolve_partner_from_body

    db = _session()
    partner, needs_signup, notify = _resolve_partner_from_body(
        db,
        partner_user_id=None,
        partner_email=None,
        partner_name="",
        allow_missing=True,
    )
    assert partner is None
    assert needs_signup is False
    assert notify is False

    partner, needs_signup, notify = _resolve_partner_from_body(
        db,
        partner_user_id=None,
        partner_email="new.partner@ex.com",
        partner_name="New Partner",
        allow_missing=False,
    )
    assert partner is not None
    assert partner.email == "new.partner@ex.com"
    assert needs_signup is True
    assert notify is True
    assert partner.must_set_password is True


def test_team_needs_partner_flag():
    from app.api.tournaments import _team_out

    db = _session()
    org = User(
        id=uuid4(),
        email="org@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    captain = User(
        id=uuid4(),
        email="cap@ex.com",
        password_hash="x",
        full_name="Captain",
        role=UserRole.PLAYER.value,
    )
    db.add_all([org, captain])
    t = Tournament(
        id=uuid4(),
        name="Edit Cup",
        slug=f"edit-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=7),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
    )
    db.add(t)
    db.flush()
    team = Team(id=uuid4(), tournament_id=t.id, name="Solo Cap")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=captain.id, slot=1))
    db.add(
        Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=0,
            currency="EUR",
        )
    )
    db.commit()

    team = (
        db.query(Team)
        .options(
            joinedload(Team.members).joinedload(TeamPlayer.user),
            joinedload(Team.registration),
        )
        .filter(Team.id == team.id)
        .one()
    )
    out = _team_out(team, db, include_player_details=True, singles=False)
    assert out.needs_partner is True
    assert len(out.players) == 1
    assert out.players[0].email == "cap@ex.com"


def _doubles_fixture(db):
    org = User(
        id=uuid4(),
        email=f"org-{uuid4().hex[:6]}@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    p1 = User(
        id=uuid4(),
        email="alice@ex.com",
        password_hash="x",
        full_name="Alice",
        role=UserRole.PLAYER.value,
        phone="111",
        student_number="S1",
        must_set_password=False,
    )
    p2 = User(
        id=uuid4(),
        email="bob@ex.com",
        password_hash="x",
        full_name="Bob",
        role=UserRole.PLAYER.value,
        must_set_password=True,
    )
    db.add_all([org, p1, p2])
    t = Tournament(
        id=uuid4(),
        name="Patch Cup",
        slug=f"patch-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=7),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
        play_format=PlayFormat.DOUBLES.value,
        entry_fee_cents=4000,
        max_teams=16,
    )
    db.add(t)
    db.flush()
    team = Team(id=uuid4(), tournament_id=t.id, name="A / B")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=p1.id, slot=1, invitation_accepted=True))
    db.add(TeamPlayer(team_id=team.id, user_id=p2.id, slot=2, invitation_accepted=True))
    db.add(
        Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=0,
            currency="EUR",
            stripe_payment_intent_id="free_entry",
        )
    )
    db.commit()
    return org, t, team, p1, p2


def test_organiser_update_player_clears_phone_and_blocks_teammate_email(monkeypatch):
    db = _session()
    org, t, team, p1, p2 = _doubles_fixture(db)

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[deps.get_current_user] = lambda: org
    monkeypatch.setattr("app.api.tournaments.send_email", lambda **kwargs: True)

    client = TestClient(app)
    try:
        cleared = client.patch(
            f"/api/tournaments/{t.id}/teams/{team.id}/players/{p1.id}",
            json={"phone": None, "student_number": None},
        )
        assert cleared.status_code == 200, cleared.text
        db.refresh(p1)
        assert p1.phone is None
        assert p1.student_number is None

        clash = client.patch(
            f"/api/tournaments/{t.id}/teams/{team.id}/players/{p1.id}",
            json={"email": "bob@ex.com"},
        )
        assert clash.status_code == 400

        renamed = client.patch(
            f"/api/tournaments/{t.id}/teams/{team.id}",
            json={"name": "New Pair"},
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "New Pair"
    finally:
        app.dependency_overrides.clear()


def test_organiser_update_stub_email_resends_for_captain(monkeypatch):
    db = _session()
    org = User(
        id=uuid4(),
        email="orgx@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    stub = User(
        id=uuid4(),
        email="old@ex.com",
        password_hash="x",
        full_name="Stub Cap",
        role=UserRole.PLAYER.value,
        must_set_password=True,
    )
    db.add_all([org, stub])
    t = Tournament(
        id=uuid4(),
        name="Stub Cup",
        slug=f"stub-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=7),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
        play_format=PlayFormat.SINGLES.value,
        entry_fee_cents=2000,
        max_teams=16,
    )
    db.add(t)
    db.flush()
    team = Team(id=uuid4(), tournament_id=t.id, name="Stub Cap")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=stub.id, slot=1, invitation_accepted=True))
    db.add(
        Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=0,
            currency="EUR",
            stripe_payment_intent_id="free_entry",
        )
    )
    db.commit()

    sent: list[str] = []

    def fake_send(**kwargs):
        sent.append(kwargs["to"])
        return True

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[deps.get_current_user] = lambda: org
    monkeypatch.setattr("app.api.tournaments.send_email", fake_send)

    client = TestClient(app)
    try:
        res = client.patch(
            f"/api/tournaments/{t.id}/teams/{team.id}/players/{stub.id}",
            json={"email": "new@ex.com"},
        )
        assert res.status_code == 200, res.text
        db.refresh(stub)
        assert stub.email == "new@ex.com"
        assert "new@ex.com" in sent
    finally:
        app.dependency_overrides.clear()


def test_organiser_add_partner(monkeypatch):
    db = _session()
    org = User(
        id=uuid4(),
        email="orgp@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    cap = User(
        id=uuid4(),
        email="cap2@ex.com",
        password_hash="x",
        full_name="Captain",
        role=UserRole.PLAYER.value,
    )
    db.add_all([org, cap])
    t = Tournament(
        id=uuid4(),
        name="AddP Cup",
        slug=f"addp-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=7),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
        play_format=PlayFormat.DOUBLES.value,
        entry_fee_cents=4000,
        max_teams=16,
    )
    db.add(t)
    db.flush()
    team = Team(id=uuid4(), tournament_id=t.id, name="Needs Partner")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=cap.id, slot=1, invitation_accepted=True))
    db.add(
        Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=0,
            currency="EUR",
            stripe_payment_intent_id="free_entry",
        )
    )
    db.commit()

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[deps.get_current_user] = lambda: org
    monkeypatch.setattr("app.api.tournaments.send_email", lambda **kwargs: True)

    client = TestClient(app)
    try:
        res = client.post(
            f"/api/tournaments/{t.id}/teams/{team.id}/add-partner",
            json={"partner_email": "partner.new@ex.com", "partner_name": "New Partner"},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["needs_partner"] is False
        assert len(body["players"]) == 2
    finally:
        app.dependency_overrides.clear()
