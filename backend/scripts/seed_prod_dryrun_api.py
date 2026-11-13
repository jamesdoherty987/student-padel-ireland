"""Seed a PRIVATE dry-run tournament on production via the public API.

Creates a player host (so is_official=false), 16 paid doubles teams, opens
registration. Does NOT touch Limerick Open or make anything public.

Usage:

    PYTHONPATH=. python scripts/seed_prod_dryrun_api.py
    PYTHONPATH=. python scripts/seed_prod_dryrun_api.py --base https://student-padel-ireland.onrender.com -n 16
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

# macOS / Homebrew Python often lacks system CA bundle for urllib.
try:
    import certifi

    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl._create_unverified_context()

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
)

HOST_EMAIL = "dryrun.host@example.com"
PASSWORD = "demo12345"
DEFAULT_BASE = "https://student-padel-ireland.onrender.com"


def _req(
    base: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict | None = None,
) -> tuple[int, dict | list | None]:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = {"detail": raw}
        return e.code, parsed


def ensure_user(base: str, email: str, full_name: str) -> tuple[str, str]:
    """Return (access_token, user_id). Register or login."""
    code, data = _req(
        base,
        "POST",
        "/api/auth/register",
        body={
            "email": email,
            "password": PASSWORD,
            "full_name": full_name,
        },
    )
    if code == 200 and isinstance(data, dict) and data.get("access_token"):
        return data["access_token"], data["user"]["id"]

    # Already registered
    if code == 400:
        code, data = _req(
            base,
            "POST",
            "/api/auth/login",
            body={"email": email, "password": PASSWORD},
        )
        if code == 200 and isinstance(data, dict) and data.get("access_token"):
            return data["access_token"], data["user"]["id"]

    raise SystemExit(f"Could not ensure user {email}: {code} {data}")


def find_existing_dryrun(base: str, token: str) -> dict | None:
    code, data = _req(base, "GET", "/api/organiser/dashboard", token=token)
    if code != 200 or not isinstance(data, list):
        return None
    for row in data:
        t = row.get("tournament") or {}
        if t.get("slug") == "dry-run-demo" or (t.get("name") or "").startswith("Dry Run Demo"):
            return t
    return None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default=DEFAULT_BASE)
    p.add_argument("-n", type=int, default=16, help="Number of doubles teams")
    args = p.parse_args()
    if args.n < 2 or args.n > len(TEAM_NAMES):
        raise SystemExit(f"-n must be 2..{len(TEAM_NAMES)}")

    base = args.base
    print(f"API: {base}")
    code, health = _req(base, "GET", "/health")
    if code != 200:
        raise SystemExit(f"API health failed: {code} {health}")
    print(f"Health: {health}")

    host_token, host_id = ensure_user(base, HOST_EMAIL, "Dry Run Host")
    print(f"Host ready: {HOST_EMAIL} ({host_id})")

    existing = find_existing_dryrun(base, host_token)
    if existing:
        tid = existing["id"]
        slug = existing["slug"]
        invite = existing.get("invite_code")
        official = existing.get("is_official")
        print(f"Reusing existing dry-run: {slug} official={official} invite={invite}")
        if official:
            # Host is a player so this shouldn't happen; abort rather than leave public.
            raise SystemExit("Existing dry-run is marked official — aborting to protect landing page.")
    else:
        event_date = (date.today() + timedelta(days=3)).isoformat()
        code, created = _req(
            base,
            "POST",
            "/api/tournaments",
            token=host_token,
            body={
                "name": "Dry Run Demo Tournament",
                "location": "Limerick",
                "venue": "Demo Padel Centre",
                "event_date": event_date,
                "start_time": "09:00:00",
                "number_of_courts": 4,
                "entry_fee_cents": 0,
                "pay_on_arrival": True,
                "refunds_on_withdrawal": True,
                "max_teams": max(args.n, 16),
                "format": "GROUP_KNOCKOUT",
                "play_format": "DOUBLES",
                "match_duration_minutes": 20,
                "group_size": 4,
                "teams_advance_per_group": 2,
                "enable_plate": False,
                "description": (
                    "PRIVATE dry-run for testing scoring, brackets, next-court, "
                    "and live views. Not a public event — delete after testing."
                ),
                "rules": "Demo scores only. Best of 3.",
            },
        )
        if code not in (200, 201) or not isinstance(created, dict):
            raise SystemExit(f"Create tournament failed: {code} {created}")
        tid = created["id"]
        slug = created["slug"]
        invite = created.get("invite_code")
        official = created.get("is_official")
        print(f"Created: {slug} id={tid} official={official} invite={invite}")
        if official:
            raise SystemExit("Tournament was created as official — aborting (landing page risk).")

        code, opened = _req(
            base,
            "PATCH",
            f"/api/tournaments/{tid}",
            token=host_token,
            body={"status": "REGISTRATION_OPEN"},
        )
        if code != 200:
            raise SystemExit(f"Open registration failed: {code} {opened}")
        invite = (opened or {}).get("invite_code") or invite
        print("Registration opened.")

    # Ensure still private
    code, detail = _req(base, "GET", f"/api/tournaments/{slug}", token=host_token)
    if code == 200 and isinstance(detail, dict):
        if detail.get("is_official"):
            raise SystemExit("Tournament is official — aborting.")
        invite = detail.get("invite_code") or invite
        print(f"Confirmed private. invite={invite} status={detail.get('status')}")

    # Existing teams by name
    code, teams_payload = _req(base, "GET", f"/api/tournaments/{tid}/teams", token=host_token)
    existing_names: set[str] = set()
    if code == 200 and isinstance(teams_payload, list):
        existing_names = {t.get("name") for t in teams_payload if t.get("name")}
    elif code == 200 and isinstance(teams_payload, dict):
        for t in teams_payload.get("teams") or []:
            if t.get("name"):
                existing_names.add(t["name"])

    added = 0
    for i in range(1, args.n + 1):
        name = TEAM_NAMES[i - 1]
        if name in existing_names:
            print(f"  skip team (exists): {name}")
            continue
        email_a = f"dryrun{i:02d}a@example.com"
        email_b = f"dryrun{i:02d}b@example.com"
        _, id_a = ensure_user(base, email_a, f"{name} A")
        time.sleep(0.05)
        _, id_b = ensure_user(base, email_b, f"{name} B")
        time.sleep(0.05)
        code, team = _req(
            base,
            "POST",
            f"/api/tournaments/{tid}/organiser-add-team",
            token=host_token,
            body={
                "team_name": name,
                "player1_id": id_a,
                "player2_id": id_b,
            },
        )
        if code not in (200, 201):
            print(f"  FAIL add {name}: {code} {team}", file=sys.stderr)
            continue
        added += 1
        print(f"  + {name}")
        time.sleep(0.05)

    # Final privacy check vs public upcoming list
    code, upcoming = _req(base, "GET", "/api/tournaments?upcoming=true")
    public_hit = False
    if code == 200 and isinstance(upcoming, list):
        public_hit = any(
            (t.get("id") == tid or t.get("slug") == slug) for t in upcoming
        )
    print()
    print("=" * 64)
    print(" PRODUCTION DRY-RUN READY (private)")
    print("=" * 64)
    print(f"  Name:         Dry Run Demo Tournament")
    print(f"  Slug:         {slug}")
    print(f"  Invite code:  {invite}")
    print(f"  Official:     False (must stay off landing)")
    print(f"  On upcoming:  {public_hit}  ← must be False")
    print(f"  Teams added:  {added} (this run)")
    print()
    print(" Host (manage draw / score)")
    print(f"  Email:    {HOST_EMAIL}")
    print(f"  Password: {PASSWORD}")
    print(f"  Hub:      https://www.studentpadel.ie/organiser")
    print(f"  Event:    https://www.studentpadel.ie/t/{slug}")
    print(f"  Live:     https://www.studentpadel.ie/t/{slug}/live")
    print(f"  Join:     https://www.studentpadel.ie/t/join/{invite}")
    print()
    print(f" Player password (all): {PASSWORD}")
    print("  e.g. dryrun01a@example.com / dryrun02a@example.com")
    print("=" * 64)
    if public_hit:
        raise SystemExit("ERROR: dry-run appeared on public upcoming list — investigate.")


if __name__ == "__main__":
    main()
