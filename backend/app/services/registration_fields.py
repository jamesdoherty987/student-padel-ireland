"""Custom tournament signup fields (definitions + answers)."""

from __future__ import annotations

import json
import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models import (
    Team,
    TeamPlayer,
    Tournament,
    TournamentRegistrationAnswer,
    TournamentRegistrationField,
)
from app.schemas import CustomAnswerIn, CustomAnswerOut, RegistrationFieldIn, RegistrationFieldOut

_VALID_TYPES = {"text", "select", "boolean"}
_VALID_SCOPES = {"player", "team"}


def _slug_key(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (label or "").lower()).strip("_")
    return (s[:40] or "field")


def parse_options(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    return [p.strip() for p in str(raw).split(",") if p.strip()]


def dump_options(options: list[str]) -> str:
    return json.dumps(options or [], ensure_ascii=False)


def field_to_out(field: TournamentRegistrationField) -> RegistrationFieldOut:
    return RegistrationFieldOut(
        id=field.id,
        key=field.key,
        label=field.label,
        field_type=field.field_type,
        options=parse_options(field.options_json),
        required=bool(field.required),
        scope=field.scope or "player",
        sort_order=int(field.sort_order or 0),
    )


def list_fields(db: Session, tournament_id: UUID) -> list[TournamentRegistrationField]:
    return (
        db.query(TournamentRegistrationField)
        .filter(TournamentRegistrationField.tournament_id == tournament_id)
        .order_by(TournamentRegistrationField.sort_order, TournamentRegistrationField.created_at)
        .all()
    )


def sync_registration_fields(
    db: Session,
    tournament_id: UUID,
    fields: list[RegistrationFieldIn],
) -> None:
    """Replace tournament custom fields with the provided list (matched by id when present)."""
    existing = {
        f.id: f
        for f in db.query(TournamentRegistrationField)
        .filter(TournamentRegistrationField.tournament_id == tournament_id)
        .all()
    }
    keep_ids: set[UUID] = set()
    used_keys: set[str] = set()

    for idx, item in enumerate(fields):
        label = (item.label or "").strip()
        if not label:
            raise HTTPException(400, "Signup field label is required")
        ftype = item.field_type if item.field_type in _VALID_TYPES else "text"
        scope = item.scope if item.scope in _VALID_SCOPES else "player"
        options = list(item.options or [])
        if ftype == "select" and len(options) < 2:
            raise HTTPException(400, f"“{label}” needs at least 2 options")
        if ftype != "select":
            options = []

        row: TournamentRegistrationField | None = None
        if item.id and item.id in existing:
            row = existing[item.id]
            keep_ids.add(row.id)
            key = row.key
            if key in used_keys:
                base_key = _slug_key(label)
                key = base_key
                n = 2
                while key in used_keys:
                    key = f"{base_key}_{n}"
                    n += 1
            used_keys.add(key)
            row.label = label
            row.key = key
            row.field_type = ftype
            row.options_json = dump_options(options)
            row.required = bool(item.required)
            row.scope = scope
            row.sort_order = item.sort_order if item.sort_order else idx
        else:
            base_key = _slug_key(label)
            key = base_key
            n = 2
            while key in used_keys:
                key = f"{base_key}_{n}"
                n += 1
            used_keys.add(key)
            row = TournamentRegistrationField(
                tournament_id=tournament_id,
                key=key,
                label=label,
                field_type=ftype,
                options_json=dump_options(options),
                required=bool(item.required),
                scope=scope,
                sort_order=item.sort_order if item.sort_order else idx,
            )
            db.add(row)
            db.flush()
            keep_ids.add(row.id)

    for fid, row in existing.items():
        if fid not in keep_ids:
            db.delete(row)


def _normalize_value(field: TournamentRegistrationField, raw: str) -> str:
    value = (raw or "").strip()
    ftype = field.field_type or "text"
    if ftype == "boolean":
        low = value.lower()
        if low in {"1", "true", "yes", "y", "on"}:
            return "yes"
        if low in {"0", "false", "no", "n", "off"}:
            return "no"
        if not low:
            return ""
        raise HTTPException(400, f"“{field.label}” must be yes or no")
    if ftype == "select":
        options = parse_options(field.options_json)
        if not value:
            return ""
        match = next((o for o in options if o.lower() == value.lower()), None)
        if match is None:
            raise HTTPException(400, f"Pick a valid option for “{field.label}”")
        return match
    return value[:500]


def save_answers_for_registration(
    db: Session,
    *,
    tournament: Tournament,
    registration_id: UUID,
    team_id: UUID,
    answers: list[CustomAnswerIn],
    singles: bool,
) -> None:
    """Validate and upsert custom answers for a registration."""
    fields = list_fields(db, tournament.id)
    if not fields:
        return

    members = (
        db.query(TeamPlayer)
        .options(joinedload(TeamPlayer.user))
        .filter(TeamPlayer.team_id == team_id)
        .all()
    )
    by_slot = {m.slot: m for m in members}
    by_field = {f.id: f for f in fields}

    # Map submitted answers: (field_id, slot_or_0) -> value
    submitted: dict[tuple[UUID, int], str] = {}
    for a in answers or []:
        field = by_field.get(a.field_id)
        if not field:
            raise HTTPException(400, "Unknown signup field")
        slot = int(a.slot or 0)
        if field.scope == "team":
            slot = 0
        elif field.scope == "player":
            if slot not in (1, 2):
                slot = 1
            if singles and slot == 2:
                continue
        submitted[(field.id, slot)] = _normalize_value(field, a.value)

    def _missing(field: TournamentRegistrationField, slot: int) -> bool:
        key = (field.id, slot)
        if field.field_type == "boolean":
            return key not in submitted
        return not submitted.get(key, "")

    # Required checks
    for field in fields:
        if not field.required:
            continue
        if field.scope == "team":
            if _missing(field, 0):
                raise HTTPException(400, f"“{field.label}” is required")
        else:
            slots = [1] if singles else [1, 2]
            for slot in slots:
                if slot == 2 and 2 not in by_slot:
                    continue
                if _missing(field, slot):
                    raise HTTPException(
                        400,
                        f"“{field.label}” is required"
                        + (" for your partner" if slot == 2 else ""),
                    )

    # Clear previous answers for this registration then rewrite
    db.query(TournamentRegistrationAnswer).filter(
        TournamentRegistrationAnswer.registration_id == registration_id
    ).delete(synchronize_session=False)

    for field in fields:
        if field.scope == "team":
            key = (field.id, 0)
            if key not in submitted:
                continue
            val = submitted[key]
            if field.field_type != "boolean" and not val:
                continue
            db.add(
                TournamentRegistrationAnswer(
                    field_id=field.id,
                    registration_id=registration_id,
                    team_player_id=None,
                    value=val,
                )
            )
            continue

        slots = [1] if singles else [1, 2]
        for slot in slots:
            tp = by_slot.get(slot)
            if not tp:
                continue
            key = (field.id, slot)
            if key not in submitted:
                continue
            val = submitted[key]
            if field.field_type != "boolean" and not val:
                continue
            db.add(
                TournamentRegistrationAnswer(
                    field_id=field.id,
                    registration_id=registration_id,
                    team_player_id=tp.id,
                    value=val,
                )
            )


def answers_for_team(db: Session, team: Team) -> list[CustomAnswerOut]:
    if not team.registration:
        return []
    rows = (
        db.query(TournamentRegistrationAnswer)
        .options(
            joinedload(TournamentRegistrationAnswer.field),
        )
        .filter(TournamentRegistrationAnswer.registration_id == team.registration.id)
        .all()
    )
    members = {m.id: m for m in (team.members or [])}
    out: list[CustomAnswerOut] = []
    for row in sorted(
        rows,
        key=lambda r: (
            (r.field.sort_order if r.field else 0),
            members[r.team_player_id].slot if r.team_player_id and r.team_player_id in members else 0,
        ),
    ):
        if not row.field:
            continue
        slot = None
        player_name = None
        if row.team_player_id and row.team_player_id in members:
            m = members[row.team_player_id]
            slot = m.slot
            player_name = m.user.full_name if m.user else None
        out.append(
            CustomAnswerOut(
                field_id=row.field_id,
                field_key=row.field.key,
                label=row.field.label,
                scope=row.field.scope,
                slot=slot,
                player_name=player_name,
                value=row.value,
            )
        )
    return out
