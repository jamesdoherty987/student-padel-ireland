import json
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
    TournamentRegistrationAnswer,
    TournamentStatus,
    User,
    UserRole,
)
from app.schemas import CustomAnswerIn, RegistrationFieldIn
from app.services.registration_fields import (
    answers_for_team,
    list_fields,
    save_answers_for_registration,
    sync_registration_fields,
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


def _tournament(db) -> Tournament:
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
        name="Field Cup",
        slug=f"field-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=14),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
    )
    db.add(t)
    db.flush()
    return t


def test_sync_and_save_player_select_answers():
    db = _session()
    t = _tournament(db)
    sync_registration_fields(
        db,
        t.id,
        [
            RegistrationFieldIn(
                label="Jersey size",
                field_type="select",
                options=["S", "M", "L"],
                required=True,
                scope="player",
            )
        ],
    )
    db.commit()
    fields = list_fields(db, t.id)
    assert len(fields) == 1
    assert fields[0].key == "jersey_size"
    assert json.loads(fields[0].options_json) == ["S", "M", "L"]

    captain = User(
        id=uuid4(),
        email="c@ex.com",
        password_hash="x",
        full_name="Captain",
        role=UserRole.PLAYER.value,
    )
    partner = User(
        id=uuid4(),
        email="p@ex.com",
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
        status=PaymentStatus.PAID.value,
        amount_cents=5000,
        currency="EUR",
    )
    db.add(reg)
    db.flush()

    save_answers_for_registration(
        db,
        tournament=t,
        registration_id=reg.id,
        team_id=team.id,
        answers=[
            CustomAnswerIn(field_id=fields[0].id, value="M", slot=1),
            CustomAnswerIn(field_id=fields[0].id, value="l", slot=2),
        ],
        singles=False,
    )
    db.commit()

    team = (
        db.query(Team)
        .filter(Team.id == team.id)
        .one()
    )
    # reload relationships
    from sqlalchemy.orm import joinedload

    team = (
        db.query(Team)
        .options(joinedload(Team.members).joinedload(TeamPlayer.user), joinedload(Team.registration))
        .filter(Team.id == team.id)
        .one()
    )
    outs = answers_for_team(db, team)
    assert len(outs) == 2
    assert {o.value for o in outs} == {"M", "L"}


def test_required_field_rejects_missing():
    db = _session()
    t = _tournament(db)
    sync_registration_fields(
        db,
        t.id,
        [RegistrationFieldIn(label="Meal", field_type="text", required=True, scope="team")],
    )
    db.commit()
    field = list_fields(db, t.id)[0]
    user = User(
        id=uuid4(),
        email="u@ex.com",
        password_hash="x",
        full_name="U",
        role=UserRole.PLAYER.value,
    )
    db.add(user)
    team = Team(id=uuid4(), tournament_id=t.id, name="Solo")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=user.id, slot=1))
    reg = Registration(
        tournament_id=t.id,
        team_id=team.id,
        status=PaymentStatus.PENDING.value,
        amount_cents=0,
        currency="EUR",
    )
    db.add(reg)
    db.flush()

    try:
        save_answers_for_registration(
            db,
            tournament=t,
            registration_id=reg.id,
            team_id=team.id,
            answers=[],
            singles=True,
        )
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "Meal" in str(exc.detail)


def test_sync_accepts_plain_dicts():
    """model_dump() turns nested fields into dicts — sync must still work."""
    db = _session()
    t = _tournament(db)
    sync_registration_fields(
        db,
        t.id,
        [
            {
                "label": "Jersey size",
                "field_type": "select",
                "options": ["S", "M", "L"],
                "required": True,
                "scope": "player",
                "sort_order": 0,
            }
        ],
    )
    db.commit()
    fields = list_fields(db, t.id)
    assert len(fields) == 1
    assert fields[0].label == "Jersey size"


def test_removing_field_deletes_answers():
    db = _session()
    t = _tournament(db)
    sync_registration_fields(
        db,
        t.id,
        [RegistrationFieldIn(label="Note", field_type="text", required=False, scope="team")],
    )
    db.commit()
    field = list_fields(db, t.id)[0]
    user = User(
        id=uuid4(),
        email="n@ex.com",
        password_hash="x",
        full_name="N",
        role=UserRole.PLAYER.value,
    )
    db.add(user)
    team = Team(id=uuid4(), tournament_id=t.id, name="T")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=user.id, slot=1))
    reg = Registration(
        tournament_id=t.id,
        team_id=team.id,
        status=PaymentStatus.PAID.value,
        amount_cents=0,
        currency="EUR",
    )
    db.add(reg)
    db.flush()
    save_answers_for_registration(
        db,
        tournament=t,
        registration_id=reg.id,
        team_id=team.id,
        answers=[CustomAnswerIn(field_id=field.id, value="Hello")],
        singles=True,
    )
    db.commit()
    assert db.query(TournamentRegistrationAnswer).count() == 1

    sync_registration_fields(db, t.id, [])
    db.commit()
    assert list_fields(db, t.id) == []
    assert db.query(TournamentRegistrationAnswer).count() == 0


def test_sync_rejects_duplicate_labels():
    db = _session()
    t = _tournament(db)
    try:
        sync_registration_fields(
            db,
            t.id,
            [
                RegistrationFieldIn(label="Jersey size", field_type="text"),
                RegistrationFieldIn(label="jersey size", field_type="text"),
            ],
        )
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "twice" in str(exc.detail).lower()


def test_sync_can_reuse_key_after_removing_field():
    """Deleting then re-adding the same label must not hit unique(key) mid-sync."""
    db = _session()
    t = _tournament(db)
    sync_registration_fields(
        db,
        t.id,
        [RegistrationFieldIn(label="Jersey size", field_type="select", options=["S", "M"], required=True)],
    )
    db.commit()
    old = list_fields(db, t.id)[0]
    assert old.key == "jersey_size"

    sync_registration_fields(
        db,
        t.id,
        [
            RegistrationFieldIn(
                label="Jersey size",
                field_type="select",
                options=["S", "M", "L"],
                required=True,
                scope="player",
            )
        ],
    )
    db.commit()
    fields = list_fields(db, t.id)
    assert len(fields) == 1
    assert fields[0].key == "jersey_size"
    assert fields[0].id != old.id
    assert json.loads(fields[0].options_json) == ["S", "M", "L"]
