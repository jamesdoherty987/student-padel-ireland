"""Create a private dry-run tournament with paid demo teams + known logins.

Idempotent: re-running updates/ensures the same tournament, players, and teams.

Usage (from backend/ with venv active):

    PYTHONPATH=. python scripts/seed_demo_tournament.py
    PYTHONPATH=. python scripts/seed_demo_tournament.py -n 16 --courts 4
    PYTHONPATH=. python scripts/seed_demo_tournament.py --plate   # also enable plate bracket
    PYTHONPATH=. python scripts/seed_demo_tournament.py --reset   # wipe this demo event first

Default layout: 16 doubles teams (32 players), 4 courts, GROUP_KNOCKOUT,
is_official=false (private / invite-only), registration open, all entries PAID.
"""

from __future__ import annotations

import argparse
import secrets
import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.seed import _DEMO_ADMIN_EMAIL, _DEMO_ADMIN_PASSWORD, _ensure_universities
from app.db.session import SessionLocal, init_db
from app.models import (
    Court,
    Group,
    GroupTeam,
    Match,
    MatchScore,
    Payment,
    PaymentStatus,
    PlayFormat,
    Ranking,
    Registration,
    ScoringMode,
    Team,
    TeamPlayer,
    Tournament,
    TournamentFormat,
    TournamentStatus,
    University,
    User,
    UserRole,
)
from app.services.accounts import purge_user
from app.services.rating import INITIAL_RATING

SLUG = "dry-run-demo"
INVITE_CODE = "DRYRUN01"
PASSWORD = "demo12345"
# example.com is accepted by EmailStr (required for /api/auth/login).
EMAIL_DOMAIN = "example.com"


def _admin_login() -> tuple[str, str]:
    settings = get_settings()
    email = (settings.admin_email or "").strip().lower() or _DEMO_ADMIN_EMAIL
    password = settings.admin_password or _DEMO_ADMIN_PASSWORD
    return email, password

# Stable Irish-ish pair names so the draw is readable on court boards.
TEAM_NAMES = (
    "Limerick Lions",
    "Cork Crushers",
    "Dublin Dynamos",
    "Galway Gulls",
    "Belfast Blades",
    "Waterford Waves",
    "Kilkenny Kings",
    "Sligo Smashers",
    "Tralee Tigers",
    "Athlone Aces",
    "Maynooth Mavericks",
    "Trinity Torpedoes",
    "UCD United",
    "UCC Chargers",
    "UL Legends",
    "TUD Titans",
    "DkIT Dashers",
    "MTU Mustangs",
    "SETU Storm",
    "QUB Quicks",
    "NCI Navigators",
    "RCSI Rangers",
    "MIC Magpies",
    "TUS Tornadoes",
    "Griffith Giants",
    "IADT Impalas",
    "Marino Magnets",
    "NCAD Nomads",
    "Ulster Ursas",
    "ATU Avalanche",
    "NUI Galway Gold",
    "Padraig Pair",
)


def _invite_or_fixed(db: Session, preferred: str) -> str:
    taken = (
        db.query(Tournament)
        .filter(Tournament.invite_code == preferred, Tournament.slug != SLUG)
        .first()
    )
    if not taken:
        return preferred
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(40):
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not db.query(Tournament).filter(Tournament.invite_code == code).first():
            return code
    return preferred + secrets.token_hex(1)[:2].upper()


def _ensure_admin_owner(db: Session) -> User:
    """Dry-run events are owned by the platform admin (no organiser accounts)."""
    email, password = _admin_login()
    user = db.query(User).filter(User.email == email).first()
    if user:
        user.password_hash = hash_password(password)
        user.role = UserRole.ADMIN.value
        user.is_active = True
        user.is_suspended = False
        if getattr(user, "must_set_password", False):
            user.must_set_password = False
        return user

    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name="Platform Admin",
        role=UserRole.ADMIN.value,
    )
    db.add(user)
    db.flush()
    db.add(Ranking(user_id=user.id, points=INITIAL_RATING))
    return user


def _player_email(team_i: int, slot: str) -> str:
    # Prefix dryrun- so we don't collide with scripts/seed_demo_teams.py
    return f"dryrun{team_i:02d}{slot}@{EMAIL_DOMAIN}"


