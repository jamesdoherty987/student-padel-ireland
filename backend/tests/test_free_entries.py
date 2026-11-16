from datetime import time, timedelta
from uuid import uuid4

from fastapi import HTTPException
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
    TournamentStatus,
    User,
    UserRole,
)
from app.services.free_entries import (
    add_free_entries,
    consume_free_entries_for_registration,
    list_free_entries,
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


def _tournament(db):
    org = User(
        id=uuid4(),
        email=f"org-{uuid4().hex[:6]}@ex.com",
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
        event_date=ireland_today() + timedelta(days=14),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
        entry_fee_cents=5000,
    )
    db.add(t)
    db.flush()
    return t


def test_add_and_list_free_entries():
    db = _session()
    t = _tournament(db)
    added = add_free_entries(
        db,
        tournament_id=t.id,
        emails=[" Cap@Ex.COM ", "partner@ex.com", "cap@ex.com"],
        note="Sponsor",
        created_by_id=None,
    )
    db.commit()
    assert len(added) == 2
    rows = list_free_entries(db, t.id)
    assert [r.email for r in rows] == ["cap@ex.com", "partner@ex.com"]
    assert rows[0].note == "Sponsor"


def test_duplicate_add_rejected():
    db = _session()
    t = _tournament(db)
    add_free_entries(db, tournament_id=t.id, emails=["a@ex.com"], note=None, created_by_id=None)
    db.commit()
    try:
        add_free_entries(db, tournament_id=t.id, emails=["A@ex.com"], note=None, created_by_id=None)
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_consume_when_either_player_listed():
    db = _session()
    t = _tournament(db)
    add_free_entries(
        db,
        tournament_id=t.id,
        emails=["partner@ex.com"],
        note=None,
        created_by_id=None,
    )
    db.commit()

    captain = User(
        id=uuid4(),
        email="captain@ex.com",
        password_hash="x",
        full_name="Captain",
        role=UserRole.PLAYER.value,
    )
    partner = User(
        id=uuid4(),
        email="partner@ex.com",
        password_hash="x",
        full_name="Partner",
        role=UserRole.PLAYER.value,
    )
    db.add_all([captain, partner])
    team = Team(id=uuid4(), tournament_id=t.id, name="Cap / Par")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=captain.id, slot=1))
    db.add(TeamPlayer(team_id=team.id, user_id=partner.id, slot=2))
    reg = Registration(
        tournament_id=t.id,
        team_id=team.id,
        status=PaymentStatus.PENDING.value,
        amount_cents=5000,
        currency="EUR",
    )
    db.add(reg)
    db.flush()

    matched = consume_free_entries_for_registration(
        db, tournament_id=t.id, team=team, registration=reg
    )
    db.commit()
    assert len(matched) == 1
    assert matched[0].email == "partner@ex.com"
    assert matched[0].used_by_registration_id == reg.id

    # Second consume finds nothing
    matched2 = consume_free_entries_for_registration(
        db, tournament_id=t.id, team=team, registration=reg
    )
    assert matched2 == []
