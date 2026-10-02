from __future__ import annotations

import re
import secrets
from datetime import date, datetime, timezone
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_optional_user
from app.core.config import get_settings
from app.core.roles import Role
from app.core.security import hash_password
from app.db.session import get_db
from app.models import (
    Announcement,
    CommunityCompetition,
    Court,
    Group,
    GroupTeam,
    Match,
    MatchScore,
    MatchStatus,
    PaymentStatus,
    PlayFormat,
    Ranking,
    Registration,
    Sponsor,
    Team,
    TeamPlayer,
    Tournament,
    TournamentStatus,
    University,
    User,
)

from app.services.rating import INITIAL_RATING, rate_match
from app.schemas import (
    AnnouncementCreate,
    AnnouncementOut,
    CheckInRequest,
    CheckoutResponse,
    GenerateRequest,
    InviteResolveOut,
    MatchMove,
    MatchOut,
    OrganiserAddTeamRequest,
    RegisterTeamRequest,
    ScoreUpdate,
    SponsorOut,
    StandingOut,
    TeamOut,
    TournamentCreate,
    TournamentOut,
    TournamentUpdate,
    UniversityOut,
    UserProfilePublic,
)
from app.services.standings import MatchResult, accumulate_standings, rank_standings
from app.services.tournament_generator import GeneratorConfig, TeamRef, generate_tournament

router = APIRouter(tags=["tournaments"])


def _dublin_tz():
    """Europe/Dublin — fall back to fixed +01:00 if tzdata isn't installed (Windows)."""
    try:
        return ZoneInfo("Europe/Dublin")
    except Exception:
        from datetime import timedelta

        return timezone(timedelta(hours=1), name="IST")


DUBLIN_TZ = _dublin_tz()


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return base[:100] or "tournament"


def _unique_slug(db: Session, name: str) -> str:
    base = _slugify(name)
    slug = base
    i = 2
    while db.query(Tournament).filter(Tournament.slug == slug).first():
        slug = f"{base}-{i}"
        i += 1
    return slug


def _invite_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def _unique_invite_code(db: Session) -> str:
    for _ in range(40):
        code = _invite_code()
        if not db.query(Tournament).filter(Tournament.invite_code == code).first():
            return code
    return _invite_code() + secrets.token_hex(1)[:2].upper()


def _ensure_invite_code(db: Session, t: Tournament) -> str:
    if t.invite_code:
        return t.invite_code
    t.invite_code = _unique_invite_code(db)
    db.add(t)
    # Persist immediately — get_db does not auto-commit, and this runs on GET/list
    db.commit()
    db.refresh(t)
    return t.invite_code


def _clean_invite_code(raw: str) -> str:
    return "".join(ch for ch in (raw or "").strip().upper() if ch.isalnum())[:12]


def _resolve_by_invite_code(db: Session, code: str) -> Tournament:
    cleaned = _clean_invite_code(code)
    if len(cleaned) < 6:
        raise HTTPException(404, "Tournament not found")
    t = db.query(Tournament).filter(Tournament.invite_code == cleaned).first()
    if not t:
        raise HTTPException(404, "Tournament not found")
    return t


def _team_out(team: Team) -> TeamOut:
    names = [m.user.full_name for m in sorted(team.members, key=lambda x: x.slot) if m.user]
    return TeamOut(
        id=team.id,
        tournament_id=team.tournament_id,
        name=team.name,
        university_id=team.university_id,
        seed=team.seed,
        checked_in=team.checked_in,
        withdrawn=team.withdrawn,
        player_names=names,
        payment_status=team.registration.status if team.registration else None,
    )


def _players_already_registered(db: Session, tournament_id: UUID, user_ids: list[UUID]) -> bool:
    return (
        db.query(TeamPlayer)
        .join(Team)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            TeamPlayer.user_id.in_(user_ids),
            Registration.status == PaymentStatus.PAID.value,
        )
        .first()
        is not None
    )


def _paid_team_count(db: Session, tournament_id: UUID) -> int:
    return (
        db.query(Team)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            Registration.status == PaymentStatus.PAID.value,
        )
        .count()
    )


def _team_count(db: Session, tournament_id: UUID) -> int:
    return _paid_team_count(db, tournament_id)


def _deadline_passed(t: Tournament) -> bool:
    if not t.registration_deadline:
        return False
    return date.today() > t.registration_deadline.date()


def _ensure_ranking(db: Session, user_id: UUID) -> None:
    if not db.query(Ranking).filter(Ranking.user_id == user_id).first():
        db.add(Ranking(user_id=user_id, points=INITIAL_RATING))


def _team_user_ids(db: Session, team_id: UUID | None) -> list[UUID]:
    if not team_id:
        return []
    return [
        tp.user_id
        for tp in db.query(TeamPlayer).filter(TeamPlayer.team_id == team_id).all()
        if tp.user_id
    ]


def _apply_tournament_match_ratings(db: Session, m: Match, t: Tournament | None) -> None:
    """Apply Ireland Elo for every completed tournament match, any event or stage."""
    if getattr(m, "ratings_applied", False):
        return
    if m.status not in (MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value):
        return
    if not m.winner_id or not m.team_a_id or not m.team_b_id:
        return
    side_a = _team_user_ids(db, m.team_a_id)
    side_b = _team_user_ids(db, m.team_b_id)
    if not side_a or not side_b:
        return
    score = m.score
    sets = [
        (score.set1_a if score else 0, score.set1_b if score else 0),
        (score.set2_a if score else 0, score.set2_b if score else 0),
        (score.set3_a if score else 0, score.set3_b if score else 0),
    ]
    sets_a = sum(1 for a, b in sets if a > b and (a or b))
    sets_b = sum(1 for a, b in sets if b > a and (a or b))
    rate_match(
        db,
        side_a_user_ids=side_a,
        side_b_user_ids=side_b,
        a_won=(m.winner_id == m.team_a_id),
        sets_a=sets_a,
        sets_b=sets_b,
        tournament_id=m.tournament_id,
        placement=f"t:{(t.slug if t else m.round)}"[:40],
    )
    m.ratings_applied = True


def _tournament_out(db: Session, t: Tournament) -> TournamentOut:
    _ensure_invite_code(db, t)
    courts = (
        db.query(Court)
        .filter(Court.tournament_id == t.id)
        .order_by(Court.court_number)
        .all()
    )
    # Always build plain data — never pass ORM Court objects into the response model
    return TournamentOut(
        id=t.id,
        name=t.name,
        slug=t.slug,
        location=t.location,
        venue=t.venue,
        event_date=t.event_date,
        start_time=t.start_time,
        number_of_courts=t.number_of_courts,
        entry_fee_cents=t.entry_fee_cents,
        currency=t.currency or "EUR",
        max_teams=t.max_teams,
        registration_deadline=t.registration_deadline,
        format=t.format,
        play_format=getattr(t, "play_format", None) or PlayFormat.DOUBLES.value,
        rules=t.rules,
        description=t.description,
        status=t.status,
        organiser_id=t.organiser_id,
        match_duration_minutes=t.match_duration_minutes,
        group_size=t.group_size,
        teams_advance_per_group=t.teams_advance_per_group,
        registered_teams=_team_count(db, t.id),
        invite_code=t.invite_code,
        courts=[
            {"number": c.court_number, "name": c.name, "id": str(c.id)} for c in courts
        ],
    )