def _ensure_player(
    db: Session,
    *,
    email: str,
    full_name: str,
    uni: University | None,
    password_hash: str,
) -> User:
    user = db.query(User).filter(User.email == email).first()
    if user:
        user.password_hash = password_hash
        user.full_name = full_name
        user.role = UserRole.PLAYER.value
        user.is_active = True
        user.is_suspended = False
        if getattr(user, "must_set_password", False):
            user.must_set_password = False
        if uni and not user.university_id:
            user.university_id = uni.id
        return user

    user = User(
        email=email,
        password_hash=password_hash,
        full_name=full_name,
        role=UserRole.PLAYER.value,
        university_id=uni.id if uni else None,
        phone=f"+35387{1000000 + abs(hash(email)) % 9000000}",
        bio="dry-run-demo",
    )
    db.add(user)
    db.flush()
    db.add(Ranking(user_id=user.id, points=INITIAL_RATING))
    return user


def _sync_courts(db: Session, tournament_id, n: int) -> None:
    existing = (
        db.query(Court)
        .filter(Court.tournament_id == tournament_id)
        .order_by(Court.court_number)
        .all()
    )
    by_num = {c.court_number: c for c in existing}
    for i in range(1, n + 1):
        if i in by_num:
            by_num[i].is_active = True
            by_num[i].name = f"Court {i}"
        else:
            db.add(Court(tournament_id=tournament_id, name=f"Court {i}", court_number=i))
    for num, court in by_num.items():
        if num > n:
            db.delete(court)


def _wipe_tournament(db: Session, t: Tournament) -> None:
    """Remove fixtures / entries so the dry-run can be rebuilt cleanly."""
    match_ids = [mid for (mid,) in db.query(Match.id).filter(Match.tournament_id == t.id).all()]
    if match_ids:
        # Clear next_match links first so SQLite/Postgres FK deletes succeed.
        db.query(Match).filter(Match.tournament_id == t.id).update(
            {Match.next_match_id: None, Match.next_match_slot: None},
            synchronize_session=False,
        )
        db.query(MatchScore).filter(MatchScore.match_id.in_(match_ids)).delete(synchronize_session=False)
        db.query(Match).filter(Match.tournament_id == t.id).delete(synchronize_session=False)

    group_ids = [gid for (gid,) in db.query(Group.id).filter(Group.tournament_id == t.id).all()]
    if group_ids:
        db.query(GroupTeam).filter(GroupTeam.group_id.in_(group_ids)).delete(synchronize_session=False)
        db.query(Group).filter(Group.tournament_id == t.id).delete(synchronize_session=False)

    team_ids = [tid for (tid,) in db.query(Team.id).filter(Team.tournament_id == t.id).all()]
    if team_ids:
        db.query(Payment).filter(Payment.tournament_id == t.id).delete(synchronize_session=False)
        db.query(Registration).filter(Registration.tournament_id == t.id).delete(synchronize_session=False)
        db.query(TeamPlayer).filter(TeamPlayer.team_id.in_(team_ids)).delete(synchronize_session=False)
        db.query(Team).filter(Team.tournament_id == t.id).delete(synchronize_session=False)

    db.query(Court).filter(Court.tournament_id == t.id).delete(synchronize_session=False)
    db.delete(t)
    db.flush()


def _ensure_tournament(
    db: Session,
    owner: User,
    *,
    courts: int,
    enable_plate: bool,
    teams: int,
) -> Tournament:
    event_day = date.today() + timedelta(days=7)
    start = time(9, 0)
    t = db.query(Tournament).filter(Tournament.slug == SLUG).first()
    if t:
        t.name = "Dry Run Demo Tournament"
        t.location = "Limerick"
        t.venue = "Demo Padel Centre"
        t.event_date = event_day
        t.start_time = start
        t.number_of_courts = courts
        t.entry_fee_cents = 0
        t.pay_on_arrival = True
        t.refunds_on_withdrawal = True
        t.max_teams = max(teams, 16)
        t.registration_deadline = datetime.combine(
            event_day - timedelta(days=1), time(23, 59), tzinfo=timezone.utc
        )
        t.format = TournamentFormat.GROUP_KNOCKOUT.value
        t.play_format = PlayFormat.DOUBLES.value
        t.status = TournamentStatus.REGISTRATION_OPEN.value
        t.organiser_id = owner.id
        t.match_duration_minutes = 20
        t.group_size = 4
        t.teams_advance_per_group = 2
        t.enable_plate = enable_plate
        t.championship_size = 8 if teams <= 16 else 16
        t.plate_size = 8 if teams <= 16 else 16
        t.description = (
            "Private dry-run event for testing scoring, brackets, next-court, "
            "TV display, and player live view before the first real tournament."
        )
        t.rules = "Winner + optional score · demo only · not a public event."
        t.scoring_mode = ScoringMode.SIMPLE.value
        t.is_official = False
        t.invite_code = _invite_or_fixed(db, INVITE_CODE)
        _sync_courts(db, t.id, courts)
        return t

    t = Tournament(
        name="Dry Run Demo Tournament",
        slug=SLUG,
        location="Limerick",
        venue="Demo Padel Centre",
        event_date=event_day,
        start_time=start,
        number_of_courts=courts,
        entry_fee_cents=0,
        currency="EUR",
        pay_on_arrival=True,
        refunds_on_withdrawal=True,
        max_teams=max(teams, 16),
        registration_deadline=datetime.combine(
            event_day - timedelta(days=1), time(23, 59), tzinfo=timezone.utc
        ),
        format=TournamentFormat.GROUP_KNOCKOUT.value,
        play_format=PlayFormat.DOUBLES.value,
        rules="Winner + optional score · demo only · not a public event.",
        description=(
            "Private dry-run event for testing scoring, brackets, next-court, "
            "TV display, and player live view before the first real tournament."
        ),
        status=TournamentStatus.REGISTRATION_OPEN.value,
        organiser_id=owner.id,
        match_duration_minutes=20,
        group_size=4,
        teams_advance_per_group=2,
        enable_plate=enable_plate,
        championship_size=8 if teams <= 16 else 16,
        plate_size=8 if teams <= 16 else 16,
        scoring_mode=ScoringMode.SIMPLE.value,
        invite_code=_invite_or_fixed(db, INVITE_CODE),
        is_official=False,
    )
    db.add(t)
    db.flush()
    _sync_courts(db, t.id, courts)
    return t


