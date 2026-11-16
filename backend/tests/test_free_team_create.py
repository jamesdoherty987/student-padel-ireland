import json
from datetime import time, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import deps
from app.db.session import get_db
from app.main import app
from app.models import (
    Base,
    PaymentStatus,
    PlayFormat,
    Team,
    Tournament,
    TournamentRegistrationField,
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


def test_create_free_team_doubles_with_answers(monkeypatch):
    db = _session()
    org = User(
        id=uuid4(),
        email="org@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    db.add(org)
    t = Tournament(
        id=uuid4(),
        name="Free Cup",
        slug=f"free-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=5),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
        entry_fee_cents=4000,
        max_teams=16,
        play_format=PlayFormat.DOUBLES.value,
    )
    db.add(t)
    db.flush()
    field = TournamentRegistrationField(
        id=uuid4(),
        tournament_id=t.id,
        key="jersey_size",
        label="Jersey size",
        field_type="select",
        options_json=json.dumps(["S", "M", "L"]),
        required=True,
        scope="player",
        sort_order=0,
    )
    db.add(field)
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
            f"/api/tournaments/{t.id}/free-teams",
            json={
                "player1": {"email": "a@ex.com", "full_name": "Alice One"},
                "player2": {"email": "b@ex.com", "full_name": "Bob Two"},
                "note": "Sponsor",
                "custom_answers": [
                    {"field_id": str(field.id), "value": "M", "slot": 1},
                    {"field_id": str(field.id), "value": "L", "slot": 2},
                ],
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["payment_status"] == PaymentStatus.PAID.value
        assert body["payment_via"] == "free_entry"
        assert len(body["players"]) == 2
        answers = body.get("custom_answers") or []
        assert {a["value"] for a in answers} == {"M", "L"}

        team = db.query(Team).filter(Team.tournament_id == t.id).one()
        assert team.registration.status == PaymentStatus.PAID.value

        # Same emails again → already entered
        again = client.post(
            f"/api/tournaments/{t.id}/free-teams",
            json={
                "player1": {"email": "a@ex.com", "full_name": "Alice One"},
                "player2": {"email": "b@ex.com", "full_name": "Bob Two"},
            },
        )
        assert again.status_code == 400

        # Same email for both players
        same = client.post(
            f"/api/tournaments/{t.id}/free-teams",
            json={
                "player1": {"email": "c@ex.com", "full_name": "Cara"},
                "player2": {"email": "C@ex.com", "full_name": "Other"},
            },
        )
        assert same.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_create_free_team_singles(monkeypatch):
    db = _session()
    org = User(
        id=uuid4(),
        email="org2@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    db.add(org)
    t = Tournament(
        id=uuid4(),
        name="Singles Free",
        slug=f"sfree-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=5),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
        entry_fee_cents=2000,
        max_teams=16,
        play_format=PlayFormat.SINGLES.value,
    )
    db.add(t)
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
            f"/api/tournaments/{t.id}/free-teams",
            json={"player1": {"email": "solo@ex.com", "full_name": "Solo Player"}},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["payment_via"] == "free_entry"
        assert len(body["players"]) == 1
    finally:
        app.dependency_overrides.clear()
