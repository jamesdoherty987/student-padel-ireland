from datetime import time, timedelta
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

    from sqlalchemy.orm import joinedload

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
