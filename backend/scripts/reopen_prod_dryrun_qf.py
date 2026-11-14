"""Recreate the private dry-run on production and leave it at quarter-finals.

Uses the player host account (no admin password required).

    PYTHONPATH=. python scripts/reopen_prod_dryrun_qf.py
"""

from __future__ import annotations

import json
import random
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

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
BASE = "https://student-padel-ireland.onrender.com"


def _req(method: str, path: str, *, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{BASE.rstrip('/')}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=90, context=_SSL_CTX) as resp:
            raw = resp.read().decode() or "null"
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = {"detail": raw}
        return e.code, parsed


def ensure_user(email: str, full_name: str) -> tuple[str, str]:
    code, data = _req(
        "POST",
        "/api/auth/register",
        body={"email": email, "password": PASSWORD, "full_name": full_name},
    )
    if code == 200 and isinstance(data, dict) and data.get("access_token"):
        token = data["access_token"]
        uid = data["user"]["id"]
    elif code == 400:
        code, data = _req(
            "POST",
            "/api/auth/login",
            body={"email": email, "password": PASSWORD},
        )
        if code != 200 or not isinstance(data, dict) or not data.get("access_token"):
            raise SystemExit(f"Could not ensure {email}: {code} {data}")
        token = data["access_token"]
        uid = data["user"]["id"]
    else:
        raise SystemExit(f"Could not ensure {email}: {code} {data}")

    # Marker so rankings/search can hide demo accounts (also email-matched).
    _req("PATCH", "/api/me/profile", token=token, body={"bio": "dry-run-demo"})
    return token, uid


