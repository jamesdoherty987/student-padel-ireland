"""Fill the app with demo players for local rankings / browse testing.

Mostly Irish names, with a minority from other countries. Each player gets a
university and a mid-range Elo (nothing extreme). Idempotent by email.

Emails look like real Gmail addresses: firstname.lastnameNN@gmail.com

Usage (from backend/ with venv active):

    PYTHONPATH=. python scripts/seed_players.py
    PYTHONPATH=. python scripts/seed_players.py -n 120 --replace
    PYTHONPATH=. python scripts/seed_players.py --password player12345
"""

from __future__ import annotations

import argparse
import random
import re

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.seed import IRISH_UNIVERSITIES, _ensure_universities
from app.db.session import SessionLocal, init_db
from app.models import Ranking, University, User, UserRole
from app.services.accounts import purge_user
from app.services.rating import INITIAL_RATING, _recompute_ireland_ranks

# Shared login for every seeded player (local demo only).
DEFAULT_PASSWORD = "player12345"
EMAIL_DOMAIN = "gmail.com"
# Marker so we can find & replace prior runs (not shown as a profile bio).
DEMO_SEED_BIO = "demo-seed"

# ~75% Irish; rest from countries common among Irish uni students / padel scenes.
IRISH_FIRST = (
    "Aoife", "Aisling", "Ciara", "Niamh", "Orla", "Saoirse", "Roisin", "Maeve",
    "Eimear", "Clodagh", "Sinead", "Grainne", "Fiona", "Laoise", "Sorcha", "Aine",
    "Caoimhe", "Bronagh", "Deirdre", "Muireann", "Nuala", "Siobhan", "Tara", "Una",
    "Conor", "Cian", "Oisin", "Sean", "Padraig", "Ciaran", "Eoin", "Darragh",
    "Fionn", "Rory", "Tadhg", "Cathal", "Niall", "Cormac", "Diarmuid", "Ruairi",
    "Liam", "Jack", "James", "Luke", "Noah", "Daniel", "Adam", "Harry",
    "Emma", "Chloe", "Sophie", "Grace", "Lily", "Amy", "Kate", "Sarah",
    "Molly", "Ellie", "Anna", "Lucy", "Hannah", "Leah", "Eva", "Mia",
    "Tom", "Ben", "Sam", "Max", "Josh", "Ryan", "Alex", "Mark",
)

IRISH_LAST = (
    "Murphy", "Kelly", "Byrne", "Ryan", "O'Brien", "O'Connor", "O'Sullivan",
    "Walsh", "O'Neill", "McCarthy", "Gallagher", "Doyle", "Kennedy", "Lynch",
    "Murray", "Quinn", "Moore", "McGrath", "Brennan", "Burke", "Daly", "Carroll",
    "Duffy", "Farrell", "Fitzgerald", "Fitzpatrick", "Flynn", "Hayes", "Healy",
    "Higgins", "Hogan", "Keane", "Kavanagh", "Kenny", "Maguire", "Maher",
    "McDonnell", "McMahon", "Nolan", "Power", "Reilly", "Roche", "Sheehan",
    "Smyth", "Tobin", "Whelan", "White", "Doherty", "Dunne", "Collins",
)