def _court_label_map(db: Session, tournament_id: UUID) -> dict[int, str]:
    return {
        c.court_number: c.name
        for c in db.query(Court).filter(Court.tournament_id == tournament_id).all()
    }


def _match_out(db: Session, m: Match, court_names: dict[int, str] | None = None) -> MatchOut:
    team_a = db.get(Team, m.team_a_id) if m.team_a_id else None
    team_b = db.get(Team, m.team_b_id) if m.team_b_id else None
    score = None
    if m.score:
        score = {
            "set1_a": m.score.set1_a,
            "set1_b": m.score.set1_b,
            "set2_a": m.score.set2_a,
            "set2_b": m.score.set2_b,
            "set3_a": m.score.set3_a,
            "set3_b": m.score.set3_b,
            "current_set": m.score.current_set,
        }
    names = court_names if court_names is not None else _court_label_map(db, m.tournament_id)
    court_name = None
    if m.court_number is not None:
        court_name = names.get(m.court_number) or f"Court {m.court_number}"
    return MatchOut(
        id=m.id,
        tournament_id=m.tournament_id,
        round=m.round,
        stage=m.stage,
        court_number=m.court_number,
        court_name=court_name,
        scheduled_start=m.scheduled_start,
        team_a_id=m.team_a_id,
        team_b_id=m.team_b_id,
        team_a_name=team_a.name if team_a else None,
        team_b_name=team_b.name if team_b else None,
        team_a_placeholder=m.team_a_placeholder,
        team_b_placeholder=m.team_b_placeholder,
        status=m.status,
        winner_id=m.winner_id,
        score=score,
        ratings_applied=bool(getattr(m, "ratings_applied", False)),
    )


def _default_court_name(i: int) -> str:
    return f"Court {i}"


def _sync_courts(
    db: Session,
    tournament_id: UUID,
    number_of_courts: int,
    court_names: list[str] | None = None,
) -> None:
    """Add/remove/rename courts without wiping custom names unnecessarily."""
    existing = (
        db.query(Court)
        .filter(Court.tournament_id == tournament_id)
        .order_by(Court.court_number)
        .all()
    )
    by_num = {c.court_number: c for c in existing}

    for i in range(1, number_of_courts + 1):
        desired = (
            court_names[i - 1].strip()
            if court_names and i - 1 < len(court_names) and court_names[i - 1].strip()
            else _default_court_name(i)
        )
        if i in by_num:
            if court_names is not None:
                by_num[i].name = desired
            by_num[i].is_active = True
        else:
            db.add(Court(tournament_id=tournament_id, name=desired, court_number=i))

    for num, court in by_num.items():
        if num > number_of_courts:
            db.delete(court)


def _is_singles(t: Tournament) -> bool:
    return (getattr(t, "play_format", None) or PlayFormat.DOUBLES.value) == PlayFormat.SINGLES.value


def _parse_group_placeholder(label: str | None) -> tuple[str, int] | None:
    """Parse '1st Group A' → ('A', 1). Returns None for BYE / Winner match…"""
    if not label:
        return None
    text = label.strip()
    if text.upper() == "BYE" or text.upper() == "TBD":
        return None
    import re

    m = re.match(r"^(1st|2nd|3rd|4th|\d+th)\s+Group\s+([A-Z]+)$", text, re.I)
    if not m:
        return None
    ordinal = m.group(1).lower()
    group = m.group(2).upper()
    rank_map = {"1st": 1, "2nd": 2, "3rd": 3, "4th": 4}
    if ordinal in rank_map:
        rank = rank_map[ordinal]
    else:
        rank = int(ordinal.replace("th", ""))
    return group, rank


def _group_standings_ranked(
    db: Session, t: Tournament, group: Group
) -> list[UUID]:
    """Return team IDs in ranked order for a group."""
    tie_order = [x.strip() for x in (t.tie_break_order or "").split(",") if x.strip()]
    gts = db.query(GroupTeam).filter(GroupTeam.group_id == group.id).all()
    team_ids = [str(gt.team_id) for gt in gts]
    matches = (
        db.query(Match)
        .options(joinedload(Match.score))
        .filter(
            Match.group_id == group.id,
            Match.status.in_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value]),
        )
        .all()
    )
    results = []
    for m in matches:
        if not m.team_a_id or not m.team_b_id:
            continue
        sets = []
        if m.score:
            sets = [
                (m.score.set1_a, m.score.set1_b),
                (m.score.set2_a, m.score.set2_b),
                (m.score.set3_a, m.score.set3_b),
            ]
            sets = [(a, b) for a, b in sets if a or b]
        results.append(
            MatchResult(
                str(m.team_a_id),
                str(m.team_b_id),
                sets,
                walkover_winner_id=str(m.winner_id)
                if m.status == MatchStatus.WALKOVER.value and m.winner_id
                else None,
                status=m.status,
            )
        )
    rows = accumulate_standings(team_ids, results)
    ranked = rank_standings(rows, tie_order or None)
    return [UUID(r.team_id) for r in ranked]


