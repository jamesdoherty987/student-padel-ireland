"""Seed Irish universities + demo accounts for local development.

In production (ENVIRONMENT=production), demo users are NOT created unless
SEED_DEMO_DATA=true. Set ADMIN_EMAIL + ADMIN_PASSWORD to bootstrap the first admin.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Friendship,
    FriendshipStatus,
    Ranking,
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


def _ensure_universities(db: Session) -> None:
    if db.query(University).count() > 0:
        return
    for name, short, slug in IRISH_UNIVERSITIES:
        db.add(University(name=name, short_name=short, slug=slug))
    db.commit()
    print("Seeded Irish universities.")


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


def _bootstrap_admin_from_env(db: Session) -> None:
    """Create a single admin from ADMIN_EMAIL / ADMIN_PASSWORD when no users exist."""
    settings = get_settings()
    email = (settings.admin_email or "").strip().lower()
    password = settings.admin_password or ""
    if not email or not password:
        print(
            "No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin, "
            "or SEED_DEMO_DATA=true for local-style demo accounts."
        )
        return
    if db.query(User).filter(User.email == email).first():
        return
    if len(password) < 10:
        print("ADMIN_PASSWORD must be at least 10 characters - skipping admin bootstrap.")
        return

    admin = User(
        email=email,
        password_hash=hash_password(password),
        full_name=(settings.admin_name or "Platform Admin").strip(),
        role=UserRole.ADMIN.value,
    )
    db.add(admin)
    db.flush()
    db.add(Ranking(user_id=admin.id, points=INITIAL_RATING))
    db.commit()
    print(f"Bootstrapped admin account: {email}")


def _seed_demo_accounts(db: Session) -> None:
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
        full_name="Aoife Host",
        role=UserRole.PLAYER.value,
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
    print("Seeded universities, demo users, and friends.")


def seed_if_empty() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        _ensure_universities(db)

        if settings.should_seed_demo():
            _seed_demo_accounts(db)
            return

        # Production-safe path: universities only + optional admin bootstrap
        if db.query(User).count() == 0:
            _bootstrap_admin_from_env(db)
    finally:
        db.close()
