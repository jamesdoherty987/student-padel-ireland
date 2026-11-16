"""Organiser free-entry email allowlist."""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models import Registration, Team, TeamPlayer, TournamentFreeEntry
from app.schemas import FreeEntryOut

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(raw: str) -> str:
    return (raw or "").strip().lower()


def free_entry_to_out(row: TournamentFreeEntry) -> FreeEntryOut:
    return FreeEntryOut(
        id=row.id,
        tournament_id=row.tournament_id,
        email=row.email,
        note=row.note,
        used=row.used_by_registration_id is not None,
        used_by_registration_id=row.used_by_registration_id,
        created_at=row.created_at,
    )


def list_free_entries(db: Session, tournament_id: UUID) -> list[TournamentFreeEntry]:
    return (
        db.query(TournamentFreeEntry)
        .filter(TournamentFreeEntry.tournament_id == tournament_id)
        .order_by(TournamentFreeEntry.created_at.asc())
        .all()
    )


def add_free_entries(
    db: Session,
    *,
    tournament_id: UUID,
    emails: list[str],
    note: str | None,
    created_by_id: UUID | None,
) -> list[TournamentFreeEntry]:
    existing = {
        r.email
        for r in db.query(TournamentFreeEntry)
        .filter(TournamentFreeEntry.tournament_id == tournament_id)
        .all()
    }
    clean_note = (note or "").strip()[:200] or None
    added: list[TournamentFreeEntry] = []
    seen: set[str] = set()
    for raw in emails:
        email = normalize_email(str(raw))
        if not email or email in seen:
            continue
        seen.add(email)
        if not _EMAIL_RE.match(email):
            raise HTTPException(400, f"Invalid email: {email}")
        if email in existing:
            continue
        row = TournamentFreeEntry(
            tournament_id=tournament_id,
            email=email,
            note=clean_note,
            created_by_id=created_by_id,
        )
        db.add(row)
        added.append(row)
        existing.add(email)
    if not added and seen:
        raise HTTPException(400, "Those emails are already on the free-entry list")
    if not added:
        raise HTTPException(400, "Enter at least one email")
    db.flush()
    return added


def team_emails(db: Session, team: Team) -> set[str]:
    members = (
        db.query(TeamPlayer)
        .options(joinedload(TeamPlayer.user))
        .filter(TeamPlayer.team_id == team.id)
        .all()
    )
    out: set[str] = set()
    for m in members:
        if m.user and m.user.email:
            email = normalize_email(m.user.email)
            if email:
                out.add(email)
    return out


def matching_unused_free_entries(
    db: Session, tournament_id: UUID, emails: set[str]
) -> list[TournamentFreeEntry]:
    if not emails:
        return []
    return (
        db.query(TournamentFreeEntry)
        .filter(
            TournamentFreeEntry.tournament_id == tournament_id,
            TournamentFreeEntry.used_by_registration_id.is_(None),
            TournamentFreeEntry.email.in_(list(emails)),
        )
        .all()
    )


def consume_free_entries_for_registration(
    db: Session,
    *,
    tournament_id: UUID,
    team: Team,
    registration: Registration,
) -> list[TournamentFreeEntry]:
    """If any team email is allowlisted and unused, mark matches used and return them."""
    emails = team_emails(db, team)
    matches = matching_unused_free_entries(db, tournament_id, emails)
    if not matches:
        return []
    for row in matches:
        row.used_by_registration_id = registration.id
    db.flush()
    return matches