def _seed_knockout_from_standings(db: Session, t: Tournament) -> int:
    """
    Fill first-round KO slots from finished group standings.
    Also auto-advances BYE sides. Returns number of slots filled.
    """
    groups = db.query(Group).filter(Group.tournament_id == t.id).order_by(Group.sort_order).all()
    if not groups:
        return 0

    # All group matches must be finished
    unfinished = (
        db.query(Match)
        .filter(
            Match.tournament_id == t.id,
            Match.stage == "GROUP",
            Match.status.notin_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value, MatchStatus.CANCELLED.value]),
        )
        .count()
    )
    if unfinished > 0:
        return 0

    ranked_by_group: dict[str, list[UUID]] = {}
    for g in groups:
        ranked_by_group[g.name.upper()] = _group_standings_ranked(db, t, g)

    advance = t.teams_advance_per_group or 2
    first_round = (
        db.query(Match)
        .filter(Match.tournament_id == t.id, Match.stage == "KNOCKOUT")
        .order_by(Match.sort_order)
        .all()
    )
    if not first_round:
        return 0

    # First KO round = matches that are fed INTO by nothing from other KO, or lowest sort
    # Identify first round by round name of earliest KO matches
    first_round_name = first_round[0].round
    first_matches = [m for m in first_round if m.round == first_round_name]

    filled = 0

    def resolve_slot(label: str | None) -> UUID | None:
        if not label or label.upper() in ("BYE", "TBD"):
            return None
        parsed = _parse_group_placeholder(label)
        if not parsed:
            return None
        gname, rank = parsed
        teams = ranked_by_group.get(gname, [])
        if 1 <= rank <= len(teams) and rank <= advance:
            return teams[rank - 1]
        return None

    for m in first_matches:
        # Skip if already has both teams
        changed = False
        if not m.team_a_id:
            tid = resolve_slot(m.team_a_placeholder)
            if tid:
                m.team_a_id = tid
                m.team_a_placeholder = None
                changed = True
                filled += 1
            elif m.team_a_placeholder and m.team_a_placeholder.upper() == "BYE":
                m.team_a_placeholder = "BYE"
        if not m.team_b_id:
            tid = resolve_slot(m.team_b_placeholder)
            if tid:
                m.team_b_id = tid
                m.team_b_placeholder = None
                changed = True
                filled += 1
            elif m.team_b_placeholder and m.team_b_placeholder.upper() == "BYE":
                m.team_b_placeholder = "BYE"

        # Auto-advance bye: one team present, other is BYE
        a_bye = (m.team_a_placeholder or "").upper() == "BYE" and not m.team_a_id
        b_bye = (m.team_b_placeholder or "").upper() == "BYE" and not m.team_b_id
        winner = None
        if m.team_a_id and b_bye and not m.team_b_id:
            winner = m.team_a_id
            m.team_b_placeholder = "BYE"
        elif m.team_b_id and a_bye and not m.team_a_id:
            winner = m.team_b_id
            m.team_a_placeholder = "BYE"
        if winner and m.status not in (MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value):
            m.winner_id = winner
            m.status = MatchStatus.WALKOVER.value
            if m.next_match_id and m.next_match_slot:
                nxt = db.get(Match, m.next_match_id)
                if nxt:
                    if m.next_match_slot == "A":
                        nxt.team_a_id = winner
                        nxt.team_a_placeholder = None
                    else:
                        nxt.team_b_id = winner
                        nxt.team_b_placeholder = None
            changed = True
        if changed:
            db.add(m)

    return filled


def _assert_organiser(user: User, tournament: Tournament) -> None:
    if user.role == Role.ADMIN.value:
        return
    if tournament.organiser_id != user.id:
        raise HTTPException(403, "Not the tournament organiser")


# ── Universities ──────────────────────────────────────────────

@router.get("/universities", response_model=list[UniversityOut])
def list_universities(db: Session = Depends(get_db)):
    return db.query(University).filter(University.is_active.is_(True)).order_by(University.name).all()


# ── Tournaments ───────────────────────────────────────────────

@router.get("/tournaments", response_model=list[TournamentOut])
def list_tournaments(
    status_filter: str | None = Query(None, alias="status"),
    upcoming: bool = False,
    db: Session = Depends(get_db),
):
    q = db.query(Tournament)
    if status_filter:
        q = q.filter(Tournament.status == status_filter)
    if upcoming:
        q = q.filter(
            Tournament.status.in_(
                [
                    TournamentStatus.REGISTRATION_OPEN.value,
                    TournamentStatus.REGISTRATION_CLOSED.value,
                    TournamentStatus.LIVE.value,
                ]
            )
        )
    tournaments = q.order_by(Tournament.event_date.desc()).all()
    return [_tournament_out(db, t) for t in tournaments]


