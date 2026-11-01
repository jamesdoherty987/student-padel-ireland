"""Platform admin APIs: manage all accounts and tournament entries."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_role
from app.api.tournaments import _apply_team_withdraw, _membership_for_user
from app.core.roles import Role
from app.db.session import get_db
from app.models import Team, TeamPlayer, Tournament, University, User, UserRole
from app.schemas import (
    AdminTournamentEntriesOut,
    AdminTournamentEntryPlayer,
    AdminTournamentTeamOut,
    AdminUserDetailOut,
    AdminUserOut,
    AdminUserTournamentEntry,
    TeamOut,
)
from app.services.accounts import anonymise_user, is_deleted_placeholder_email, user_is_sole_admin

router = APIRouter(prefix="/admin", tags=["admin"])

require_admin = require_role(Role.ADMIN)


def _uni_short(db: Session, user: User) -> str | None:
    if not user.university_id:
        return None
    uni = db.get(University, user.university_id)
    return uni.short_name if uni else None


def _entry_counts(db: Session, user_ids: list[UUID]) -> dict[UUID, int]:
    if not user_ids:
        return {}
    rows = (
        db.query(TeamPlayer.user_id, func.count(TeamPlayer.id))
        .join(Team, Team.id == TeamPlayer.team_id)
        .filter(TeamPlayer.user_id.in_(user_ids), Team.withdrawn.is_(False))
        .group_by(TeamPlayer.user_id)
        .all()
    )
    return {uid: int(n) for uid, n in rows}


def _admin_user_out(db: Session, user: User, entries: int | None = None) -> AdminUserOut:
    count = entries
    if count is None:
        count = _entry_counts(db, [user.id]).get(user.id, 0)
    return AdminUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        role=user.role,
        university_id=user.university_id,
        university_short=_uni_short(db, user),
        student_number=user.student_number,
        is_active=user.is_active,
        is_suspended=user.is_suspended,
        created_at=getattr(user, "created_at", None),
        tournament_entries=count,
    )


@router.get("/users", response_model=list[AdminUserOut])
def list_users(
    q: str | None = Query(default=None, max_length=120),
    include_inactive: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if not include_inactive:
        query = query.filter(User.is_active.is_(True))
    term = (q or "").strip()
    if term:
        like = f"%{term}%"
        query = query.filter(
            or_(
                User.full_name.ilike(like),
                User.email.ilike(like),
                User.student_number.ilike(like),
            )
        )
    users = query.order_by(User.full_name.asc()).limit(limit).all()
    counts = _entry_counts(db, [u.id for u in users])
    return [_admin_user_out(db, u, counts.get(u.id, 0)) for u in users]


@router.get("/users/{user_id}", response_model=AdminUserDetailOut)
def get_user(
    user_id: UUID,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user or is_deleted_placeholder_email(user.email):
        raise HTTPException(404, "User not found")

    memberships = (
        db.query(TeamPlayer)
        .options(
            joinedload(TeamPlayer.team).joinedload(Team.registration),
            joinedload(TeamPlayer.team).joinedload(Team.tournament),
            joinedload(TeamPlayer.team).joinedload(Team.members).joinedload(TeamPlayer.user),
        )
        .join(Team, Team.id == TeamPlayer.team_id)
        .filter(TeamPlayer.user_id == user_id)
        .order_by(Team.created_at.desc())
        .all()
    )

    entries: list[AdminUserTournamentEntry] = []
    seen_teams: set[UUID] = set()
    for tp in memberships:
        team = tp.team
        if not team or team.id in seen_teams:
            continue
        seen_teams.add(team.id)
        t = team.tournament
        if not t:
            continue
        players = [
            m.user.full_name
            for m in sorted(team.members, key=lambda x: x.slot)
            if m.user
        ]
        entries.append(
            AdminUserTournamentEntry(
                tournament_id=t.id,
                tournament_name=t.name,
                tournament_slug=t.slug,
                tournament_status=t.status,
                event_date=t.event_date,
                team_id=team.id,
                team_name=team.name,
                payment_status=team.registration.status if team.registration else None,
                withdrawn=bool(team.withdrawn),
                players=players,
            )
        )

    base = _admin_user_out(db, user)
    return AdminUserDetailOut(**base.model_dump(), entries=entries)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Anonymise any account. Cannot delete the sole platform admin (yourself)."""
    user = db.get(User, user_id)
    if not user or is_deleted_placeholder_email(user.email):
        raise HTTPException(404, "User not found")
    if user.id == admin.id:
        raise HTTPException(400, "You cannot delete your own admin account")
    if user.role == UserRole.ADMIN.value and user_is_sole_admin(db, user.id):
        raise HTTPException(400, "Cannot delete the sole platform admin account")

    # Pull them out of active tournament entries before wiping the account
    memberships = (
        db.query(TeamPlayer)
        .options(joinedload(TeamPlayer.team).joinedload(Team.registration))
        .join(Team, Team.id == TeamPlayer.team_id)
        .filter(TeamPlayer.user_id == user_id, Team.withdrawn.is_(False))
        .all()
    )
    seen: set[UUID] = set()
    for tp in memberships:
        team = tp.team
        if not team or team.id in seen:
            continue
        seen.add(team.id)
        t = db.get(Tournament, team.tournament_id)
        if not t:
            continue
        _apply_team_withdraw(db, t, team, as_organiser=True, force=True)

    anonymise_user(db, user)
    db.commit()
    return None


@router.post(
    "/tournaments/{tournament_id}/players/{user_id}/remove",
    response_model=TeamOut,
)
def remove_player_from_tournament(
    tournament_id: UUID,
    user_id: UUID,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Withdraw a player's team from a tournament (admin can force even after draw/live)."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")

    membership = _membership_for_user(db, t.id, user_id)
    if not membership:
        raise HTTPException(404, "Player is not entered in this tournament")
    _tp, team, reg = membership
    if team.withdrawn:
        raise HTTPException(400, "Team is already withdrawn")
    if team.registration is None:
        team.registration = reg

    return _apply_team_withdraw(db, t, team, as_organiser=True, force=True)


@router.get(
    "/tournaments/{tournament_id}/entries",
    response_model=AdminTournamentEntriesOut,
)
def list_tournament_entries(
    tournament_id: UUID,
    include_withdrawn: bool = Query(default=False),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")

    q = (
        db.query(Team)
        .options(
            joinedload(Team.registration),
            joinedload(Team.members).joinedload(TeamPlayer.user),
        )
        .filter(Team.tournament_id == tournament_id)
        .order_by(Team.name.asc())
    )
    if not include_withdrawn:
        q = q.filter(Team.withdrawn.is_(False))
    teams = q.all()

    out_teams: list[AdminTournamentTeamOut] = []
    for team in teams:
        players = [
            AdminTournamentEntryPlayer(
                user_id=m.user_id,
                full_name=m.user.full_name if m.user else "Unknown",
                email=m.user.email if m.user else "",
                slot=m.slot,
            )
            for m in sorted(team.members, key=lambda x: x.slot)
        ]
        out_teams.append(
            AdminTournamentTeamOut(
                team_id=team.id,
                team_name=team.name,
                payment_status=team.registration.status if team.registration else None,
                withdrawn=bool(team.withdrawn),
                checked_in=bool(team.checked_in),
                players=players,
            )
        )

    return AdminTournamentEntriesOut(
        tournament_id=t.id,
        tournament_name=t.name,
        status=t.status,
        teams=out_teams,
    )