def _ensure_team(
    db: Session,
    t: Tournament,
    *,
    index: int,
    name: str,
    p1: User,
    p2: User,
    uni: University | None,
) -> Team:
    team = db.query(Team).filter(Team.tournament_id == t.id, Team.name == name).first()
    if not team:
        team = Team(
            tournament_id=t.id,
            name=name,
            university_id=uni.id if uni else None,
            seed=index,
            checked_in=False,
        )
        db.add(team)
        db.flush()
    else:
        team.seed = index
        team.university_id = uni.id if uni else team.university_id
        team.withdrawn = False

    for slot, user in ((1, p1), (2, p2)):
        tp = (
            db.query(TeamPlayer)
            .filter(TeamPlayer.team_id == team.id, TeamPlayer.slot == slot)
            .first()
        )
        if tp:
            tp.user_id = user.id
            tp.invitation_accepted = True
        else:
            db.add(
                TeamPlayer(
                    team_id=team.id,
                    user_id=user.id,
                    slot=slot,
                    invitation_accepted=True,
                )
            )

    reg = db.query(Registration).filter(Registration.team_id == team.id).first()
    if not reg:
        reg = Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=0,
            currency=t.currency,
            paid_at=datetime.now(timezone.utc),
        )
        db.add(reg)
        db.flush()
        db.add(
            Payment(
                registration_id=reg.id,
                tournament_id=t.id,
                amount_cents=0,
                currency=t.currency,
                status=PaymentStatus.PAID.value,
                stripe_payment_id=f"dryrun_{uuid.uuid4().hex[:8]}",
            )
        )
    else:
        reg.status = PaymentStatus.PAID.value
        reg.amount_cents = 0
        if not reg.paid_at:
            reg.paid_at = datetime.now(timezone.utc)

    return team


