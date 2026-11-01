"""Account lifecycle helpers (self-delete + admin purge)."""

from __future__ import annotations

import secrets
import shutil
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models import (
    Announcement,
    CommunityCompetition,
    CommunityMatch,
    CompetitionMember,
    Friendship,
    MatchScore,
    ProfileMedia,
    Ranking,
    RankingHistory,
    TeamPlayer,
    Tournament,
    TournamentAdmin,
    TournamentReminderLog,
    User,
)
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


def _purge_profile_files(uid: UUID) -> None:
    try:
        folder = _UPLOAD_ROOT / str(uid)
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
    except OSError:
        pass


def purge_user(db: Session, user: User, *, reassign_to: User) -> None:
    """Hard-delete a user row after clearing / reassigning foreign keys.

    Tournament team history stays (Team rows); this user's TeamPlayer seats are removed.
    Ownership of tournaments / announcements / competitions they created moves to ``reassign_to``.
    """
    uid = user.id
    if uid == reassign_to.id:
        raise ValueError("Cannot purge the account used for reassignment")

    # Ownership that cannot be null
    db.query(Tournament).filter(Tournament.organiser_id == uid).update(
        {Tournament.organiser_id: reassign_to.id},
        synchronize_session=False,
    )
    db.query(Announcement).filter(Announcement.created_by_id == uid).update(
        {Announcement.created_by_id: reassign_to.id},
        synchronize_session=False,
    )
    db.query(CommunityCompetition).filter(CommunityCompetition.created_by_id == uid).update(
        {CommunityCompetition.created_by_id: reassign_to.id},
        synchronize_session=False,
    )

    # Optional FKs → null
    db.query(MatchScore).filter(MatchScore.entered_by_id == uid).update(
        {MatchScore.entered_by_id: None}, synchronize_session=False
    )
    db.query(MatchScore).filter(MatchScore.confirmed_by_id == uid).update(
        {MatchScore.confirmed_by_id: None}, synchronize_session=False
    )
    db.query(TournamentAdmin).filter(TournamentAdmin.added_by_id == uid).update(
        {TournamentAdmin.added_by_id: None}, synchronize_session=False
    )
    db.query(CommunityMatch).filter(CommunityMatch.recorded_by_id == uid).update(
        {CommunityMatch.recorded_by_id: None}, synchronize_session=False
    )
    db.query(CommunityMatch).filter(CommunityMatch.confirmed_by_id == uid).update(
        {CommunityMatch.confirmed_by_id: None}, synchronize_session=False
    )
    db.query(CommunityMatch).filter(CommunityMatch.player_a2_id == uid).update(
        {CommunityMatch.player_a2_id: None}, synchronize_session=False
    )
    db.query(CommunityMatch).filter(CommunityMatch.player_b2_id == uid).update(
        {CommunityMatch.player_b2_id: None}, synchronize_session=False
    )

    # Community matches where they are a required player - remove the match
    db.query(CommunityMatch).filter(
        (CommunityMatch.player_a1_id == uid) | (CommunityMatch.player_b1_id == uid)
    ).delete(synchronize_session=False)

    # Direct owned rows
    db.query(ProfileMedia).filter(ProfileMedia.user_id == uid).delete(synchronize_session=False)
    db.query(Friendship).filter(
        (Friendship.requester_id == uid) | (Friendship.addressee_id == uid)
    ).delete(synchronize_session=False)
    db.query(CompetitionMember).filter(CompetitionMember.user_id == uid).delete(
        synchronize_session=False
    )
    db.query(TournamentAdmin).filter(TournamentAdmin.user_id == uid).delete(
        synchronize_session=False
    )
    db.query(TournamentReminderLog).filter(TournamentReminderLog.user_id == uid).delete(
        synchronize_session=False
    )
    db.query(RankingHistory).filter(RankingHistory.user_id == uid).delete(
        synchronize_session=False
    )
    db.query(Ranking).filter(Ranking.user_id == uid).delete(synchronize_session=False)
    db.query(TeamPlayer).filter(TeamPlayer.user_id == uid).delete(synchronize_session=False)

    _purge_profile_files(uid)

    db.delete(user)
