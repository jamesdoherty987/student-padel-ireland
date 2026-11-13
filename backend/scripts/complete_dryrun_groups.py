"""Complete all dry-run group matches with demo scores (admin-owned event).

Usage (from backend/ with venv active):

    PYTHONPATH=. python scripts/complete_dryrun_groups.py
    PYTHONPATH=. python scripts/complete_dryrun_groups.py --regenerate
"""

from __future__ import annotations

import argparse
import random

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db.seed import _DEMO_ADMIN_EMAIL, _DEMO_ADMIN_PASSWORD
from app.db.session import SessionLocal, init_db
from app.main import app
from app.models import Match, MatchStatus, Tournament, User


PLAYER_PASSWORD = "demo12345"


def _admin_login() -> tuple[str, str]:
    settings = get_settings()
    email = (settings.admin_email or "").strip().lower() or _DEMO_ADMIN_EMAIL
    password = settings.admin_password or _DEMO_ADMIN_PASSWORD
    return email, password


def _login(client: TestClient, email: str, password: str) -> str:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        raise SystemExit(f"Login failed for {email}: {r.status_code} {r.text}")
    return r.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def main() -> None:
    p = argparse.ArgumentParser(description="Complete dry-run group stage")
    p.add_argument("--slug", default="dry-run-demo")
    p.add_argument(
        "--regenerate",
        action="store_true",
        help="Rebuild the draw even if matches already exist",
    )
    args = p.parse_args()

    admin_email, admin_password = _admin_login()

    init_db()
    db = SessionLocal()
    try:
        t = db.query(Tournament).filter(Tournament.slug == args.slug).one_or_none()
        if not t:
            raise SystemExit(f"No tournament with slug {args.slug}")
        admin = db.query(User).filter(User.email == admin_email).one_or_none()
        if not admin:
            raise SystemExit(f"Admin {admin_email} not found — run seed_demo_tournament.py first")
        tid = str(t.id)
        slug = t.slug
        enable_plate = bool(getattr(t, "enable_plate", False))
    finally:
        db.close()

    client = TestClient(app)
    token = _login(client, admin_email, admin_password)
    headers = _auth(token)

    r = client.get(f"/api/tournaments/{slug}/matches", headers=headers)
    if r.status_code != 200:
        raise SystemExit(f"List matches failed: {r.status_code} {r.text}")
    matches = r.json() if isinstance(r.json(), list) else []

    if args.regenerate or not matches:
        r = client.post(f"/api/tournaments/{tid}/generate", headers=headers)
        if r.status_code not in (200, 201):
            raise SystemExit(f"Generate failed: {r.status_code} {r.text}")
        print("Draw generated." if not args.regenerate else "Draw regenerated.")
        r = client.patch(
            f"/api/tournaments/{tid}",
            headers=headers,
            json={"status": "LIVE"},
        )
        if r.status_code != 200:
            print(f"Warning: could not set LIVE: {r.status_code} {r.text}")
        else:
            print("Tournament set to LIVE.")
        r = client.get(f"/api/tournaments/{slug}/matches", headers=headers)
        if r.status_code != 200:
            raise SystemExit(f"List matches failed: {r.status_code} {r.text}")
        matches = r.json() if isinstance(r.json(), list) else []

    groups = [m for m in matches if m.get("stage") == "GROUP" and m.get("status") != "COMPLETED"]
    print(f"Scoring {len(groups)} open group matches…")

    for m in groups:
        if not m.get("team_a_id") or not m.get("team_b_id"):
            continue
        # Simple overall score: random but decisive
        a = random.randint(6, 21)
        b = random.randint(0, a - 1)
        if random.random() < 0.45:
            a, b = b, a
        winner = m["team_a_id"] if a > b else m["team_b_id"]
        body = {
            "set1_a": a,
            "set1_b": b,
            "set2_a": 0,
            "set2_b": 0,
            "set3_a": 0,
            "set3_b": 0,
            "current_set": 1,
            "status": MatchStatus.COMPLETED.value,
            "winner_id": winner,
        }
        r = client.patch(f"/api/matches/{m['id']}/score", headers=headers, json=body)
        if r.status_code != 200:
            print(f"  fail {m['id']}: {r.status_code} {r.text}")
        else:
            print(f"  ok {m.get('round')} {a}-{b}")

    if enable_plate:
        r = client.post(f"/api/tournaments/{tid}/seed-knockout", headers=headers)
        print(f"Seed knockout: {r.status_code}")

    print()
    print(f"Admin: {admin_email} / {admin_password}")
    print(f"Player password (demo): {PLAYER_PASSWORD}")


if __name__ == "__main__":
    main()
