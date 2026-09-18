"""Friends, private competitions, and community match recording."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.models import (
    CommunityCompetition,
    CommunityMatch,
    CompetitionFormat,
    CompetitionMember,
    CompetitionStatus,
    Friendship,
    FriendshipStatus,
    MatchStatus,
    Ranking,
    University,
    User,
)
from app.schemas import (
    CommunityHomeOut,
    CommunityMatchCreate,
    CommunityMatchCourtUpdate,
    CommunityMatchOut,
    CommunityMatchScore,
    CompetitionCreate,
    CompetitionInviteFriends,
    CompetitionMemberOut,
    CompetitionOut,
    FriendRequestCreate,
    FriendshipOut,
    PlayerSearchOut,
    RatingDeltaOut,
)
from app.services.rating import INITIAL_RATING, rate_match

router = APIRouter(tags=["community"])


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "comp"
    return f"{base}-{secrets.token_hex(3)}"


def _invite_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def _user_points(db: Session, user_id: UUID) -> int:
    r = db.query(Ranking).filter(Ranking.user_id == user_id).first()
    if not r:
        return INITIAL_RATING
    return r.points if r.points or r.matches_played else INITIAL_RATING


def _uni_short(db: Session, user: User) -> str | None:
    if not user.university_id:
        return None
    u = db.get(University, user.university_id)
    return u.short_name if u else None


def _friendship_between(db: Session, a: UUID, b: UUID) -> Friendship | None:
    return (
        db.query(Friendship)
        .filter(
            or_(
                (Friendship.requester_id == a) & (Friendship.addressee_id == b),
                (Friendship.requester_id == b) & (Friendship.addressee_id == a),
            )
        )
        .first()
    )


def _accepted_friend_ids(db: Session, user_id: UUID) -> set[UUID]:
    rows = (
        db.query(Friendship)
        .filter(
            Friendship.status == FriendshipStatus.ACCEPTED.value,
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
        )
        .all()
    )
    out: set[UUID] = set()
    for f in rows:
        out.add(f.addressee_id if f.requester_id == user_id else f.requester_id)
    return out


def _is_member(db: Session, competition_id: UUID, user_id: UUID) -> CompetitionMember | None:
    return (
        db.query(CompetitionMember)
        .filter(
            CompetitionMember.competition_id == competition_id,
            CompetitionMember.user_id == user_id,
        )
        .first()
    )


def _comp_record(db: Session, competition_id: UUID) -> dict[UUID, tuple[int, int]]:
    """Local W–L within a competition from completed matches."""
    records: dict[UUID, list[int]] = {}
    matches = (
        db.query(CommunityMatch)
        .filter(
            CommunityMatch.competition_id == competition_id,
            CommunityMatch.status == MatchStatus.COMPLETED.value,
            CommunityMatch.winner_side.isnot(None),
        )
        .all()
    )
    for m in matches:
        side_a = [m.player_a1_id] + ([m.player_a2_id] if m.player_a2_id else [])
        side_b = [m.player_b1_id] + ([m.player_b2_id] if m.player_b2_id else [])
        winners = side_a if m.winner_side == "A" else side_b
        losers = side_b if m.winner_side == "A" else side_a
        for uid in winners:
            records.setdefault(uid, [0, 0])[0] += 1
        for uid in losers:
            records.setdefault(uid, [0, 0])[1] += 1
    return {uid: (w, l) for uid, (w, l) in records.items()}


def _competition_out(
    db: Session, c: CommunityCompetition, viewer: User | None
) -> CompetitionOut:
    local = _comp_record(db, c.id)
    members_out: list[CompetitionMemberOut] = []
    for m in c.members:
        ranking = db.query(Ranking).filter(Ranking.user_id == m.user_id).first()
        cw, cl = local.get(m.user_id, (0, 0))
        members_out.append(
            CompetitionMemberOut(
                user_id=m.user_id,
                full_name=m.user.full_name if m.user else "Unknown",
                role=m.role,
                points=_user_points(db, m.user_id),
                wins=ranking.wins if ranking else 0,
                losses=ranking.losses if ranking else 0,
                comp_wins=cw,
                comp_losses=cl,
            )
        )
    # Ladder order: competition W–L then national Elo
    members_out.sort(key=lambda x: (x.comp_wins - x.comp_losses, x.comp_wins, x.points), reverse=True)
    is_member = False
    is_owner = False
    if viewer:
        is_member = any(m.user_id == viewer.id for m in c.members)
        is_owner = c.created_by_id == viewer.id
    return CompetitionOut(
        id=c.id,
        name=c.name,
        slug=c.slug,
        description=c.description,
        format=c.format,
        status=c.status,
        invite_code=c.invite_code if is_member else "",
        created_by_id=c.created_by_id,
        created_by_name=c.created_by.full_name if c.created_by else "",
        max_players=c.max_players,
        number_of_courts=getattr(c, "number_of_courts", None) or 2,
        member_count=len(c.members),
        members=members_out,
        is_member=is_member,
        is_owner=is_owner,
    )


def _match_players(m: CommunityMatch) -> list[UUID]:
    players = [m.player_a1_id, m.player_b1_id]
    if m.player_a2_id:
        players.append(m.player_a2_id)
    if m.player_b2_id:
        players.append(m.player_b2_id)
    return players


def _match_out(
    db: Session,
    m: CommunityMatch,
    viewer: User | None = None,
    rating_changes: list[RatingDeltaOut] | None = None,
    competition: CommunityCompetition | None = None,
) -> CommunityMatchOut:
    def name(uid: UUID | None) -> str | None:
        if not uid:
            return None
        u = db.get(User, uid)
        return u.full_name if u else None

    players = _match_players(m)
    on_match = bool(viewer and viewer.id in players)
    needs_confirm = False
    can_score = False
    if viewer and on_match:
        if m.status == "AWAITING_CONFIRM" and not m.ratings_applied:
            needs_confirm = m.recorded_by_id != viewer.id and m.confirmed_by_id is None
        if m.status in (MatchStatus.SCHEDULED.value, MatchStatus.LIVE.value) and not m.ratings_applied:
            can_score = True

    comp = competition
    if comp is None and m.competition_id:
        comp = db.get(CommunityCompetition, m.competition_id)

    return CommunityMatchOut(
        id=m.id,
        competition_id=m.competition_id,
        competition_name=comp.name if comp else None,
        competition_slug=comp.slug if comp else None,
        format=m.format,
        status=m.status,
        player_a1_id=m.player_a1_id,
        player_a1_name=name(m.player_a1_id) or "",
        player_a2_id=m.player_a2_id,
        player_a2_name=name(m.player_a2_id),
        player_b1_id=m.player_b1_id,
        player_b1_name=name(m.player_b1_id) or "",
        player_b2_id=m.player_b2_id,
        player_b2_name=name(m.player_b2_id),
        winner_side=m.winner_side,
        set1_a=m.set1_a,
        set1_b=m.set1_b,
        set2_a=m.set2_a,
        set2_b=m.set2_b,
        set3_a=m.set3_a,
        set3_b=m.set3_b,
        played_at=m.played_at,
        notes=m.notes,
        court_number=m.court_number,
        ratings_applied=m.ratings_applied,
        recorded_by_id=m.recorded_by_id,
        confirmed_by_id=m.confirmed_by_id,
        needs_my_confirm=needs_confirm,
        can_i_score=can_score,
        rating_changes=rating_changes or [],
    )


def _apply_elo(db: Session, m: CommunityMatch, c: CommunityCompetition) -> list[RatingDeltaOut]:
    if m.ratings_applied or not m.winner_side:
        return []
    side_a = [m.player_a1_id] + ([m.player_a2_id] if m.player_a2_id else [])
    side_b = [m.player_b1_id] + ([m.player_b2_id] if m.player_b2_id else [])
    sets_a, sets_b = _set_counts(m)
    updates = rate_match(
        db,
        side_a_user_ids=side_a,
        side_b_user_ids=side_b,
        a_won=(m.winner_side == "A"),
        sets_a=sets_a,
        sets_b=sets_b,
        community_match_id=m.id,
        placement=f"comp:{c.slug}"[:40],
    )
    m.ratings_applied = True
    m.status = MatchStatus.COMPLETED.value
    m.played_at = datetime.now(timezone.utc)
    out: list[RatingDeltaOut] = []
    for u in updates:
        player = db.get(User, u.user_id)
        out.append(
            RatingDeltaOut(
                user_id=u.user_id,
                full_name=player.full_name if player else "",
                delta=u.delta,
                rating_after=u.rating_after,
                won=u.won,
            )
        )
    return out


def _infer_winner_side(
    set1_a: int,
    set1_b: int,
    set2_a: int,
    set2_b: int,
    set3_a: int,
    set3_b: int,
) -> str | None:
    sets = [(set1_a, set1_b), (set2_a, set2_b), (set3_a, set3_b)]
    a_sets = sum(1 for a, b in sets if a > b and (a or b))
    b_sets = sum(1 for a, b in sets if b > a and (a or b))
    if a_sets > b_sets:
        return "A"
    if b_sets > a_sets:
        return "B"
    return None


def _set_counts(m: CommunityMatch) -> tuple[int, int]:
    sets = [(m.set1_a, m.set1_b), (m.set2_a, m.set2_b), (m.set3_a, m.set3_b)]
    a_sets = sum(1 for a, b in sets if a > b and (a or b))
    b_sets = sum(1 for a, b in sets if b > a and (a or b))
    return a_sets, b_sets


# ── Player search & friends ───────────────────────────────────


@router.get("/players/search", response_model=list[PlayerSearchOut])
def search_players(
    request: Request,
    q: str = Query(min_length=2, max_length=80),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rate_limit(request, key="player-search", limit=30, window_seconds=60)
    term = f"%{q.strip()}%"
    # Name search only — never return emails to strangers
    rows = (
        db.query(User)
        .filter(
            User.is_active.is_(True),
            User.id != user.id,
            User.full_name.ilike(term),
        )
        .limit(20)
        .all()
    )
    out: list[PlayerSearchOut] = []
    for u in rows:
        fr = _friendship_between(db, user.id, u.id)
        status = None
        if fr:
            if fr.status == FriendshipStatus.ACCEPTED.value:
                status = "friends"
            elif fr.requester_id == user.id:
                status = "pending_out"
            else:
                status = "pending_in"
        out.append(
            PlayerSearchOut(
                id=u.id,
                full_name=u.full_name,
                university_short=_uni_short(db, u),
                points=_user_points(db, u.id),
                friendship_status=status,
            )
        )
    return out


@router.get("/friends", response_model=list[FriendshipOut])
def list_friends(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Friendship)
        .filter(
            or_(Friendship.requester_id == user.id, Friendship.addressee_id == user.id),
            Friendship.status.in_(
                [FriendshipStatus.ACCEPTED.value, FriendshipStatus.PENDING.value]
            ),
        )
        .order_by(Friendship.created_at.desc())
        .all()
    )
    out: list[FriendshipOut] = []
    for f in rows:
        other_id = f.addressee_id if f.requester_id == user.id else f.requester_id
        other = db.get(User, other_id)
        if not other:
            continue
        if f.status == FriendshipStatus.ACCEPTED.value:
            direction = "friend"
        elif f.requester_id == user.id:
            direction = "outgoing"
        else:
            direction = "incoming"
        out.append(
            FriendshipOut(
                id=f.id,
                user_id=other.id,
                full_name=other.full_name,
                university_short=_uni_short(db, other),
                points=_user_points(db, other.id),
                status=f.status,
                direction=direction,
                created_at=f.created_at,
            )
        )
    return out


@router.post("/friends/request", response_model=FriendshipOut)
def send_friend_request(
    request: Request,
    body: FriendRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rate_limit(request, key="friend-request", limit=20, window_seconds=60)
    if body.user_id == user.id:
        raise HTTPException(400, "Cannot friend yourself")
    other = db.get(User, body.user_id)
    if not other or not other.is_active:
        raise HTTPException(404, "Player not found")
    existing = _friendship_between(db, user.id, other.id)
    if existing:
        if existing.status == FriendshipStatus.ACCEPTED.value:
            raise HTTPException(400, "Already friends")
        if existing.status == FriendshipStatus.PENDING.value:
            if existing.addressee_id == user.id:
                existing.status = FriendshipStatus.ACCEPTED.value
                db.commit()
                return FriendshipOut(
                    id=existing.id,
                    user_id=other.id,
                    full_name=other.full_name,
                        university_short=_uni_short(db, other),
                    points=_user_points(db, other.id),
                    status=existing.status,
                    direction="friend",
                    created_at=existing.created_at,
                )
            raise HTTPException(400, "Friend request already sent")
        existing.status = FriendshipStatus.PENDING.value
        existing.requester_id = user.id
        existing.addressee_id = other.id
        db.commit()
        db.refresh(existing)
        fr = existing
    else:
        fr = Friendship(
            requester_id=user.id,
            addressee_id=other.id,
            status=FriendshipStatus.PENDING.value,
        )
        db.add(fr)
        db.commit()
        db.refresh(fr)
    return FriendshipOut(
        id=fr.id,
        user_id=other.id,
        full_name=other.full_name,
        university_short=_uni_short(db, other),
        points=_user_points(db, other.id),
        status=fr.status,
        direction="outgoing",
        created_at=fr.created_at,
    )


@router.post("/friends/{friendship_id}/accept", response_model=FriendshipOut)
def accept_friend(
    friendship_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fr = db.get(Friendship, friendship_id)
    if not fr or fr.addressee_id != user.id:
        raise HTTPException(404, "Request not found")
    if fr.status != FriendshipStatus.PENDING.value:
        raise HTTPException(400, "Request is not pending")
    fr.status = FriendshipStatus.ACCEPTED.value
    db.commit()
    other = db.get(User, fr.requester_id)
    assert other
    return FriendshipOut(
        id=fr.id,
        user_id=other.id,
        full_name=other.full_name,
        university_short=_uni_short(db, other),
        points=_user_points(db, other.id),
        status=fr.status,
        direction="friend",
        created_at=fr.created_at,
    )


@router.delete("/friends/{friendship_id}")
def remove_friend(
    friendship_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fr = db.get(Friendship, friendship_id)
    if not fr or user.id not in (fr.requester_id, fr.addressee_id):
        raise HTTPException(404, "Friendship not found")
    db.delete(fr)
    db.commit()
    return {"ok": True}


# ── Competitions ──────────────────────────────────────────────


@router.get("/competitions", response_model=list[CompetitionOut])
def list_competitions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member_ids = [
        m.competition_id
        for m in db.query(CompetitionMember).filter(CompetitionMember.user_id == user.id).all()
    ]
    if not member_ids:
        return []
    comps = (
        db.query(CommunityCompetition)
        .options(
            joinedload(CommunityCompetition.members).joinedload(CompetitionMember.user),
            joinedload(CommunityCompetition.created_by),
        )
        .filter(CommunityCompetition.id.in_(member_ids))
        .order_by(CommunityCompetition.created_at.desc())
        .all()
    )
    return [_competition_out(db, c, user) for c in comps]


@router.post("/competitions", response_model=CompetitionOut)
def create_competition(
    body: CompetitionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    fmt = body.format.upper()
    if fmt not in {f.value for f in CompetitionFormat}:
        raise HTTPException(400, "Invalid format")
    friends = _accepted_friend_ids(db, user.id)
    unique_friends = [fid for fid in dict.fromkeys(body.friend_ids) if fid != user.id]
    for fid in unique_friends:
        if fid not in friends:
            raise HTTPException(400, "Can only add accepted friends")
    if 1 + len(unique_friends) > body.max_players:
        raise HTTPException(400, f"Too many players for max_players={body.max_players}")

    c = CommunityCompetition(
        name=body.name.strip(),
        slug=_slugify(body.name),
        description=body.description,
        format=fmt,
        status=CompetitionStatus.OPEN.value,
        invite_code=_invite_code(),
        created_by_id=user.id,
        max_players=body.max_players,
        number_of_courts=body.number_of_courts,
    )
    db.add(c)
    db.flush()
    db.add(CompetitionMember(competition_id=c.id, user_id=user.id, role="OWNER"))
    for fid in unique_friends:
        db.add(CompetitionMember(competition_id=c.id, user_id=fid, role="PLAYER"))
    db.commit()
    c = (
        db.query(CommunityCompetition)
        .options(
            joinedload(CommunityCompetition.members).joinedload(CompetitionMember.user),
            joinedload(CommunityCompetition.created_by),
        )
        .filter(CommunityCompetition.id == c.id)
        .one()
    )
    return _competition_out(db, c, user)


@router.get("/competitions/{slug_or_id}", response_model=CompetitionOut)
def get_competition(
    slug_or_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, slug_or_id)
    if not _is_member(db, c.id, user.id):
        raise HTTPException(404, "Competition not found")
    return _competition_out(db, c, user)


def _resolve_competition(db: Session, slug_or_id: str) -> CommunityCompetition:
    q = db.query(CommunityCompetition).options(
        joinedload(CommunityCompetition.members).joinedload(CompetitionMember.user),
        joinedload(CommunityCompetition.created_by),
    )
    try:
        cid = UUID(slug_or_id)
        c = q.filter(CommunityCompetition.id == cid).first()
    except ValueError:
        c = q.filter(CommunityCompetition.slug == slug_or_id).first()
    if not c:
        raise HTTPException(404, "Competition not found")
    return c


@router.post("/competitions/join/{invite_code}", response_model=CompetitionOut)
def join_by_code(
    request: Request,
    invite_code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rate_limit(request, key="join-code", limit=15, window_seconds=60)
    code = "".join(ch for ch in invite_code.strip().upper() if ch.isalnum())[:12]
    if len(code) < 6:
        raise HTTPException(404, "Invalid invite code")
    c = (
        db.query(CommunityCompetition)
        .options(
            joinedload(CommunityCompetition.members).joinedload(CompetitionMember.user),
            joinedload(CommunityCompetition.created_by),
        )
        .filter(CommunityCompetition.invite_code == code)
        .first()
    )
    if not c:
        raise HTTPException(404, "Invalid invite code")
    if c.status in (CompetitionStatus.CANCELLED.value, CompetitionStatus.COMPLETED.value):
        raise HTTPException(400, "Competition is closed")
    if _is_member(db, c.id, user.id):
        return _competition_out(db, c, user)
    if len(c.members) >= c.max_players:
        raise HTTPException(400, "Competition is full")
    db.add(CompetitionMember(competition_id=c.id, user_id=user.id, role="PLAYER"))
    db.commit()
    c = _resolve_competition(db, str(c.id))
    return _competition_out(db, c, user)


@router.post("/competitions/{competition_id}/invite", response_model=CompetitionOut)
def invite_friends(
    competition_id: UUID,
    body: CompetitionInviteFriends,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, str(competition_id))
    if c.created_by_id != user.id:
        raise HTTPException(403, "Only the host can add friends")
    if c.status in (CompetitionStatus.CANCELLED.value, CompetitionStatus.COMPLETED.value):
        raise HTTPException(400, "Competition is closed")
    friends = _accepted_friend_ids(db, user.id)
    existing = {m.user_id for m in c.members}
    for fid in body.friend_ids:
        if fid not in friends:
            raise HTTPException(400, "Can only add accepted friends")
        if fid in existing:
            continue
        if len(existing) >= c.max_players:
            raise HTTPException(400, "Competition is full")
        db.add(CompetitionMember(competition_id=c.id, user_id=fid, role="PLAYER"))
        existing.add(fid)
    db.commit()
    return _competition_out(db, _resolve_competition(db, str(c.id)), user)


@router.delete("/competitions/{competition_id}/leave")
def leave_competition(
    competition_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, str(competition_id))
    member = _is_member(db, c.id, user.id)
    if not member:
        raise HTTPException(404, "Not a member")
    if c.created_by_id == user.id:
        others = [m for m in c.members if m.user_id != user.id]
        if others:
            raise HTTPException(400, "Transfer ownership or cancel before leaving as host")
        c.status = CompetitionStatus.CANCELLED.value
    db.delete(member)
    db.commit()
    return {"ok": True}


@router.delete("/competitions/{competition_id}/members/{member_user_id}")
def remove_member(
    competition_id: UUID,
    member_user_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, str(competition_id))
    if c.created_by_id != user.id:
        raise HTTPException(403, "Only the host can remove players")
    if member_user_id == user.id:
        raise HTTPException(400, "Host cannot remove themselves — leave or cancel instead")
    member = _is_member(db, c.id, member_user_id)
    if not member:
        raise HTTPException(404, "Player is not in this competition")
    db.delete(member)
    # Rotate invite code so a removed player cannot rejoin with the old code
    c.invite_code = _invite_code()
    db.commit()
    return {"ok": True, "invite_code": c.invite_code}


@router.patch("/competitions/{competition_id}/status", response_model=CompetitionOut)
def set_competition_status(
    competition_id: UUID,
    status: str = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, str(competition_id))
    if c.created_by_id != user.id:
        raise HTTPException(403, "Only the owner can change status")
    status = status.upper()
    if status not in {s.value for s in CompetitionStatus}:
        raise HTTPException(400, "Invalid status")
    if status == CompetitionStatus.COMPLETED.value:
        pending = (
            db.query(CommunityMatch)
            .filter(
                CommunityMatch.competition_id == c.id,
                CommunityMatch.status == "AWAITING_CONFIRM",
                CommunityMatch.ratings_applied.is_(False),
            )
            .count()
        )
        if pending:
            raise HTTPException(
                400,
                f"Cancel or confirm {pending} pending score(s) before marking complete",
            )
    c.status = status
    db.commit()
    return _competition_out(db, _resolve_competition(db, str(c.id)), user)


# ── Community matches ─────────────────────────────────────────


@router.get("/competitions/{slug_or_id}/matches", response_model=list[CommunityMatchOut])
def list_matches(
    slug_or_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, slug_or_id)
    if not _is_member(db, c.id, user.id):
        raise HTTPException(404, "Competition not found")
    matches = (
        db.query(CommunityMatch)
        .filter(CommunityMatch.competition_id == c.id)
        .order_by(CommunityMatch.created_at.desc())
        .all()
    )
    return [_match_out(db, m, viewer=user, competition=c) for m in matches]


@router.post("/competitions/{competition_id}/matches", response_model=CommunityMatchOut)
def create_match(
    competition_id: UUID,
    body: CommunityMatchCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = _resolve_competition(db, str(competition_id))
    if not _is_member(db, c.id, user.id):
        raise HTTPException(403, "Not a member")
    if c.status in (CompetitionStatus.CANCELLED.value, CompetitionStatus.COMPLETED.value):
        raise HTTPException(400, "Competition is closed")

    fmt = body.format.upper()
    if fmt not in (CompetitionFormat.SINGLES.value, CompetitionFormat.DOUBLES.value):
        raise HTTPException(400, "Match format must be SINGLES or DOUBLES")
    if c.format == CompetitionFormat.SINGLES.value and fmt != CompetitionFormat.SINGLES.value:
        raise HTTPException(400, "This competition is singles-only")
    if c.format == CompetitionFormat.DOUBLES.value and fmt != CompetitionFormat.DOUBLES.value:
        raise HTTPException(400, "This competition is doubles-only")

    member_ids = {m.user_id for m in c.members}
    players = [body.player_a1_id, body.player_b1_id]
    if fmt == CompetitionFormat.DOUBLES.value:
        if not body.player_a2_id or not body.player_b2_id:
            raise HTTPException(400, "Doubles needs four players")
        players.extend([body.player_a2_id, body.player_b2_id])
    else:
        if body.player_a2_id or body.player_b2_id:
            raise HTTPException(400, "Singles cannot include partners")

    if len(set(players)) != len(players):
        raise HTTPException(400, "All players on court must be unique")
    for pid in players:
        if pid not in member_ids:
            raise HTTPException(400, "All players must be competition members")
    if user.id not in players:
        raise HTTPException(400, "You must be playing to log the match")

    court = body.court_number
    max_courts = getattr(c, "number_of_courts", None) or 2
    if court is not None and court > max_courts:
        raise HTTPException(400, f"This competition only has {max_courts} courts")

    m = CommunityMatch(
        competition_id=c.id,
        format=fmt,
        status=MatchStatus.SCHEDULED.value,
        player_a1_id=body.player_a1_id,
        player_a2_id=body.player_a2_id if fmt == CompetitionFormat.DOUBLES.value else None,
        player_b1_id=body.player_b1_id,
        player_b2_id=body.player_b2_id if fmt == CompetitionFormat.DOUBLES.value else None,
        notes=body.notes,
        court_number=court,
        recorded_by_id=user.id,
    )
    db.add(m)
    if c.status == CompetitionStatus.OPEN.value:
        c.status = CompetitionStatus.LIVE.value
    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user, competition=c)


@router.patch("/community-matches/{match_id}/score", response_model=CommunityMatchOut)
def score_community_match(
    request: Request,
    match_id: UUID,
    body: CommunityMatchScore,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rate_limit(request, key="community-score", limit=40, window_seconds=60)
    m = db.get(CommunityMatch, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    c = _resolve_competition(db, str(m.competition_id))
    if not _is_member(db, c.id, user.id):
        raise HTTPException(404, "Match not found")
    if c.status in (CompetitionStatus.CANCELLED.value, CompetitionStatus.COMPLETED.value):
        raise HTTPException(400, "Competition is closed")
    if m.ratings_applied:
        raise HTTPException(400, "This result is locked")
    if user.id not in _match_players(m):
        raise HTTPException(403, "Only players in this match can enter the score")

    status = (body.status or "AWAITING_CONFIRM").upper()
    if status not in ("AWAITING_CONFIRM", MatchStatus.CANCELLED.value):
        # Legacy clients sending COMPLETED → treat as awaiting confirm
        if status == MatchStatus.COMPLETED.value:
            status = "AWAITING_CONFIRM"
        else:
            raise HTTPException(400, "Invalid status")

    if status == MatchStatus.CANCELLED.value:
        if m.status == "AWAITING_CONFIRM" and m.recorded_by_id not in (None, user.id) and user.id != c.created_by_id:
            raise HTTPException(403, "Only the scorer or host can cancel a pending result")
        m.status = status
        m.winner_side = None
        db.commit()
        db.refresh(m)
        return _match_out(db, m, viewer=user, competition=c)

    winner = (body.winner_side or "").upper() or None
    if winner and winner not in ("A", "B"):
        raise HTTPException(400, "winner_side must be A or B")
    inferred = _infer_winner_side(
        body.set1_a, body.set1_b, body.set2_a, body.set2_b, body.set3_a, body.set3_b
    )
    if not winner:
        winner = inferred
    if not winner:
        raise HTTPException(400, "Enter set scores with a clear winner")
    if inferred and winner != inferred:
        raise HTTPException(400, "Winner does not match the set scores")

    m.set1_a, m.set1_b = body.set1_a, body.set1_b
    m.set2_a, m.set2_b = body.set2_a, body.set2_b
    m.set3_a, m.set3_b = body.set3_a, body.set3_b
    m.winner_side = winner
    m.status = "AWAITING_CONFIRM"
    m.recorded_by_id = user.id
    m.confirmed_by_id = None
    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user, competition=c)


@router.post("/community-matches/{match_id}/confirm", response_model=CommunityMatchOut)
def confirm_community_match(
    request: Request,
    match_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Second player on the match confirms the score → ratings apply."""
    rate_limit(request, key="community-confirm", limit=40, window_seconds=60)
    m = db.get(CommunityMatch, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    c = _resolve_competition(db, str(m.competition_id))
    if not _is_member(db, c.id, user.id):
        raise HTTPException(404, "Match not found")
    if c.status in (CompetitionStatus.CANCELLED.value, CompetitionStatus.COMPLETED.value):
        raise HTTPException(400, "Competition is closed")
    if m.ratings_applied:
        return _match_out(db, m, viewer=user, competition=c)
    if m.status != "AWAITING_CONFIRM":
        raise HTTPException(400, "Nothing to confirm yet — enter the score first")
    if user.id not in _match_players(m):
        raise HTTPException(403, "Only players in this match can confirm")
    if m.recorded_by_id == user.id:
        raise HTTPException(400, "Someone else on court needs to confirm your score")

    m.confirmed_by_id = user.id
    rating_changes = _apply_elo(db, m, c)
    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user, competition=c, rating_changes=rating_changes)


@router.patch("/community-matches/{match_id}/court", response_model=CommunityMatchOut)
def set_match_court(
    match_id: UUID,
    body: CommunityMatchCourtUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.get(CommunityMatch, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    c = _resolve_competition(db, str(m.competition_id))
    if not _is_member(db, c.id, user.id):
        raise HTTPException(404, "Match not found")
    if m.ratings_applied:
        raise HTTPException(400, "Finished matches cannot change court")
    max_courts = getattr(c, "number_of_courts", None) or 2
    if body.court_number is not None and body.court_number > max_courts:
        raise HTTPException(400, f"This competition only has {max_courts} courts")
    m.court_number = body.court_number
    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user, competition=c)


@router.get("/community/home", response_model=CommunityHomeOut)
def community_home(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member_rows = db.query(CompetitionMember).filter(CompetitionMember.user_id == user.id).all()
    comp_ids = [m.competition_id for m in member_rows]
    comps: list[CompetitionOut] = []
    if comp_ids:
        rows = (
            db.query(CommunityCompetition)
            .options(
                joinedload(CommunityCompetition.members).joinedload(CompetitionMember.user),
                joinedload(CommunityCompetition.created_by),
            )
            .filter(CommunityCompetition.id.in_(comp_ids))
            .order_by(CommunityCompetition.created_at.desc())
            .all()
        )
        comps = [_competition_out(db, c, user) for c in rows]

    needs_confirm: list[CommunityMatchOut] = []
    needs_score: list[CommunityMatchOut] = []
    my_next: list[CommunityMatchOut] = []
    if comp_ids:
        matches = (
            db.query(CommunityMatch)
            .filter(
                CommunityMatch.competition_id.in_(comp_ids),
                CommunityMatch.status.in_(
                    [MatchStatus.SCHEDULED.value, MatchStatus.LIVE.value, "AWAITING_CONFIRM"]
                ),
            )
            .order_by(CommunityMatch.created_at.asc())
            .limit(80)
            .all()
        )
        for m in matches:
            out = _match_out(db, m, viewer=user)
            if out.needs_my_confirm:
                needs_confirm.append(out)
            elif out.can_i_score:
                needs_score.append(out)
            if user.id in _match_players(m) and m.status != MatchStatus.CANCELLED.value:
                my_next.append(out)
        my_next = my_next[:5]

    friend_request_count = (
        db.query(Friendship)
        .filter(
            Friendship.addressee_id == user.id,
            Friendship.status == FriendshipStatus.PENDING.value,
        )
        .count()
    )
    return CommunityHomeOut(
        competitions=comps,
        needs_confirm=needs_confirm,
        needs_score=needs_score,
        my_next_matches=my_next,
        friend_request_count=friend_request_count,
    )