@router.get("/tournaments/{slug_or_id}", response_model=TournamentOut)
def get_tournament(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    return _tournament_out(db, t)


def _resolve_tournament(db: Session, slug_or_id: str) -> Tournament:
    try:
        tid = UUID(slug_or_id)
        t = db.get(Tournament, tid)
    except ValueError:
        t = db.query(Tournament).filter(Tournament.slug == slug_or_id).first()
    if not t:
        raise HTTPException(404, "Tournament not found")
    return t


@router.post("/tournaments", response_model=TournamentOut)
def create_tournament(
    body: TournamentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = Tournament(
        name=body.name.strip(),
        slug=_unique_slug(db, body.name),
        location=body.location,
        venue=body.venue,
        event_date=body.event_date,
        start_time=body.start_time,
        number_of_courts=body.number_of_courts,
        entry_fee_cents=body.entry_fee_cents,
        max_teams=body.max_teams,
        registration_deadline=body.registration_deadline,
        format=body.format.value,
        play_format=body.play_format.value,
        rules=body.rules,
        description=body.description,
        status=TournamentStatus.DRAFT.value,
        organiser_id=user.id,
        match_duration_minutes=body.match_duration_minutes,
        group_size=body.group_size,
        teams_advance_per_group=body.teams_advance_per_group,
        invite_code=_unique_invite_code(db),
        tie_break_order=body.tie_break_order
        or "points,head_to_head,set_difference,game_difference,games_won",
    )
    db.add(t)
    db.flush()
    _sync_courts(db, t.id, body.number_of_courts, body.court_names)
    db.commit()
    db.refresh(t)
    return _tournament_out(db, t)


@router.patch("/tournaments/{tournament_id}", response_model=TournamentOut)
def update_tournament(
    tournament_id: UUID,
    body: TournamentUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    data = body.model_dump(exclude_unset=True)
    court_names = data.pop("court_names", None)
    for field, value in data.items():
        if hasattr(value, "value"):
            value = value.value
        setattr(t, field, value)
    if body.number_of_courts is not None or court_names is not None:
        _sync_courts(
            db,
            t.id,
            t.number_of_courts,
            court_names if court_names is not None else None,
        )
    db.commit()
    db.refresh(t)
    return _tournament_out(db, t)


# ── Registration / Teams ──────────────────────────────────────

@router.get("/invite/{invite_code}", response_model=InviteResolveOut)
def resolve_invite_code(invite_code: str, db: Session = Depends(get_db)):
    """Find a tournament or community competition by invite code.

    One lookup so players can paste a code on any Join box.
    """
    cleaned = _clean_invite_code(invite_code)
    if len(cleaned) < 6:
        raise HTTPException(404, "Invite code not found")

    t = db.query(Tournament).filter(Tournament.invite_code == cleaned).first()
    if t:
        return InviteResolveOut(
            kind="tournament",
            slug=t.slug,
            name=t.name,
            invite_code=cleaned,
            join_path=f"/t/{t.slug}/join",
            hint="Tournament event: register to play",
        )

    c = db.query(CommunityCompetition).filter(CommunityCompetition.invite_code == cleaned).first()
    if c:
        return InviteResolveOut(
            kind="competition",
            slug=c.slug,
            name=c.name,
            invite_code=cleaned,
            join_path=f"/community/join/{cleaned}",
            hint="Friend group / community competition",
        )

    raise HTTPException(404, "Invite code not found. Check the code and try again.")


@router.get("/tournaments/code/{invite_code}", response_model=TournamentOut)
def get_tournament_by_invite_code(invite_code: str, db: Session = Depends(get_db)):
    t = _resolve_by_invite_code(db, invite_code)
    return _tournament_out(db, t)


@router.post("/tournaments/{tournament_id}/register", response_model=CheckoutResponse)
def register_team(
    tournament_id: UUID,
    body: RegisterTeamRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if t.status != TournamentStatus.REGISTRATION_OPEN.value:
        raise HTTPException(400, "Registration is not open")
    if _deadline_passed(t):
        raise HTTPException(400, "Registration deadline has passed")
    if _paid_team_count(db, t.id) >= t.max_teams:
        raise HTTPException(400, "Tournament is full")

    singles = _is_singles(t)
    partner: User | None = None

    if singles:
        if body.partner_user_id or body.partner_email:
            raise HTTPException(400, "This is a singles tournament — no partner needed")
    else:
        if body.partner_user_id:
            partner = db.get(User, body.partner_user_id)
            if not partner or not partner.is_active:
                raise HTTPException(400, "Partner not found")
        elif body.partner_email:
            partner = db.query(User).filter(User.email == body.partner_email.lower()).first()
            if not partner:
                name = (body.partner_name or "").strip()
                if len(name) < 2:
                    raise HTTPException(400, "Partner name is required for a new email")
                partner = User(
                    email=body.partner_email.lower(),
                    password_hash=hash_password(str(uuid4())),
                    full_name=name,
                    role="PLAYER",
                    university_id=body.university_id,
                    must_set_password=True,
                )
                db.add(partner)
                db.flush()
                _ensure_ranking(db, partner.id)
        else:
            raise HTTPException(400, "Pick a partner from your friends or enter their email")

        if partner.id == user.id:
            raise HTTPException(400, "Partner must be a different player")

    player_ids = [user.id] if singles else [user.id, partner.id]  # type: ignore[union-attr]
    if _players_already_registered(db, t.id, player_ids):
        raise HTTPException(
            400,
            "You are already registered for this tournament"
            if singles
            else "You or your partner are already registered for this tournament",
        )

    pending_mine = (
        db.query(Registration)
        .join(Team, Registration.team_id == Team.id)
        .join(TeamPlayer, TeamPlayer.team_id == Team.id)
        .filter(
            Team.tournament_id == t.id,
            Team.withdrawn.is_(False),
            TeamPlayer.user_id == user.id,
            Registration.status == PaymentStatus.PENDING.value,
        )
        .first()
    )
    if pending_mine:
        team = db.get(Team, pending_mine.team_id)
        if team:
            team.name = body.team_name.strip()
            if not singles and partner:
                # Refresh partner on slot 2
                slot2 = (
                    db.query(TeamPlayer)
                    .filter(TeamPlayer.team_id == team.id, TeamPlayer.slot == 2)
                    .first()
                )
                if slot2:
                    if slot2.user_id != partner.id:
                        if _players_already_registered(db, t.id, [partner.id]):
                            raise HTTPException(400, "That partner is already registered")
                        slot2.user_id = partner.id
                        slot2.invitation_accepted = bool(body.partner_user_id)
                else:
                    db.add(
                        TeamPlayer(
                            team_id=team.id,
                            user_id=partner.id,
                            slot=2,
                            invitation_accepted=bool(body.partner_user_id),
                        )
                    )
        return _issue_checkout(db, t, team, pending_mine)

    team = Team(
        tournament_id=t.id,
        name=body.team_name.strip(),
        university_id=body.university_id or user.university_id,
    )
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=user.id, slot=1, invitation_accepted=True))
    if partner:
        db.add(
            TeamPlayer(
                team_id=team.id,
                user_id=partner.id,
                slot=2,
                invitation_accepted=bool(body.partner_user_id),
            )
        )

    if body.phone and not user.phone:
        user.phone = body.phone
    if body.student_number and not user.student_number:
        user.student_number = body.student_number

    reg = Registration(
        tournament_id=t.id,
        team_id=team.id,
        status=PaymentStatus.PENDING.value,
        amount_cents=t.entry_fee_cents,
        currency=t.currency,
    )
    db.add(reg)
    db.flush()

    return _issue_checkout(db, t, team, reg)


@router.post("/tournaments/{tournament_id}/organiser-add-team", response_model=TeamOut)
def organiser_add_team(
    tournament_id: UUID,
    body: OrganiserAddTeamRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Organiser adds a team from known players (marks entry as paid)."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    if t.status in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        raise HTTPException(400, "Cannot add teams to a finished tournament")
    if _paid_team_count(db, t.id) >= t.max_teams:
        raise HTTPException(400, "Tournament is full")

    singles = _is_singles(t)
    p1 = db.get(User, body.player1_id)
    if not p1 or not p1.is_active:
        raise HTTPException(400, "Player 1 was not found")

    p2: User | None = None
    if singles:
        if body.player2_id:
            raise HTTPException(400, "Singles tournaments only need one player")
    else:
        if not body.player2_id:
            raise HTTPException(400, "Pick two players for doubles")
        if body.player1_id == body.player2_id:
            raise HTTPException(400, "Pick two different players")
        p2 = db.get(User, body.player2_id)
        if not p2 or not p2.is_active:
            raise HTTPException(400, "Player 2 was not found")

    ids = [p1.id] if singles else [p1.id, p2.id]  # type: ignore[union-attr]
    if _players_already_registered(db, t.id, ids):
        raise HTTPException(400, "One of these players is already in this tournament")

    team = Team(
        tournament_id=t.id,
        name=body.team_name.strip(),
        university_id=body.university_id or p1.university_id or (p2.university_id if p2 else None),
    )
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=p1.id, slot=1, invitation_accepted=True))
    _ensure_ranking(db, p1.id)
    if p2:
        db.add(TeamPlayer(team_id=team.id, user_id=p2.id, slot=2, invitation_accepted=True))
        _ensure_ranking(db, p2.id)

    reg = Registration(
        tournament_id=t.id,
        team_id=team.id,
        status=PaymentStatus.PAID.value,
        amount_cents=0,
        currency=t.currency,
        paid_at=datetime.now(timezone.utc),
    )
    db.add(reg)
    db.commit()
    db.refresh(team)
    team = (
        db.query(Team)
        .options(joinedload(Team.members).joinedload(TeamPlayer.user), joinedload(Team.registration))
        .filter(Team.id == team.id)
        .first()
    )
    return _team_out(team)


def _issue_checkout(db: Session, t: Tournament, team: Team | None, reg: Registration) -> CheckoutResponse:
    if not team:
        raise HTTPException(404, "Team not found")

    # Free entry — mark paid immediately (Stripe rejects €0 line items)
    if t.entry_fee_cents <= 0:
        from app.services.payments import mark_registration_paid

        mark_registration_paid(db, reg, stripe_payment_id="free_entry")
        db.commit()
        return CheckoutResponse(
            checkout_url=None,
            registration_id=reg.id,
            demo_mode=True,
            message="Registration confirmed — free entry.",
        )

    settings = get_settings()
    if settings.stripe_secret_key:
        import stripe

        stripe.api_key = settings.stripe_secret_key
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": t.currency.lower(),
                        "product_data": {"name": f"{t.name} - {team.name}"},
                        "unit_amount": t.entry_fee_cents,
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{settings.frontend_url}/t/{t.slug}/confirmed?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.frontend_url}/t/{t.slug}/join?cancelled=1",
            metadata={"registration_id": str(reg.id), "tournament_id": str(t.id)},
        )
        reg.stripe_session_id = session.id
        db.commit()
        return CheckoutResponse(
            checkout_url=session.url,
            registration_id=reg.id,
            demo_mode=False,
            message="Redirect to Stripe Checkout",
        )

    from app.services.payments import mark_registration_paid

    mark_registration_paid(db, reg, stripe_payment_id="demo_payment")
    db.commit()
    return CheckoutResponse(
        checkout_url=None,
        registration_id=reg.id,
        demo_mode=True,
        message="Registration confirmed (demo payment). Set STRIPE_SECRET_KEY for live payments.",
    )


@router.get("/registrations/{registration_id}")
def get_registration(
    registration_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reg = db.get(Registration, registration_id)
    if not reg:
        raise HTTPException(404, "Registration not found")
    return _registration_payload(db, reg, user)


@router.get("/payments/confirm")
def confirm_payment_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.payments import confirm_stripe_session

    reg = confirm_stripe_session(db, session_id)
    if not reg:
        reg = db.query(Registration).filter(Registration.stripe_session_id == session_id).first()
    if not reg:
        raise HTTPException(404, "Payment session not found or not paid yet")
    return _registration_payload(db, reg, user)


def _registration_payload(db: Session, reg: Registration, user: User) -> dict:
    team = db.get(Team, reg.team_id)
    if not team:
        raise HTTPException(404, "Team not found")
    members = (
        db.query(TeamPlayer)
        .options(joinedload(TeamPlayer.user))
        .filter(TeamPlayer.team_id == team.id)
        .order_by(TeamPlayer.slot)
        .all()
    )
    t = db.get(Tournament, reg.tournament_id)
    member_ids = {m.user_id for m in members}
    if (
        user.id not in member_ids
        and user.role != Role.ADMIN.value
        and (not t or t.organiser_id != user.id)
    ):
        raise HTTPException(403, "Not allowed to view this registration")
    return {
        "registration_id": str(reg.id),
        "status": reg.status,
        "amount_cents": reg.amount_cents,
        "currency": reg.currency,
        "paid_at": reg.paid_at.isoformat() if reg.paid_at else None,
        "tournament": _tournament_out(db, t) if t else None,
        "team_name": team.name,
        "players": [m.user.full_name for m in members if m.user],
    }


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(400, "Stripe not configured")

    import json

    import stripe

    stripe.api_key = settings.stripe_secret_key
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        if settings.stripe_webhook_secret:
            event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
        else:
            event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
    except Exception as exc:
        raise HTTPException(400, f"Webhook error: {exc}") from exc

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        from app.services.payments import confirm_stripe_session

        confirm_stripe_session(db, session["id"])
    return {"received": True}


@router.get("/tournaments/{tournament_id}/teams", response_model=list[TeamOut])
def list_teams(tournament_id: UUID, db: Session = Depends(get_db)):
    teams = (
        db.query(Team)
        .options(joinedload(Team.members).joinedload(TeamPlayer.user), joinedload(Team.registration))
        .filter(Team.tournament_id == tournament_id, Team.withdrawn.is_(False))
        .all()
    )
    out = []
    for team in teams:
        names = [m.user.full_name for m in sorted(team.members, key=lambda x: x.slot)]
        out.append(
            TeamOut(
                id=team.id,
                tournament_id=team.tournament_id,
                name=team.name,
                university_id=team.university_id,
                seed=team.seed,
                checked_in=team.checked_in,
                withdrawn=team.withdrawn,
                player_names=names,
                payment_status=team.registration.status if team.registration else None,
            )
        )
    return out


@router.post("/tournaments/{tournament_id}/teams/{team_id}/check-in", response_model=TeamOut)
def check_in_team(
    tournament_id: UUID,
    team_id: UUID,
    body: CheckInRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    team = db.get(Team, team_id)
    if not team or team.tournament_id != tournament_id:
        raise HTTPException(404, "Team not found")
    team.player1_present = body.player1_present
    if _is_singles(t):
        team.player2_present = True
        team.checked_in = body.player1_present
    else:
        team.player2_present = body.player2_present
        team.checked_in = body.player1_present and body.player2_present
    db.commit()
    return TeamOut(
        id=team.id,
        tournament_id=team.tournament_id,
        name=team.name,
        university_id=team.university_id,
        seed=team.seed,
        checked_in=team.checked_in,
        withdrawn=team.withdrawn,
        player_names=[],
        payment_status=None,
    )


@router.post("/tournaments/{tournament_id}/teams/{team_id}/withdraw", response_model=TeamOut)
def withdraw_team(
    tournament_id: UUID,
    team_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Withdraw a team. Unpaid/pending entries can always be removed; paid only before LIVE."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    team = db.get(Team, team_id)
    if not team or team.tournament_id != tournament_id or team.withdrawn:
        raise HTTPException(404, "Team not found")

    paid = team.registration and team.registration.status == PaymentStatus.PAID.value
    if paid and t.status in (TournamentStatus.LIVE.value, TournamentStatus.COMPLETED.value):
        raise HTTPException(400, "Cannot withdraw a paid team after the event is live")

    # Don't remove paid teams already placed in fixtures without regenerate
    if paid:
        in_draw = (
            db.query(Match)
            .filter(
                Match.tournament_id == tournament_id,
                ((Match.team_a_id == team.id) | (Match.team_b_id == team.id)),
            )
            .first()
        )
        if in_draw:
            raise HTTPException(
                400,
                "This team is already in the draw. Regenerate the tournament after withdrawing, "
                "or withdraw only unpaid entries.",
            )

    team.withdrawn = True
    team.checked_in = False
    if team.registration and team.registration.status in (
        PaymentStatus.PENDING.value,
        PaymentStatus.FAILED.value,
        PaymentStatus.CANCELLED.value,
    ):
        team.registration.status = PaymentStatus.CANCELLED.value
    db.commit()
    return TeamOut(
        id=team.id,
        tournament_id=team.tournament_id,
        name=team.name,
        university_id=team.university_id,
        seed=team.seed,
        checked_in=team.checked_in,
        withdrawn=team.withdrawn,
        player_names=[],
        payment_status=team.registration.status if team.registration else None,
    )


# ── Generate ──────────────────────────────────────────────────

@router.post("/tournaments/{tournament_id}/generate")
def generate(
    tournament_id: UUID,
    body: GenerateRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)

    if t.status in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        raise HTTPException(400, "Cannot regenerate a finished tournament")

    completed_count = (
        db.query(Match)
        .filter(
            Match.tournament_id == tournament_id,
            Match.status.in_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value]),
        )
        .count()
    )
    if completed_count > 0 and t.status == TournamentStatus.LIVE.value:
        raise HTTPException(
            400,
            "Cannot regenerate while the event is live with completed matches. "
            "Mark the tournament back to registration closed first if you really need to rebuild.",
        )

    paid_teams = (
        db.query(Team)
        .join(Registration)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            Registration.status == PaymentStatus.PAID.value,
        )
        .all()
    )
    if len(paid_teams) < 2:
        raise HTTPException(400, "Need at least 2 paid teams to generate")

    # Clear previous generation (SQLite-safe)
    existing_match_ids = [m.id for m in db.query(Match.id).filter(Match.tournament_id == tournament_id).all()]
    if existing_match_ids:
        db.query(MatchScore).filter(MatchScore.match_id.in_(existing_match_ids)).delete(synchronize_session=False)
    # Break self-FK before delete
    db.query(Match).filter(Match.tournament_id == tournament_id).update(
        {Match.next_match_id: None}, synchronize_session=False
    )
    db.query(Match).filter(Match.tournament_id == tournament_id).delete(synchronize_session=False)
    existing_group_ids = [g.id for g in db.query(Group.id).filter(Group.tournament_id == tournament_id).all()]
    if existing_group_ids:
        db.query(GroupTeam).filter(GroupTeam.group_id.in_(existing_group_ids)).delete(synchronize_session=False)
    db.query(Group).filter(Group.tournament_id == tournament_id).delete(synchronize_session=False)

    body = body or GenerateRequest()
    courts = body.courts or t.number_of_courts
    duration = body.match_duration_minutes or t.match_duration_minutes
    group_size = body.group_size or t.group_size
    advance = body.teams_advance_per_group or t.teams_advance_per_group

    # Persist overrides so regenerate stays consistent
    t.number_of_courts = courts
    t.match_duration_minutes = duration
    t.group_size = group_size
    t.teams_advance_per_group = advance
    _sync_courts(db, t.id, courts)

    # Seed teams
    for i, team in enumerate(sorted(paid_teams, key=lambda x: x.name), start=1):
        team.seed = i

    start_dt = datetime.combine(t.event_date, t.start_time, tzinfo=DUBLIN_TZ).astimezone(timezone.utc)
    config = GeneratorConfig(
        teams=[TeamRef(id=str(tm.id), name=tm.name, seed=tm.seed) for tm in paid_teams],
        courts=courts,
        match_duration_minutes=duration,
        start_time=start_dt,
        group_size=group_size,
        teams_advance_per_group=advance,
        format=t.format,
    )
    generated = generate_tournament(config)

    court_by_num = {
        c.court_number: c
        for c in db.query(Court).filter(Court.tournament_id == t.id).all()
    }

    group_map: dict[str, Group] = {}
    for g in generated.groups:
        grp = Group(tournament_id=t.id, name=g.name, sort_order=g.sort_order)
        db.add(grp)
        db.flush()
        group_map[g.name] = grp
        for idx, tid in enumerate(g.team_ids):
            db.add(GroupTeam(group_id=grp.id, team_id=UUID(tid), seed_in_group=idx + 1))

    created_matches: list[Match] = []
    for gm in generated.matches:
        court = court_by_num.get(gm.court_number) if gm.court_number else None
        m = Match(
            tournament_id=t.id,
            round=gm.round,
            stage=gm.stage,
            group_id=group_map[gm.group_name].id if gm.group_name else None,
            court_id=court.id if court else None,
            court_number=gm.court_number,
            scheduled_start=gm.scheduled_start,
            team_a_id=UUID(gm.team_a_id) if gm.team_a_id else None,
            team_b_id=UUID(gm.team_b_id) if gm.team_b_id else None,
            team_a_placeholder=gm.team_a_placeholder,
            team_b_placeholder=gm.team_b_placeholder,
            status=MatchStatus.SCHEDULED.value,
            sort_order=gm.sort_order,
        )
        db.add(m)
        db.flush()
        created_matches.append(m)

    # Wire knockout next_match links
    ko_gens = [gm for gm in generated.matches if gm.stage == "KNOCKOUT"]
    ko_db = [m for m in created_matches if m.stage == "KNOCKOUT"]
    for i, gm in enumerate(ko_gens):
        if gm.feeds_into_index is not None and gm.feeds_into_index < len(ko_db):
            ko_db[i].next_match_id = ko_db[gm.feeds_into_index].id
            ko_db[i].next_match_slot = gm.feeds_into_slot

    if t.status in (TournamentStatus.REGISTRATION_OPEN.value, TournamentStatus.REGISTRATION_CLOSED.value, TournamentStatus.DRAFT.value):
        t.status = TournamentStatus.REGISTRATION_CLOSED.value

    db.commit()
    return {
        "groups": len(generated.groups),
        "matches": len(created_matches),
        "knockout_rounds": generated.knockout_rounds,
    }


# ── Matches / Scores ──────────────────────────────────────────

@router.get("/tournaments/{slug_or_id}/matches", response_model=list[MatchOut])
def list_matches(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    matches = (
        db.query(Match)
        .options(joinedload(Match.score))
        .filter(Match.tournament_id == t.id)
        .order_by(Match.sort_order)
        .all()
    )
    return [_match_out(db, m) for m in matches]


@router.patch("/matches/{match_id}/score", response_model=MatchOut)
def update_score(
    match_id: UUID,
    body: ScoreUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    t = db.get(Tournament, m.tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)

    if getattr(m, "ratings_applied", False):
        if not body.force:
            raise HTTPException(
                400,
                "This match already updated ratings. Re-save with force to correct the score "
                "(standings update; Ireland ratings stay as first recorded).",
            )
        correcting = True
    else:
        correcting = False

    if body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER, MatchStatus.LIVE):
        if not m.team_a_id or not m.team_b_id:
            raise HTTPException(400, "Both teams must be set before scoring this match")

    if not m.score:
        m.score = MatchScore(match_id=m.id)
        db.add(m.score)
    m.score.set1_a = body.set1_a
    m.score.set1_b = body.set1_b
    m.score.set2_a = body.set2_a
    m.score.set2_b = body.set2_b
    m.score.set3_a = body.set3_a
    m.score.set3_b = body.set3_b
    m.score.current_set = body.current_set
    m.score.entered_by_id = user.id
    m.status = body.status.value

    winner_id = body.winner_id
    if body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER) and not winner_id:
        # Infer winner from sets when organiser marks completed without picking
        sets = [
            (body.set1_a, body.set1_b),
            (body.set2_a, body.set2_b),
            (body.set3_a, body.set3_b),
        ]
        a_sets = sum(1 for a, b in sets if a > b and (a or b))
        b_sets = sum(1 for a, b in sets if b > a and (a or b))
        if a_sets > b_sets:
            winner_id = m.team_a_id
        elif b_sets > a_sets:
            winner_id = m.team_b_id

    if winner_id:
        if winner_id not in (m.team_a_id, m.team_b_id):
            raise HTTPException(400, "Winner must be one of the match teams")
        m.winner_id = winner_id
        if m.next_match_id and m.next_match_slot:
            nxt = db.get(Match, m.next_match_id)
            if nxt:
                if m.next_match_slot == "A":
                    nxt.team_a_id = winner_id
                    nxt.team_a_placeholder = None
                else:
                    nxt.team_b_id = winner_id
                    nxt.team_b_placeholder = None
    elif body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER):
        raise HTTPException(400, "Completed matches need a winner (or set scores that determine one)")

    if not correcting:
        _apply_tournament_match_ratings(db, m, t)

    # When group stage finishes, seed knockout placeholders → real teams
    if t and m.stage == "GROUP" and body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER):
        _seed_knockout_from_standings(db, t)
        if t.status != TournamentStatus.LIVE.value:
            t.status = TournamentStatus.LIVE.value

    db.commit()
    db.refresh(m)
    return _match_out(db, m)


@router.patch("/matches/{match_id}", response_model=MatchOut)
def move_match(
    match_id: UUID,
    body: MatchMove,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    t = db.get(Tournament, m.tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        data["status"] = data["status"].value
    for k, v in data.items():
        setattr(m, k, v)
    _apply_tournament_match_ratings(db, m, t)
    db.commit()
    db.refresh(m)
    return _match_out(db, m)


# ── Standings ─────────────────────────────────────────────────

@router.get("/tournaments/{slug_or_id}/standings")
def get_standings(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    groups = db.query(Group).filter(Group.tournament_id == t.id).order_by(Group.sort_order).all()
    tie_order = [x.strip() for x in (t.tie_break_order or "").split(",") if x.strip()]
    out = []
    for g in groups:
        gts = db.query(GroupTeam).filter(GroupTeam.group_id == g.id).all()
        team_ids = [str(gt.team_id) for gt in gts]
        matches = (
            db.query(Match)
            .options(joinedload(Match.score))
            .filter(Match.group_id == g.id, Match.status.in_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value]))
            .all()
        )
        results = []
        for m in matches:
            if not m.team_a_id or not m.team_b_id:
                continue
            sets = []
            if m.score:
                sets = [
                    (m.score.set1_a, m.score.set1_b),
                    (m.score.set2_a, m.score.set2_b),
                    (m.score.set3_a, m.score.set3_b),
                ]
                sets = [(a, b) for a, b in sets if a or b]
            results.append(
                MatchResult(
                    str(m.team_a_id),
                    str(m.team_b_id),
                    sets,
                    walkover_winner_id=str(m.winner_id) if m.status == MatchStatus.WALKOVER.value and m.winner_id else None,
                    status=m.status,
                )
            )
        rows = accumulate_standings(team_ids, results)
        ranked = rank_standings(rows, tie_order or None)
        standings = []
        for r in ranked:
            team = db.get(Team, UUID(r.team_id))
            standings.append(
                StandingOut(
                    team_id=UUID(r.team_id),
                    team_name=team.name if team else r.team_id,
                    played=r.played,
                    wins=r.wins,
                    losses=r.losses,
                    points=r.points,
                    sets_won=r.sets_won,
                    sets_lost=r.sets_lost,
                    games_won=r.games_won,
                    games_lost=r.games_lost,
                    set_difference=r.set_difference,
                    game_difference=r.game_difference,
                )
            )
        out.append({"group": g.name, "standings": standings})
    return out


# ── Announcements / Sponsors / Player view ────────────────────

@router.get("/tournaments/{slug_or_id}/announcements", response_model=list[AnnouncementOut])
def list_announcements(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    return (
        db.query(Announcement)
        .filter(Announcement.tournament_id == t.id)
        .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
        .all()
    )


@router.post("/tournaments/{tournament_id}/announcements", response_model=AnnouncementOut)
def create_announcement(
    tournament_id: UUID,
    body: AnnouncementCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    a = Announcement(
        tournament_id=t.id,
        title=body.title,
        body=body.body,
        is_pinned=body.is_pinned,
        created_by_id=user.id,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@router.get("/tournaments/{slug_or_id}/sponsors", response_model=list[SponsorOut])
def list_sponsors(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    return db.query(Sponsor).filter(Sponsor.tournament_id == t.id).all()


@router.get("/tournaments/{slug_or_id}/player-view")
def player_view(
    slug_or_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    t = _resolve_tournament(db, slug_or_id)
    my_team = None
    my_payment_status = None
    next_match = None
    my_results = []
    my_upcoming: list = []
    if user:
        memberships = (
            db.query(TeamPlayer)
            .join(Team)
            .filter(Team.tournament_id == t.id, TeamPlayer.user_id == user.id, Team.withdrawn.is_(False))
            .all()
        )
        membership = None
        for mp in memberships:
            team = db.get(Team, mp.team_id)
            if team and team.registration and team.registration.status == PaymentStatus.PAID.value:
                membership = mp
                break
        if membership is None and memberships:
            membership = memberships[0]
        if membership:
            my_team = (
                db.query(Team)
                .options(joinedload(Team.registration))
                .filter(Team.id == membership.team_id)
                .first()
            )
            if my_team and my_team.registration:
                my_payment_status = my_team.registration.status
            # Only expose fixtures for paid entries
            if my_team and my_payment_status == PaymentStatus.PAID.value:
                upcoming = (
                    db.query(Match)
                    .options(joinedload(Match.score))
                    .filter(
                        Match.tournament_id == t.id,
                        Match.status.in_(
                            [
                                MatchStatus.SCHEDULED.value,
                                MatchStatus.CALLED.value,
                                MatchStatus.LIVE.value,
                            ]
                        ),
                        ((Match.team_a_id == my_team.id) | (Match.team_b_id == my_team.id)),
                    )
                    .order_by(Match.scheduled_start)
                    .all()
                )
                my_upcoming = [_match_out(db, m) for m in upcoming]
                next_match = my_upcoming[0] if my_upcoming else None
                done = (
                    db.query(Match)
                    .options(joinedload(Match.score))
                    .filter(
                        Match.tournament_id == t.id,
                        Match.status.in_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value]),
                        ((Match.team_a_id == my_team.id) | (Match.team_b_id == my_team.id)),
                    )
                    .order_by(Match.scheduled_start)
                    .all()
                )
                for m in done:
                    my_results.append(_match_out(db, m))

    live = (
        db.query(Match)
        .options(joinedload(Match.score))
        .filter(Match.tournament_id == t.id, Match.status == MatchStatus.LIVE.value)
        .all()
    )
    court_names = _court_label_map(db, t.id)
    announcements = (
        db.query(Announcement)
        .filter(Announcement.tournament_id == t.id)
        .order_by(Announcement.is_pinned.desc(), Announcement.created_at.desc())
        .limit(8)
        .all()
    )
    return {
        "tournament": _tournament_out(db, t),
        "my_team": (
            {"id": my_team.id, "name": my_team.name, "payment_status": my_payment_status}
            if my_team
            else None
        ),
        "next_match": next_match,
        "my_upcoming": my_upcoming,
        "my_results": my_results,
        "live_matches": [_match_out(db, m, court_names) for m in live],
        "standings": get_standings(slug_or_id, db),
        "announcements": [
            {
                "id": a.id,
                "title": a.title,
                "body": a.body,
                "is_pinned": a.is_pinned,
                "created_at": a.created_at,
            }
            for a in announcements
        ],
    }


@router.get("/tournaments/{slug_or_id}/display")
def tv_display(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    court_names = _court_label_map(db, t.id)
    matches = (
        db.query(Match)
        .options(joinedload(Match.score))
        .filter(
            Match.tournament_id == t.id,
            Match.status.in_([MatchStatus.LIVE.value, MatchStatus.CALLED.value, MatchStatus.SCHEDULED.value]),
        )
        .order_by(Match.court_number, Match.scheduled_start)
        .all()
    )
    by_court: dict[int, list] = {}
    for m in matches:
        if m.court_number is None:
            continue
        by_court.setdefault(m.court_number, []).append(_match_out(db, m, court_names))
    return {
        "tournament": _tournament_out(db, t),
        "courts": by_court,
        "court_names": {str(k): v for k, v in court_names.items()},
        "live_count": sum(1 for m in matches if m.status == MatchStatus.LIVE.value),
    }


@router.post("/tournaments/{tournament_id}/seed-knockout")
def seed_knockout(
    tournament_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually seed knockout from group standings (also runs automatically when groups finish)."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t)
    filled = _seed_knockout_from_standings(db, t)
    if filled == 0:
        unfinished = (
            db.query(Match)
            .filter(
                Match.tournament_id == t.id,
                Match.stage == "GROUP",
                Match.status.notin_(
                    [MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value, MatchStatus.CANCELLED.value]
                ),
            )
            .count()
        )
        if unfinished:
            raise HTTPException(400, f"Finish all group matches first ({unfinished} remaining)")
        raise HTTPException(400, "No knockout slots to fill (already seeded or no knockout)")
    db.commit()
    return {"filled": filled}


@router.get("/rankings")
def rankings(limit: int = 50, db: Session = Depends(get_db)):
    from app.models import ProfileMedia, Ranking
    from app.api.profiles import _api_media_path, _public_url
    from sqlalchemy.orm import aliased

    AvatarMedia = aliased(ProfileMedia)
    rows = (
        db.query(Ranking, User, University, AvatarMedia)
        .join(User, Ranking.user_id == User.id)
        .outerjoin(University, User.university_id == University.id)
        .outerjoin(
            AvatarMedia,
            (AvatarMedia.user_id == User.id) & (AvatarMedia.is_avatar.is_(True)),
        )
        .filter(or_(Ranking.matches_played > 0, Ranking.tournaments_played > 0))
        .order_by(Ranking.points.desc(), Ranking.wins.desc())
        .limit(limit)
        .all()
    )
    out = []
    for i, (r, u, uni, avatar_m) in enumerate(rows):
        if avatar_m is not None:
            avatar = _public_url(_api_media_path(avatar_m.id))
        else:
            avatar = _public_url(u.avatar_url)
        out.append(
            UserProfilePublic(
                id=u.id,
                full_name=u.full_name,
                university_name=uni.name if uni else None,
                university_short=uni.short_name if uni else None,
                points=r.points,
                rank_ireland=r.rank_ireland or (i + 1),
                tournaments_played=r.tournaments_played,
                matches_played=r.matches_played,
                wins=r.wins,
                losses=r.losses,
                bio=u.bio,
                avatar_url=avatar,
            )
        )
    return out


@router.get("/players/{user_id}", response_model=UserProfilePublic)
def player_profile(
    user_id: UUID,
    viewer=Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    from app.api.profiles import _profile_out

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(404, "Player not found")
    return _profile_out(db, user, viewer)


@router.get("/organiser/dashboard")
def organiser_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Tournament)
    if user.role != Role.ADMIN.value:
        q = q.filter(Tournament.organiser_id == user.id)
    tournaments = q.order_by(Tournament.event_date.desc()).all()
    stats = []
    for t in tournaments:
        teams = _team_count(db, t.id)
        paid = (
            db.query(Registration)
            .filter(Registration.tournament_id == t.id, Registration.status == PaymentStatus.PAID.value)
            .count()
        )
        revenue = (
            db.query(Registration)
            .filter(Registration.tournament_id == t.id, Registration.status == PaymentStatus.PAID.value)
            .all()
        )
        live = (
            db.query(Match)
            .filter(Match.tournament_id == t.id, Match.status == MatchStatus.LIVE.value)
            .count()
        )
        completed = (
            db.query(Match)
            .filter(Match.tournament_id == t.id, Match.status == MatchStatus.COMPLETED.value)
            .count()
        )
        checked = (
            db.query(Team)
            .join(Registration, Registration.team_id == Team.id)
            .filter(
                Team.tournament_id == t.id,
                Team.checked_in.is_(True),
                Team.withdrawn.is_(False),
                Registration.status == PaymentStatus.PAID.value,
            )
            .count()
        )
        per_team = 1 if _is_singles(t) else 2
        stats.append(
            {
                "tournament": _tournament_out(db, t),
                "teams": teams,
                "players": teams * per_team,
                "paid_registrations": paid,
                "revenue_cents": sum(r.amount_cents for r in revenue),
                "live_matches": live,
                "completed_matches": completed,
                "checked_in": checked,
            }
        )
    return {"tournaments": stats}