# (first, last, country_tag used only for variety)
INTL_NAMES = (
    ("Carlos", "Garcia", "es"),
    ("Lucia", "Fernandez", "es"),
    ("Diego", "Martinez", "es"),
    ("Sofia", "Lopez", "es"),
    ("Pablo", "Sanchez", "es"),
    ("Elena", "Ruiz", "es"),
    ("Mateo", "Jimenez", "es"),
    ("Hugo", "Moreno", "es"),
    ("Pierre", "Dupont", "fr"),
    ("Camille", "Martin", "fr"),
    ("Julien", "Bernard", "fr"),
    ("Chloe", "Petit", "fr"),
    ("Lucas", "Moreau", "fr"),
    ("Joao", "Silva", "pt"),
    ("Ines", "Santos", "pt"),
    ("Miguel", "Ferreira", "pt"),
    ("Beatriz", "Costa", "pt"),
    ("Piotr", "Kowalski", "pl"),
    ("Anna", "Nowak", "pl"),
    ("Jakub", "Wisniewski", "pl"),
    ("Zuzanna", "Wojcik", "pl"),
    ("Lars", "Andersen", "dk"),
    ("Freja", "Nielsen", "dk"),
    ("Erik", "Johansson", "se"),
    ("Maja", "Lindberg", "se"),
    ("Marco", "Rossi", "it"),
    ("Giulia", "Bianchi", "it"),
    ("Ahmed", "Hassan", "eg"),
    ("Yara", "Khalil", "lb"),
    ("Wei", "Chen", "cn"),
    ("Mei", "Wang", "cn"),
    ("Arjun", "Patel", "in"),
    ("Priya", "Sharma", "in"),
    ("Omar", "Alami", "ma"),
    ("Nina", "Petrovic", "rs"),
    ("Tomas", "Novak", "cz"),
    ("Hannah", "Mueller", "de"),
    ("Felix", "Schmidt", "de"),
    ("Emma", "Bakker", "nl"),
    ("Noah", "de Vries", "nl"),
)

UNI_SLUGS = [slug for _, _, slug in IRISH_UNIVERSITIES]

# Mid-pack Elo: beginners / casuals around 1400, solid club ~1550, strong ~1620.
RATING_MIN = 1380
RATING_MAX = 1620


def _local_part(full_name: str) -> str:
    """firstname.lastname — strip accents-ish punctuation, keep dots between parts."""
    parts = [re.sub(r"[^a-z0-9]", "", p.lower().replace("'", "")) for p in full_name.split()]
    parts = [p for p in parts if p]
    return ".".join(parts) or "player"


def _email_for(full_name: str, number: int) -> str:
    return f"{_local_part(full_name)}{number}@{EMAIL_DOMAIN}"


def _pick_names(rng: random.Random, count: int) -> list[tuple[str, str]]:
    """Return (full_name, origin) where origin is 'ie' or a country tag."""
    names: list[tuple[str, str]] = []
    irish_n = max(1, int(count * 0.78))

    used: set[str] = set()
    while len(names) < irish_n:
        first = rng.choice(IRISH_FIRST)
        last = rng.choice(IRISH_LAST)
        full = f"{first} {last}"
        if full in used:
            continue
        used.add(full)
        names.append((full, "ie"))

    intl_pool = list(INTL_NAMES)
    rng.shuffle(intl_pool)
    i = 0
    while len(names) < count:
        first, last, tag = intl_pool[i % len(intl_pool)]
        full = f"{first} {last}"
        if full in used:
            full = f"{first} {last} {i // len(intl_pool) + 2}"
        used.add(full)
        names.append((full, tag))
        i += 1

    rng.shuffle(names)
    return names[:count]


def _rating_bundle(rng: random.Random) -> tuple[int, int, int, int]:
    """points, matches_played, wins, losses — correlated so stronger players have more wins."""
    points = int(rng.gauss(INITIAL_RATING, 55))
    points = max(RATING_MIN, min(RATING_MAX, points))

    matches = rng.randint(2, 28)
    win_p = 0.35 + (points - RATING_MIN) / (RATING_MAX - RATING_MIN) * 0.35
    wins = sum(1 for _ in range(matches) if rng.random() < win_p)
    losses = matches - wins
    return points, matches, wins, losses


def _reassign_anchor(db: Session) -> User:
    """Any non-demo user to reassign FK ownership when purging seed accounts."""
    anchor = (
        db.query(User)
        .filter(User.bio.is_(None) | (User.bio != DEMO_SEED_BIO))
        .filter(~User.email.like("%@seed.studentpadel.ie"))
        .order_by(User.created_at.asc())
        .first()
    )
    if not anchor:
        raise SystemExit("No non-seed user found to reassign ownership when purging.")
    return anchor


