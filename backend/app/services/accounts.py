"""Account lifecycle helpers (self-delete + admin delete)."""

from __future__ import annotations

import secrets
import shutil
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import CompetitionMember, Friendship, ProfileMedia, Ranking, User
from app.services.rating import INITIAL_RATING

_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "profiles"


def anonymise_user(db: Session, user: User) -> None:
    """Wipe PII, free the email, and deactivate. Keeps tournament FK history intact."""
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
    # Never leave a deleted row as platform admin
    if user.role == "ADMIN":
        user.role = "PLAYER"

    ranking = db.query(Ranking).filter(Ranking.user_id == uid).first()
    if ranking:
        ranking.points = INITIAL_RATING
        ranking.rank_ireland = None
        ranking.tournaments_played = 0
        ranking.matches_played = 0
        ranking.wins = 0
        ranking.losses = 0


def is_deleted_placeholder_email(email: str) -> bool:
    return email.endswith("@deleted.studentpadelireland.ie")


def user_is_sole_admin(db: Session, user_id: UUID) -> bool:
    admins = (
        db.query(User.id)
        .filter(User.role == "ADMIN", User.is_active.is_(True))
        .all()
    )
    return len(admins) == 1 and admins[0][0] == user_id
