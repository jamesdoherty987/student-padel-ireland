"""Seed Irish universities + demo accounts for local development."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Friendship,
    FriendshipStatus,
    Ranking,
    Tournament,
    TournamentStatus,
    University,
    User,
    UserRole,
)
from app.services.rating import INITIAL_RATING

IRISH_UNIVERSITIES = [
    ("University of Limerick", "UL", "ul"),
    ("University College Cork", "UCC", "ucc"),
    ("University College Dublin", "UCD", "ucd"),
    ("Trinity College Dublin", "Trinity", "trinity"),
    ("Technological University of the Shannon", "TUS", "tus"),
    ("Dublin City University", "DCU", "dcu"),
    ("Maynooth University", "MU", "maynooth"),
    ("University of Galway", "UG", "galway"),
    ("Technological University Dublin", "TU Dublin", "tud"),
    ("South East Technological University", "SETU", "setu"),
]

DEMO_MATES = (
    ("sara@ucc.ie", "Sara Buckley", 1540, "ucc"),
    ("tom@ucd.ie", "Tom Ryan", 1480, "ucd"),
    ("nia@trinity.ie", "Nia Walsh", 1510, "trinity"),
)


def _ensure_demo_friends(db: Session) -> None:
    """Backfill community demo mates + friendships on existing local DBs."""
    player = db.query(User).filter(User.email == "james@ul.ie").first()
    if not player:
        return
    created = False
    for email, name, pts, uni_slug in DEMO_MATES:
        mate = db.query(User).filter(User.email == email).first()
        if not mate:
            uni = db.query(University).filter(University.slug == uni_slug).first()
            mate = User(
                email=email,
                password_hash=hash_password("player12345"),
                full_name=name,
                role=UserRole.PLAYER.value,
                university_id=uni.id if uni else None,
            )
            db.add(mate)
            db.flush()
            db.add(Ranking(user_id=mate.id, points=pts, matches_played=3, wins=2, losses=1))
            created = True
        existing = (
            db.query(Friendship)
            .filter(
                (
                    (Friendship.requester_id == player.id)
                    & (Friendship.addressee_id == mate.id)
                )
                | (
                    (Friendship.requester_id == mate.id)
                    & (Friendship.addressee_id == player.id)
                )
            )
            .first()
        )
        if not existing:
            db.add(
                Friendship(
                    requester_id=player.id,
                    addressee_id=mate.id,
                    status=FriendshipStatus.ACCEPTED.value,
                )
            )
            created = True
        elif existing.status != FriendshipStatus.ACCEPTED.value:
            existing.status = FriendshipStatus.ACCEPTED.value
            created = True
    if created:
        db.commit()
        print("Backfilled demo community friends for james@ul.ie")


def _ensure_limerick_open(db: Session) -> None:
    """Ensure the Limerick Open tournament exists (idempotent for existing DBs)."""
    existing = (
        db.query(Tournament)
        .filter(Tournament.slug.in_(("limerick-open", "limerick-2026")))
        .first()
    )
    organiser = db.query(User).filter(User.email == "organiser@studentpadelireland.ie").first()
    admin = db.query(User).filter(User.role == UserRole.ADMIN.value).first()
    owner = organiser or admin
    if not owner:
        return

    if existing:
        changed = False
        if existing.name != "Limerick Open":
            existing.name = "Limerick Open"
            changed = True
        if existing.slug != "limerick-open":
            clash = db.query(Tournament).filter(Tournament.slug == "limerick-open").first()
            if not clash:
                existing.slug = "limerick-open"
                changed = True
        if changed:
            db.commit()
            print("Updated seeded tournament to Limerick Open")
        return

    event_day = date.today() + timedelta(days=21)
    t = Tournament(
        name="Limerick Open",
        slug="limerick-open",
        location="Limerick",
        venue="UL Padel Centre",
        event_date=event_day,
        start_time=time(10, 0),
        number_of_courts=6,
        entry_fee_cents=5000,
        max_teams=48,
        registration_deadline=datetime.combine(
            event_day - timedelta(days=3), time(23, 59), tzinfo=timezone.utc
        ),
        format="GROUP_KNOCKOUT",
        rules="Best of 3 sets. Golden point on deuce. Student ID required on the day. Entry is per doubles team.",
        description="Ireland's student padel open — doubles teams, groups then knockout.",
        status=TournamentStatus.REGISTRATION_OPEN.value,
        organiser_id=owner.id,
        match_duration_minutes=20,
        group_size=4,
        teams_advance_per_group=2,
    )
    db.add(t)
    db.flush()
    from app.models import Court

    for i in range(1, 7):
        db.add(Court(tournament_id=t.id, name=f"Court {i}", court_number=i))
    db.commit()
    print("Seeded Limerick Open tournament.")


def seed_if_empty() -> None:
    db = SessionLocal()
    try:
        if db.query(University).count() == 0:
            for name, short, slug in IRISH_UNIVERSITIES:
                db.add(University(name=name, short_name=short, slug=slug))
            db.commit()

        if (
            db.query(User)
            .filter(
                User.email.in_(
                    [
                        "admin@studentpadelireland.ie",
                        "admin@irishstudentpadel.ie",
                    ]
                )
            )
            .first()
        ):
            # Migrate old demo emails if present
            for old, new in (
                ("admin@irishstudentpadel.ie", "admin@studentpadelireland.ie"),
                ("organiser@irishstudentpadel.ie", "organiser@studentpadelireland.ie"),
            ):
                u = db.query(User).filter(User.email == old).first()
                if u and not db.query(User).filter(User.email == new).first():
                    u.email = new
            db.commit()
            _ensure_demo_friends(db)
            _ensure_limerick_open(db)
            return

        ul = db.query(University).filter(University.slug == "ul").first()
        admin = User(
            email="admin@studentpadelireland.ie",
            password_hash=hash_password("admin12345"),
            full_name="Platform Admin",
            role=UserRole.ADMIN.value,
        )
        organiser = User(
            email="organiser@studentpadelireland.ie",
            password_hash=hash_password("organiser123"),
            full_name="Aoife Organiser",
            role=UserRole.ORGANISER.value,
            university_id=ul.id if ul else None,
        )
        player = User(
            email="james@ul.ie",
            password_hash=hash_password("player12345"),
            full_name="James Doherty",
            role=UserRole.PLAYER.value,
            university_id=ul.id if ul else None,
            phone="+353870000001",
            student_number="20123456",
        )
        db.add_all([admin, organiser, player])
        db.flush()
        for u in (admin, organiser, player):
            pts = 1620 if u.email.startswith("james") else INITIAL_RATING
            db.add(
                Ranking(
                    user_id=u.id,
                    points=pts,
                    rank_ireland=1 if u.email.startswith("james") else None,
                    matches_played=8 if u.email.startswith("james") else 0,
                    wins=5 if u.email.startswith("james") else 0,
                    losses=3 if u.email.startswith("james") else 0,
                )
            )

        db.commit()
        _ensure_demo_friends(db)
        _ensure_limerick_open(db)
        print("Seeded universities, demo users, friends, and Limerick Open.")
    finally:
        db.close()