def main() -> None:
    code, health = _req("GET", "/health")
    if code != 200:
        raise SystemExit(f"API health failed: {code} {health}")
    print("Health OK", health)

    host_token, _host_id = ensure_user(HOST_EMAIL, "Dry Run Host")
    print(f"Host ready: {HOST_EMAIL}")

    # Delete any leftover dry-run owned by host
    code, dash = _req("GET", "/api/organiser/dashboard", token=host_token)
    if code == 200 and isinstance(dash, dict):
        for row in dash.get("tournaments") or []:
            t = row.get("tournament") or row
            if not isinstance(t, dict):
                continue
            name = (t.get("name") or "").lower()
            slug = (t.get("slug") or "").lower()
            if "dry run" in name or "dry-run" in slug:
                tid = t["id"]
                dcode, dres = _req("DELETE", f"/api/tournaments/{tid}", token=host_token)
                print(f"Deleted previous {t.get('slug')}: {dcode}")

    event_date = (date.today() + timedelta(days=3)).isoformat()
    code, created = _req(
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
            "max_teams": 16,
            "format": "GROUP_KNOCKOUT",
            "play_format": "DOUBLES",
            "match_duration_minutes": 20,
            "group_size": 4,
            "teams_advance_per_group": 2,
            "enable_plate": False,
            "championship_size": 8,
            "description": (
                "PRIVATE dry-run for testing. Not a public event — delete after testing."
            ),
            "rules": "Demo scores only. Winner + optional score.",
            "scoring_mode": "SIMPLE",
        },
    )
    if code not in (200, 201) or not isinstance(created, dict):
        raise SystemExit(f"Create failed: {code} {created}")
    tid = created["id"]
    slug = created["slug"]
    invite = created.get("invite_code")
    print(f"Created {slug} invite={invite} official={created.get('is_official')}")
    if created.get("is_official"):
        raise SystemExit("Created as official — aborting")

    code, opened = _req(
        "PATCH",
        f"/api/tournaments/{tid}",
        token=host_token,
        body={"status": "REGISTRATION_OPEN"},
    )
    if code != 200:
        raise SystemExit(f"Open registration failed: {code} {opened}")
    invite = (opened or {}).get("invite_code") or invite

    for i, name in enumerate(TEAM_NAMES, start=1):
        email_a = f"dryrun{i:02d}a@example.com"
        email_b = f"dryrun{i:02d}b@example.com"
        _, id_a = ensure_user(email_a, f"{name} A")
        time.sleep(0.04)
        _, id_b = ensure_user(email_b, f"{name} B")
        time.sleep(0.04)
        code, team = _req(
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
        print(f"  + {name}")
        time.sleep(0.04)

    # Close registration then generate
    code, closed = _req(
        "PATCH",
        f"/api/tournaments/{tid}",
        token=host_token,
        body={"status": "REGISTRATION_CLOSED"},
    )
    print("Registration closed:", code)

    code, gen = _req("POST", f"/api/tournaments/{tid}/generate", token=host_token, body={})
    if code not in (200, 201):
        raise SystemExit(f"Generate failed: {code} {gen}")
    print("Draw generated")

    code, live = _req(
        "PATCH",
        f"/api/tournaments/{tid}",
        token=host_token,
        body={"status": "LIVE"},
    )
    print("LIVE:", code)

    code, matches = _req("GET", f"/api/tournaments/{slug}/matches", token=host_token)
    if code != 200 or not isinstance(matches, list):
        raise SystemExit(f"List matches failed: {code} {matches}")

    groups = [
        m
        for m in matches
        if m.get("stage") == "GROUP" and m.get("status") != "COMPLETED"
    ]
    print(f"Scoring {len(groups)} group matches…")
    for m in groups:
        if not m.get("team_a_id") or not m.get("team_b_id"):
            continue
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
            "status": "COMPLETED",
            "winner_id": winner,
        }
        code, res = _req("PATCH", f"/api/matches/{m['id']}/score", token=host_token, body=body)
        if code != 200:
            print(f"  fail {m.get('id')}: {code} {res}")
        time.sleep(0.03)

    code, seeded = _req("POST", f"/api/tournaments/{tid}/seed-knockout", token=host_token)
    print("Seed knockout:", code if code != 200 else "ok", seeded if code != 200 else "")

    code, matches2 = _req("GET", f"/api/tournaments/{slug}/matches", token=host_token)
    qf = [
        m
        for m in (matches2 or [])
        if isinstance(m, dict)
        and m.get("stage") == "KNOCKOUT"
        and (m.get("round") or "").upper() in {"QUARTER", "QUARTER_FINAL", "QF"}
    ]
    # Fallback: any KO with both teams set and not completed
    if not qf:
        qf = [
            m
            for m in (matches2 or [])
            if isinstance(m, dict)
            and m.get("stage") == "KNOCKOUT"
            and m.get("team_a_id")
            and m.get("team_b_id")
            and m.get("status") != "COMPLETED"
        ]

    # Confirm not on public upcoming
    code, upcoming = _req("GET", "/api/tournaments?upcoming=true")
    public_hit = False
    if code == 200 and isinstance(upcoming, list):
        public_hit = any(t.get("id") == tid or t.get("slug") == slug for t in upcoming)

    # Pick a QF player login if possible
    sample_email = "dryrun01a@example.com"
    sample_team = "Limerick Lions"
    if qf:
        # Prefer first QF team_a name via teams list
        code, teams = _req("GET", f"/api/tournaments/{tid}/teams", token=host_token)
        team_by_id = {}
        if code == 200 and isinstance(teams, list):
            team_by_id = {t["id"]: t for t in teams if isinstance(t, dict)}
        first = qf[0]
        ta = team_by_id.get(first.get("team_a_id") or "")
        if ta and ta.get("name"):
            sample_team = ta["name"]
            # map name back to dryrun index
            try:
                idx = TEAM_NAMES.index(sample_team) + 1
                sample_email = f"dryrun{idx:02d}a@example.com"
            except ValueError:
                pass

    print()
    print("=" * 64)
    print(" DRY-RUN AT QUARTER-FINALS (private)")
    print("=" * 64)
    print(f"  Slug:        {slug}")
    print(f"  Invite:      {invite}")
    print(f"  On upcoming: {public_hit}  (must be False)")
    print(f"  QF matches:  {len(qf)}")
    for m in qf[:8]:
        print(
            f"    {m.get('round')} · {m.get('team_a_name')} vs {m.get('team_b_name')} · {m.get('status')}"
        )
    print()
    print(" Host (manage)")
    print(f"  {HOST_EMAIL} / {PASSWORD}")
    print(f"  https://www.studentpadel.ie/manage")
    print(f"  https://www.studentpadel.ie/t/{slug}/live")
    print()
    print(" Player still in (sample QF)")
    print(f"  {sample_email} / {PASSWORD}  ({sample_team})")
    print("=" * 64)
    if public_hit:
        raise SystemExit("ERROR: appeared on public upcoming")


if __name__ == "__main__":
    main()
