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
from app.services.bulk_email import entrant_recipients, send_bulk_email_to_entrants
from app.services.reminders import ireland_today


def _session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_bulk_email_paid_only_and_dedupes(monkeypatch):
    db = _session()
    org = User(
        id=uuid4(),
        email="org@ex.com",
        password_hash="x",
        full_name="Org",
        role=UserRole.PLAYER.value,
    )
    a = User(
        id=uuid4(),
        email="a@ex.com",
        password_hash="x",
        full_name="Alice",
        role=UserRole.PLAYER.value,
    )
    b = User(
        id=uuid4(),
        email="b@ex.com",
        password_hash="x",
        full_name="Bob",
        role=UserRole.PLAYER.value,
    )
    pending = User(
        id=uuid4(),
        email="pending@ex.com",
        password_hash="x",
        full_name="Pat",
        role=UserRole.PLAYER.value,
    )
    db.add_all([org, a, b, pending])
    t = Tournament(
        id=uuid4(),
        name="Mail Cup",
        slug=f"mail-{uuid4().hex[:6]}",
        location="Dublin",
        venue="Hall",
        event_date=ireland_today() + timedelta(days=3),
        start_time=time(10, 0),
        organiser_id=org.id,
        status=TournamentStatus.REGISTRATION_OPEN.value,
    )
    db.add(t)
    db.flush()

    team = Team(id=uuid4(), tournament_id=t.id, name="A / B")
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=a.id, slot=1))
    db.add(TeamPlayer(team_id=team.id, user_id=b.id, slot=2))
    db.add(
        Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=0,
            currency="EUR",
        )
    )

    pending_team = Team(id=uuid4(), tournament_id=t.id, name="Pending")
    db.add(pending_team)
    db.flush()
    db.add(TeamPlayer(team_id=pending_team.id, user_id=pending.id, slot=1))
    db.add(
        Registration(
            tournament_id=t.id,
            team_id=pending_team.id,
            status=PaymentStatus.PENDING.value,
            amount_cents=5000,
            currency="EUR",
        )
    )
    db.commit()

    paid = entrant_recipients(db, t.id, paid_only=True)
    assert {u.email for u in paid} == {"a@ex.com", "b@ex.com"}

    all_entries = entrant_recipients(db, t.id, paid_only=False)
    assert {u.email for u in all_entries} == {"a@ex.com", "b@ex.com", "pending@ex.com"}

    sent_to: list[str] = []

    def fake_send(**kwargs):
        sent_to.append(kwargs["to"])
        return True

    monkeypatch.setattr("app.services.bulk_email.send_email", fake_send)
    monkeypatch.setattr(
        "app.services.bulk_email.get_settings",
        lambda: type("S", (), {"frontend_url": "https://studentpadel.ie"})(),
    )

    result = send_bulk_email_to_entrants(
        db,
        t,
        subject="Parking",
        body="Use the side gate.\n\nSee you soon.",
        paid_only=True,
        reply_to="org@ex.com",
    )
    assert result["recipients"] == 2
    assert result["sent"] == 2
    assert result["failed"] == 0
    assert set(sent_to) == {"a@ex.com", "b@ex.com"}
