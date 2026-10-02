import secrets
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import (
    CompetitionMember,
    Friendship,
    ProfileMedia,
    Ranking,
    TeamPlayer,
    User,
    UserRole,
)
from app.schemas import AccountDeleteRequest, TokenResponse, UserCreate, UserLogin, UserPublic
from app.services.rating import INITIAL_RATING

router = APIRouter(prefix="/auth", tags=["auth"])

_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "profiles"


@router.post("/register", response_model=TokenResponse)
def register(body: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == body.email.lower()).first()
    if existing:
        if getattr(existing, "must_set_password", False):
            existing.password_hash = hash_password(body.password)
            existing.full_name = body.full_name.strip()
            existing.phone = body.phone or existing.phone
            existing.university_id = body.university_id or existing.university_id
            existing.student_number = body.student_number or existing.student_number
            existing.must_set_password = False
            existing.is_active = True
            db.query(TeamPlayer).filter(
                TeamPlayer.user_id == existing.id,
                TeamPlayer.invitation_accepted.is_(False),
            ).update({TeamPlayer.invitation_accepted: True})
            if not db.query(Ranking).filter(Ranking.user_id == existing.id).first():
                db.add(Ranking(user_id=existing.id, points=INITIAL_RATING))
            db.commit()
            db.refresh(existing)
            token = create_access_token(existing.id, {"role": existing.role})
            return TokenResponse(access_token=token, user=UserPublic.model_validate(existing))
        raise HTTPException(status_code=400, detail="Email already registered")

    role = UserRole.PLAYER.value
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        full_name=body.full_name.strip(),
        phone=body.phone,
        role=role,
        university_id=body.university_id,
        student_number=body.student_number,
    )
    db.add(user)
    db.flush()
    db.add(Ranking(user_id=user.id, points=INITIAL_RATING))
    db.commit()
    db.refresh(user)
    token = create_access_token(user.id, {"role": user.role})
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(body: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    token = create_access_token(user.id, {"role": user.role})
    return TokenResponse(access_token=token, user=UserPublic.model_validate(user))


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(get_current_user)):
    return UserPublic.model_validate(user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    body: AccountDeleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Anonymise and deactivate the signed-in account (keeps tournament history FKs intact)."""
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    uid = user.id

    db.query(ProfileMedia).filter(ProfileMedia.user_id == uid).delete(synchronize_session=False)
    db.query(Friendship).filter(
        (Friendship.requester_id == uid) | (Friendship.addressee_id == uid)
    ).delete(synchronize_session=False)
    db.query(CompetitionMember).filter(CompetitionMember.user_id == uid).delete(
        synchronize_session=False
    )

    try:
        folder = _UPLOAD_ROOT / str(uid)
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
    except OSError:
        pass

    # Free the email for re-registration; wipe personal fields
    user.email = f"deleted-{uid}@deleted.studentpadelireland.ie"
    user.password_hash = hash_password(secrets.token_urlsafe(48))
    user.full_name = "Deleted User"
    user.phone = None
    user.student_number = None
    user.university_id = None
    user.bio = None
    user.avatar_url = None
    user.is_active = False
    user.is_suspended = False
    user.must_set_password = False

    ranking = db.query(Ranking).filter(Ranking.user_id == uid).first()
    if ranking:
        ranking.points = INITIAL_RATING
        ranking.rank_ireland = None
        ranking.tournaments_played = 0
        ranking.matches_played = 0
        ranking.wins = 0
        ranking.losses = 0

    db.commit()
    return None
