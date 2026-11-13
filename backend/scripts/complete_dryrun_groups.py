"""Generate the dry-run draw (if needed) and complete all group-stage scores.

Leaves knockout (QF → SF → Final) ready to play. Uses the same API paths as
the organiser app so standings, ratings, and KO seeding stay correct.

Usage:

    cd backend && source .venv/bin/activate
    PYTHONPATH=. python scripts/complete_dryrun_groups.py
    PYTHONPATH=. python scripts/complete_dryrun_groups.py --slug dry-run-demo
"""

from __future__ import annotations

import argparse
import sys

from fastapi.testclient import TestClient

from app.db.session import SessionLocal, init_db
from app.main import app
from app.models import Match, MatchStatus, Tournament, User


ORGANISER_EMAIL = "organiser@studentpadelireland.ie"
ORGANISER_PASSWORD = "organiser123"
PLAYER_PASSWORD = "demo12345"


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

    init_db()
    db = SessionLocal()
    try:
        t = db.query(Tournament).filter(Tournament.slug == args.slug).one_or_none()
        if not t:
            raise SystemExit(f"No tournament with slug {args.slug}")
        organiser = db.query(User).filter(User.email == ORGANISER_EMAIL).one_or_none()
        if not organiser:
            raise SystemExit(f"Organiser {ORGANISER_EMAIL} not found — run seed_demo_tournament.py first")
        tid = str(t.id)
        slug = t.slug
        enable_plate = bool(getattr(t, "enable_plate", False))
    finally:
        db.close()

    client = TestClient(app)
    token = _login(client, ORGANISER_EMAIL, ORGANISER_PASSWORD)
    headers = _auth(token)

    matches = client.get(f"/api/tournaments/{slug}/matches", headers=headers)
    if matches.status_code != 200:
        raise SystemExit(f"Could not load matches: {matches.status_code} {matches.text}")
    existing = matches.json()
    group_open = [
        m
        for m in existing
        if m.get("stage") == "GROUP"
        and m.get("status") not in ("COMPLETED", "WALKOVER", "CANCELLED")
    ]

    if args.regenerate or not existing:
        print("Generating draw…")
        gen = client.post(
            f"/api/tournaments/{tid}/generate",
            headers=headers,
            json={
                "group_size": 4,
                "teams_advance_per_group": 2,
                "seeding_mode": "alphabetical",
            },
        )
        if gen.status_code != 200:
            raise SystemExit(f"Generate failed: {gen.status_code} {gen.text}")
        print(f"  Draw ready · {gen.json().get('match_count', '?')} matches")
        live = client.patch(
            f"/api/tournaments/{tid}",
            headers=headers,
            json={"status": "LIVE"},
        )
        if live.status_code != 200:
            print(f"  Warning: could not set LIVE ({live.status_code})")
        else:
            print("  Tournament set to LIVE")
        matches = client.get(f"/api/tournaments/{slug}/matches", headers=headers)
        existing = matches.json()
        group_open = [
            m
            for m in existing
            if m.get("stage") == "GROUP"
            and m.get("status") not in ("COMPLETED", "WALKOVER", "CANCELLED")
        ]
    elif group_open:
        # Ensure event is live so player views show match-day UX
        client.patch(f"/api/tournaments/{tid}", headers=headers, json={"status": "LIVE"})

    if not group_open:
        print("No open group matches — already complete.")
    else:
        print(f"Scoring {len(group_open)} group matches…")
        # Deterministic: team A wins odd sort_order, team B wins even — clear standings
        for i, m in enumerate(sorted(group_open, key=lambda x: x.get("sort_order") or 0)):
            a = m.get("team_a_id")
            b = m.get("team_b_id")
            if not a or not b:
                print(f"  skip {m.get('id')} — teams not set")
                continue
            winner = a if (i % 2 == 0) else b
            # SIMPLE scoring: winner + optional points
            score_a = 21 if winner == a else 14
            score_b = 14 if winner == a else 21
            r = client.patch(
                f"/api/matches/{m['id']}/score",
                headers=headers,
                json={
                    "set1_a": score_a,
                    "set1_b": score_b,
                    "set2_a": 0,
                    "set2_b": 0,
                    "set3_a": 0,
                    "set3_b": 0,
                    "current_set": 1,
                    "status": "COMPLETED",
                    "winner_id": winner,
                },
            )
            if r.status_code != 200:
                raise SystemExit(f"Score failed for {m['id']}: {r.status_code} {r.text}")
            print(
                f"  ✓ {m.get('group_name') or m.get('round')} · "
                f"{m.get('team_a_name')} vs {m.get('team_b_name')} → "
                f"{'A' if winner == a else 'B'} {score_a}-{score_b}"
            )

    # Force seed in case last group match edge-case skipped it
    seed = client.post(f"/api/tournaments/{tid}/seed-knockout", headers=headers)
    if seed.status_code == 200:
        print(f"Knockout seeded · filled {seed.json().get('filled', seed.json())}")
    else:
        print(f"Seed knockout: {seed.status_code} {seed.text}")

    # Summary
    db = SessionLocal()
    try:
        t = db.query(Tournament).filter(Tournament.slug == slug).one()
        all_m = db.query(Match).filter(Match.tournament_id == t.id).all()
        groups = [m for m in all_m if m.stage == "GROUP"]
        ko = [m for m in all_m if m.stage == "KNOCKOUT"]
        plate = [m for m in all_m if m.stage == "PLATE"]
        first = sorted(
            [m for m in ko if m.round],
            key=lambda m: m.sort_order or 0,
        )
        first_round = first[0].round if first else None
        first_matches = [m for m in ko if m.round == first_round] if first_round else []
        ready = sum(1 for m in first_matches if m.team_a_id and m.team_b_id)
        print()
        print("=" * 56)
        print(f" Group stage complete · {slug}")
        print("=" * 56)
        print(f"  Groups done:     {sum(1 for m in groups if m.status == MatchStatus.COMPLETED.value)}/{len(groups)}")
        print(f"  Championship:    {len(ko)} matches · first round {first_round} ({ready} ready)")
        if enable_plate or plate:
            print(f"  Plate:           {len(plate)} matches")
        print(f"  Organiser:       {ORGANISER_EMAIL} / {ORGANISER_PASSWORD}")
        print(f"  Player password: {PLAYER_PASSWORD}")
        print(f"  Live:            http://localhost:5173/t/{slug}/live")
        print(f"  Bracket:         http://localhost:5173/organiser?t={t.id}")
        print()
        print("  Next: score QF → SF → Final from organiser or player phones.")
        print("  Tip: log in as a group loser (e.g. dryrun04a) to see ‘you’re out’,")
        print("       and as a finalist later for champion / runner-up.")
        print("=" * 56)
    finally:
        db.close()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise
