"""Register N demo paid teams for generator testing (local only)."""

from __future__ import annotations

import argparse
import uuid

from app.core.security import hash_password
from app.db.session import SessionLocal, init_db
from app.models import Payment, PaymentStatus, Registration, Team, TeamPlayer, Tournament, User


def main(count: int, slug: str) -> None:
    init_db()
    db = SessionLocal()
    t = db.query(Tournament).filter(Tournament.slug == slug).first()
    if not t:
        raise SystemExit(f"Tournament {slug} not found")

    for i in range(1, count + 1):
        email_a = f"demo{i}a@example.com"
        email_b = f"demo{i}b@example.com"
        ua = db.query(User).filter(User.email == email_a).first()
        if not ua:
            ua = User(
                email=email_a,
                password_hash=hash_password("demo12345"),
                full_name=f"Demo Player {i}A",
                role="PLAYER",
            )
            db.add(ua)
            db.flush()
        ub = db.query(User).filter(User.email == email_b).first()
        if not ub:
            ub = User(
                email=email_b,
                password_hash=hash_password("demo12345"),
                full_name=f"Demo Player {i}B",
                role="PLAYER",
            )
            db.add(ub)
            db.flush()

        existing = db.query(Team).filter(Team.tournament_id == t.id, Team.name == f"Demo Team {i}").first()
        if existing:
            continue

        team = Team(tournament_id=t.id, name=f"Demo Team {i}", university_id=None, seed=i)
        db.add(team)
        db.flush()
        db.add(TeamPlayer(team_id=team.id, user_id=ua.id, slot=1))
        db.add(TeamPlayer(team_id=team.id, user_id=ub.id, slot=2))
        reg = Registration(
            tournament_id=t.id,
            team_id=team.id,
            status=PaymentStatus.PAID.value,
            amount_cents=t.entry_fee_cents,
            currency=t.currency,
        )
        db.add(reg)
        db.flush()
        db.add(
            Payment(
                registration_id=reg.id,
                tournament_id=t.id,
                amount_cents=t.entry_fee_cents,
                currency=t.currency,
                status=PaymentStatus.PAID.value,
                stripe_payment_id=f"demo_{uuid.uuid4().hex[:8]}",
            )
        )

    db.commit()
    print(f"Ensured {count} paid demo teams on {slug}")
    db.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("-n", type=int, default=16)
    p.add_argument("--slug", default="limerick-2026")
    args = p.parse_args()
    main(args.n, args.slug)