def _remove_previous_seeds(db: Session) -> int:
    """Delete old seed.studentpadel.ie accounts and any prior demo-seed Gmail batch."""
    old = (
        db.query(User)
        .filter(
            (User.email.like("%@seed.studentpadel.ie"))
            | (User.bio == DEMO_SEED_BIO)
        )
        .all()
    )
    if not old:
        return 0
    anchor = _reassign_anchor(db)
    for user in old:
        purge_user(db, user, reassign_to=anchor)
    db.commit()
    return len(old)


def seed_players(count: int, password: str, seed: int | None, *, replace: bool) -> None:
    init_db()
    db = SessionLocal()
    rng = random.Random(seed)

    try:
        _ensure_universities(db)
        unis = {u.slug: u for u in db.query(University).all()}
        if not unis:
            raise SystemExit("No universities found — seed failed.")

        removed = 0
        if replace:
            removed = _remove_previous_seeds(db)
            print(f"Removed {removed} previous seed players.")

        pw_hash = hash_password(password)
        names = _pick_names(rng, count)
        created = 0
        skipped = 0
        used_emails: set[str] = {e for (e,) in db.query(User.email).all()}

        for full_name, _origin in names:
            # Try a few number suffixes until the Gmail local-part is free
            email = None
            for _ in range(40):
                number = rng.randint(1, 9999)
                candidate = _email_for(full_name, number)
                if candidate not in used_emails:
                    email = candidate
                    break
            if email is None:
                skipped += 1
                continue
            if db.query(User).filter(User.email == email).first():
                skipped += 1
                continue

            uni = unis[rng.choice(UNI_SLUGS)]
            points, matches, wins, losses = _rating_bundle(rng)
            tournaments = rng.randint(0, max(1, matches // 4))

            user = User(
                email=email,
                password_hash=pw_hash,
                full_name=full_name,
                role=UserRole.PLAYER.value,
                university_id=uni.id,
                phone=f"+35387{rng.randint(1000000, 9999999)}",
                student_number=str(rng.randint(20180000, 20259999)),
                bio=DEMO_SEED_BIO,
            )
            db.add(user)
            db.flush()
            db.add(
                Ranking(
                    user_id=user.id,
                    points=points,
                    matches_played=matches,
                    wins=wins,
                    losses=losses,
                    tournaments_played=tournaments,
                )
            )
            used_emails.add(email)
            created += 1

        if created:
            _recompute_ireland_ranks(db)
            db.commit()

        print(
            f"Seeded {created} players "
            f"({skipped} skipped). "
            f"Password for all: {password}"
        )
        if created:
            sample = (
                db.query(User)
                .filter(User.bio == DEMO_SEED_BIO)
                .order_by(User.email)
                .limit(3)
                .all()
            )
            for u in sample:
                r = db.query(Ranking).filter(Ranking.user_id == u.id).first()
                uni = db.query(University).filter(University.id == u.university_id).first()
                print(
                    f"  e.g. {u.full_name} <{u.email}> · "
                    f"{uni.short_name if uni else '?'} · {r.points if r else '?'} pts"
                )
    finally:
        db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Seed demo players with Irish + intl names")
    p.add_argument("-n", type=int, default=80, help="Number of players to ensure (default 80)")
    p.add_argument("--password", default=DEFAULT_PASSWORD, help="Shared password for seeded users")
    p.add_argument("--seed", type=int, default=42, help="RNG seed for reproducible names/ratings")
    p.add_argument(
        "--replace",
        action="store_true",
        help="Delete previous seed.studentpadel.ie / demo-seed players first",
    )
    args = p.parse_args()
    if args.n < 1:
        raise SystemExit("-n must be at least 1")
    seed_players(args.n, args.password, args.seed, replace=args.replace)
