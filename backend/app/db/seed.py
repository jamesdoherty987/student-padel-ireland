"""Seed Irish universities + demo accounts for local development."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Ranking,
    Tournament,
    TournamentStatus,
    University,
    User,
    UserRole,
)

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
            db.add(Ranking(user_id=u.id, points=482 if u.email.startswith("james") else 0, rank_ireland=37 if u.email.startswith("james") else None))

        event_day = date.today() + timedelta(days=21)
        t = Tournament(
            name="Limerick Student Padel 2026",
            slug="limerick-2026",
            location="Limerick",
            venue="UL Padel Centre",
            event_date=event_day,
            start_time=time(10, 0),
            number_of_courts=6,
            entry_fee_cents=5000,
            max_teams=48,
            registration_deadline=datetime.combine(event_day - timedelta(days=3), time(23, 59), tzinfo=timezone.utc),
            format="GROUP_KNOCKOUT",
            rules="Best of 3 sets. Golden point on deuce. Student ID required on the day.",
            description="Ireland's premier student padel tournament — groups then knockout.",
            status=TournamentStatus.REGISTRATION_OPEN.value,
            organiser_id=organiser.id,
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
        print("Seeded universities, demo users, and Limerick 2026 tournament.")
    finally:
        db.close()
