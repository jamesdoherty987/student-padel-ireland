from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.roles import Role, has_min_role
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Tournament, User

bearer = HTTPBearer(auto_error=False)


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
    if user.role == Role.ADMIN.value:
        return tournament
    if tournament.organiser_id != user.id:
        raise HTTPException(status_code=403, detail="Not the tournament organiser")
    return tournament