def seed(
    *,
    teams: int,
    courts: int,
    enable_plate: bool,
    reset: bool,
) -> None:
    if teams < 2 or teams > len(TEAM_NAMES):
        raise SystemExit(f"-n must be between 2 and {len(TEAM_NAMES)}")
    if courts < 1 or courts > 12:
        raise SystemExit("--courts must be between 1 and 12")

    init_db()
    db = SessionLocal()
    pw_hash = hash_password(PASSWORD)

    try:
        _ensure_universities(db)
        unis = db.query(University).order_by(University.name).all()
        ul = next((u for u in unis if u.slug == "ul"), unis[0] if unis else None)

        if reset:
            existing = db.query(Tournament).filter(Tournament.slug == SLUG).first()
            if existing:
                _wipe_tournament(db, existing)
                print(f"Reset: removed previous {SLUG} tournament.")
            # Drop legacy dry-run emails that EmailStr rejects (@demo.local)
            legacy = (
                db.query(User)
                .filter(
                    (User.email.like("%@demo.local"))
                    | (User.bio == "dry-run-demo")
                    | (User.email.like("dryrun%@example.com"))
                )
                .all()
            )
            if legacy:
                anchor = _ensure_admin_owner(db)
                admin_email, _ = _admin_login()
                for user in legacy:
                    if user.email == admin_email:
                        continue
                    purge_user(db, user, reassign_to=anchor)
                db.commit()
                print(f"Reset: purged {len(legacy)} previous dry-run player accounts.")

        owner = _ensure_admin_owner(db)
        t = _ensure_tournament(
            db, owner, courts=courts, enable_plate=enable_plate, teams=teams
        )

        created_players = 0
        roster: list[tuple[str, str, str, str]] = []

        for i in range(1, teams + 1):
            team_name = TEAM_NAMES[i - 1]
            uni = unis[(i - 1) % len(unis)] if unis else None
            email_a = _player_email(i, "a")
            email_b = _player_email(i, "b")
            name_a = f"{team_name} A"
            name_b = f"{team_name} B"
            existed_a = db.query(User).filter(User.email == email_a).first() is not None
            existed_b = db.query(User).filter(User.email == email_b).first() is not None
            p1 = _ensure_player(
                db, email=email_a, full_name=name_a, uni=uni, password_hash=pw_hash
            )
            p2 = _ensure_player(
                db, email=email_b, full_name=name_b, uni=uni, password_hash=pw_hash
            )
            if not existed_a:
                created_players += 1
            if not existed_b:
                created_players += 1
            _ensure_team(db, t, index=i, name=team_name, p1=p1, p2=p2, uni=uni)
            roster.append((team_name, email_a, email_b, uni.short_name if uni else ""))

        db.commit()
        db.refresh(t)

        print()
        print("=" * 64)
        print(" DRY-RUN DEMO TOURNAMENT READY (private / invite-only)")
        print("=" * 64)
        print(f"  Name:         {t.name}")
        print(f"  Slug:         {t.slug}")
        print(f"  Invite code:  {t.invite_code}")
        print(f"  Status:       {t.status}")
        print(f"  Official:     {t.is_official}  (hidden from public listings)")
        print(f"  Format:       {t.format} / {t.play_format}")
        print(f"  Teams:        {teams} paid doubles entries")
        print(f"  Courts:       {courts}")
        print(f"  Plate:        {t.enable_plate}")
        print(f"  Date:         {t.event_date} @ {t.start_time}")
        print()
        admin_email, admin_password = _admin_login()
        print(" Admin login (manage draw / score / courts)")
        print(f"  Email:    {admin_email}")
        print(f"  Password: {admin_password}")
        print(f"  Hub:      http://localhost:5173/organiser")
        print(f"  Event:    http://localhost:5173/t/{t.slug}")
        print(f"  Live:     http://localhost:5173/t/{t.slug}/live")
        print(f"  TV:       http://localhost:5173/tournament/{t.id}/display")
        print(f"  Join:     http://localhost:5173/t/join/{t.invite_code}")
        print()
        print(f" Player password (all demo players): {PASSWORD}")
        print()
        print(" Sample player logins (use any team to simulate scoring from player view)")
        for team_name, email_a, email_b, uni in roster[:4]:
            print(f"  {team_name} ({uni})")
            print(f"    {email_a} / {PASSWORD}")
            print(f"    {email_b} / {PASSWORD}")
        if teams > 4:
            print(
                f"  … plus {teams - 4} more teams "
                f"(dryrun05a@{EMAIL_DOMAIN} … dryrun{teams:02d}b@{EMAIL_DOMAIN})"
            )
        print()
        print(" Suggested dry-run order")
        print("  1. Log in as admin → open the event in /organiser")
        print("  2. Generate draw (4 groups of 4 → 8 advance to QF)")
        print("  3. Score group matches (admin score OR player propose + confirm)")
        print("  4. Watch knockout auto-seed; continue scoring to the final")
        print("  5. Check next-court calls, player live view, and TV display")
        print("  6. Mark tournament COMPLETED when done")
        print()
        print(f" Players created/updated this run: {created_players}")
        print("=" * 64)
    finally:
        db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Seed a private dry-run tournament")
    p.add_argument("-n", type=int, default=16, help="Number of doubles teams (default 16)")
    p.add_argument("--courts", type=int, default=4, help="Number of courts (default 4)")
    p.add_argument(
        "--plate",
        action="store_true",
        help="Enable Championship + Plate brackets after groups",
    )
    p.add_argument(
        "--reset",
        action="store_true",
        help="Delete the dry-run-demo tournament first (fixtures + teams), then recreate",
    )
    args = p.parse_args()
    seed(teams=args.n, courts=args.courts, enable_plate=args.plate, reset=args.reset)
