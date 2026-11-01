"""Seed Irish universities + demo accounts for local development.

In production (ENVIRONMENT=production), demo users are NOT created unless
SEED_DEMO_DATA=true. Set ADMIN_EMAIL + ADMIN_PASSWORD for the sole platform admin
(required in production; also used in development when set).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
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

# Signup / browse order: Limerick campuses first, then the rest A–Z by name in the API.
IRISH_UNIVERSITIES = [
    ("University of Limerick", "UL", "ul"),
    ("Technological University of the Shannon", "TUS", "tus"),
    ("Mary Immaculate College", "MIC", "mic"),
    ("Dublin City University", "DCU", "dcu"),
    ("Maynooth University", "MU", "maynooth"),
    ("South East Technological University", "SETU", "setu"),
    ("Technological University Dublin", "TU Dublin", "tud"),
    ("Trinity College Dublin", "Trinity", "trinity"),
    ("University College Cork", "UCC", "ucc"),
    ("University College Dublin", "UCD", "ucd"),
    ("University of Galway", "UG", "galway"),
]

# Shown first on signup (by slug). Keep in sync with IRISH_UNIVERSITIES order above.
PREFERRED_UNIVERSITY_SLUGS = ("ul", "tus", "mic")

DEMO_MATES = (
    ("sara@ucc.ie", "Sara Buckley", 1540, "ucc"),
    ("tom@ucd.ie", "Tom Ryan", 1480, "ucd"),
    ("nia@trinity.ie", "Nia Walsh", 1510, "trinity"),
)

# Local demo defaults when ADMIN_* env vars are unset
_DEMO_ADMIN_EMAIL = "admin@studentpadelireland.ie"
_DEMO_ADMIN_PASSWORD = "admin12345"


def _ensure_universities(db: Session) -> None:
    """Insert any missing universities (idempotent - safe on existing DBs)."""
    existing = {u.slug for u in db.query(University).all()}
    added = 0
    for name, short, slug in IRISH_UNIVERSITIES:
        if slug in existing:
            continue
        db.add(University(name=name, short_name=short, slug=slug))
        added += 1
    if added:
        db.commit()
        print(f"Seeded {added} Irish universit{'y' if added == 1 else 'ies'}.")


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


def _admin_credentials() -> tuple[str, str, str] | None:
    """Return (email, password, name) from env, or demo defaults when seeding demo data."""
    settings = get_settings()
    email = (settings.admin_email or "").strip().lower()
    password = settings.admin_password or ""
    name = (settings.admin_name or "Platform Admin").strip() or "Platform Admin"

    if email and password:
        if len(password) < 10:
            print("ADMIN_PASSWORD must be at least 10 characters - skipping admin sync.")
            return None
        return email, password, name

    if settings.should_seed_demo():
        return _DEMO_ADMIN_EMAIL, _DEMO_ADMIN_PASSWORD, "Platform Admin"

    return None


def ensure_single_admin(db: Session) -> None:
    """Create/update the sole platform admin from ADMIN_EMAIL / ADMIN_PASSWORD.

    Demotes any other ADMIN role rows to PLAYER. Credentials always come from env
    (or local demo defaults when SEED_DEMO_DATA is on and env is unset).
    """
    creds = _admin_credentials()
    if not creds:
        if db.query(User).count() == 0:
            print(
                "No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the admin account, "
                "or SEED_DEMO_DATA=true for local-style demo accounts."
            )
        return

    email, password, name = creds
    admin = db.query(User).filter(User.email == email).first()

    if not admin:
        # Prefer reclaiming a lone existing admin (e.g. email change via env)
        existing_admins = (
            db.query(User).filter(User.role == UserRole.ADMIN.value, User.is_active.is_(True)).all()
        )
        if len(existing_admins) == 1:
            admin = existing_admins[0]
            admin.email = email
        else:
            admin = User(
                email=email,
                password_hash=hash_password(password),
                full_name=name,
                role=UserRole.ADMIN.value,
            )
            db.add(admin)
            db.flush()
            if not db.query(Ranking).filter(Ranking.user_id == admin.id).first():
                db.add(Ranking(user_id=admin.id, points=INITIAL_RATING))
            print(f"Created admin account: {email}")

    changed = False
    if admin.email != email:
        admin.email = email
        changed = True
    if admin.full_name != name and (get_settings().admin_name or "").strip():
        admin.full_name = name
        changed = True
    if admin.role != UserRole.ADMIN.value:
        admin.role = UserRole.ADMIN.value
        changed = True
    if not admin.is_active:
        admin.is_active = True
        changed = True
    if admin.is_suspended:
        admin.is_suspended = False
        changed = True
    if getattr(admin, "must_set_password", False):
        admin.must_set_password = False
        changed = True
    if not verify_password(password, admin.password_hash):
        admin.password_hash = hash_password(password)
        changed = True
        print(f"Synced admin password from env for {email}")

    # Exactly one admin
    others = (
        db.query(User)
        .filter(User.role == UserRole.ADMIN.value, User.id != admin.id)
        .all()
    )
    for other in others:
        other.role = UserRole.PLAYER.value
        changed = True
        print(f"Demoted extra admin to player: {other.email}")

    if changed:
        db.commit()
        print(f"Admin account ready: {email}")


def _seed_demo_accounts(db: Session) -> None:
    settings = get_settings()
    admin_email = (settings.admin_email or "").strip().lower() or _DEMO_ADMIN_EMAIL

    if (
        db.query(User)
        .filter(
            User.email.in_(
                [
                    admin_email,
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
        ensure_single_admin(db)
        return

    ul = db.query(University).filter(University.slug == "ul").first()
    password = settings.admin_password or _DEMO_ADMIN_PASSWORD
    admin = User(
        email=admin_email,
        password_hash=hash_password(password),
        full_name=(settings.admin_name or "Platform Admin").strip() or "Platform Admin",
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
    ensure_single_admin(db)
    print("Seeded universities, demo users, and friends.")


def seed_if_empty() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        _ensure_universities(db)

        if settings.should_seed_demo():
            _seed_demo_accounts(db)
            return

        # Production-safe path: universities + sole admin from env
        ensure_single_admin(db)
    finally:
        db.close()
