from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.roles import Role, has_min_role
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Tournament, TournamentAdmin, User

bearer = HTTPBearer(auto_error=False)


def user_can_manage_tournament(user: User, tournament: Tournament, db: Session) -> bool:
    """Platform ADMIN, primary organiser, or listed tournament admin."""
    if user.role == Role.ADMIN.value:
        return True
    if tournament.organiser_id == user.id:
        return True
    return (
        db.query(TournamentAdmin.id)
        .filter(
            TournamentAdmin.tournament_id == tournament.id,
            TournamentAdmin.user_id == user.id,
        )
        .first()
        is not None
    )


def user_owns_tournament(user: User, tournament: Tournament) -> bool:
    """Primary organiser or platform ADMIN (delete / transfer / manage admins)."""
    if user.role == Role.ADMIN.value:
        return True
    return tournament.organiser_id == user.id


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, UUID(payload["sub"]))
    if not user or not user.is_active or user.is_suspended:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User unavailable")
    return user


def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    if not creds:
        return None
    payload = decode_access_token(creds.credentials)
    if not payload or "sub" not in payload:
        return None
    return db.get(User, UUID(payload["sub"]))


def require_role(required: Role):
    def _dep(user: User = Depends(get_current_user)) -> User:
        if not has_min_role(user.role, required):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return _dep


def require_tournament_organiser(
    tournament_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Tournament:
    tournament = db.get(Tournament, tournament_id)
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    if not user_can_manage_tournament(user, tournament, db):
        raise HTTPException(status_code=403, detail="Not a tournament organiser")
    return tournament
