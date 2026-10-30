from __future__ import annotations

import logging
import re
import secrets
from datetime import date, datetime, timezone
from urllib.parse import quote
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import case, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_optional_user, user_can_manage_tournament, user_owns_tournament
from app.core.config import get_settings
from app.core.roles import Role
from app.core.security import hash_password
from app.db.session import get_db
from app.models import (
    Announcement,
    CommunityCompetition,
    Court,
    Friendship,
    FriendshipStatus,
    Group,
    GroupTeam,
    Match,
    MatchScore,
    MatchStatus,
    Payment,
    PaymentStatus,
    PlayFormat,
    Ranking,
    RankingHistory,
    Registration,
    Sponsor,
    Team,
    TeamPlayer,
    Tournament,
    TournamentAdmin,
    TournamentRegistrationAnswer,
    TournamentRegistrationField,
    TournamentStatus,
    University,
    User,
)

from app.services.email import send_email
from app.services.rating import INITIAL_RATING, rate_match
from app.services.registration_fields import (
    answers_for_team,
    field_to_out,
    list_fields,
    save_answers_for_registration,
    sync_registration_fields,
)
from app.schemas import (
    AnnouncementCreate,
    AnnouncementOut,
    AnnouncementUpdate,
    CheckInRequest,
    CheckoutResponse,
    GenerateRequest,
    InviteResolveOut,
    MatchMove,
    MatchOut,
    OrganiserAddTeamRequest,
    PartnerInviteRespond,
    PayOnlineNowRequest,
    PlayerScoreSubmit,
    RegisterTeamRequest,
    ScoreUpdate,
    SponsorOut,
    StandingOut,
    TeamOut,
    TournamentAdminCreate,
    TournamentAdminOut,
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
    """Europe/Dublin - fall back to fixed +01:00 if tzdata isn't installed (Windows)."""
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
    # Persist immediately - get_db does not auto-commit, and this runs on GET/list
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


def _payment_via(reg: Registration | None) -> str | None:
    if not reg:
        return None
    if reg.status != PaymentStatus.PAID.value:
        return None
    pid = (reg.stripe_payment_intent_id or "").strip().lower()
    if pid in {"pay_on_arrival", "collected_on_arrival", "free_entry", "demo_payment"}:
        return pid
    if pid or reg.stripe_session_id:
        return "online"
    return "online"


def _unique_player_names(members) -> list[str]:
    """Roster names by slot, skipping duplicate user ids (and blank names)."""
    names: list[str] = []
    seen: set = set()
    for m in sorted((x for x in members if getattr(x, "user", None)), key=lambda x: x.slot):
        uid = m.user_id
        if uid in seen:
            continue
        seen.add(uid)
        label = (m.user.full_name or "").strip()
        if label:
            names.append(label)
    return names


def _team_out(team: Team, db: Session | None = None) -> TeamOut:
    names = _unique_player_names(team.members)
    custom = answers_for_team(db, team) if db is not None else []
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
        payment_via=_payment_via(team.registration),
        custom_answers=custom,
    )


def _active_entry_statuses() -> tuple[str, ...]:
    """PENDING and PAID both occupy a tournament slot for a player."""
    return (PaymentStatus.PENDING.value, PaymentStatus.PAID.value)


def _players_already_registered(
    db: Session,
    tournament_id: UUID,
    user_ids: list[UUID],
    *,
    exclude_registration_id: UUID | None = None,
) -> bool:
    q = (
        db.query(TeamPlayer)
        .join(Team)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            TeamPlayer.user_id.in_(user_ids),
            Registration.status.in_(_active_entry_statuses()),
        )
    )
    if exclude_registration_id:
        q = q.filter(Registration.id != exclude_registration_id)
    return q.first() is not None


def _membership_for_user(
    db: Session, tournament_id: UUID, user_id: UUID
) -> tuple[TeamPlayer, Team, Registration] | None:
    status_rank = case(
        (Registration.status == PaymentStatus.PAID.value, 0),
        else_=1,
    )
    row = (
        db.query(TeamPlayer, Team, Registration)
        .join(Team, Team.id == TeamPlayer.team_id)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            TeamPlayer.user_id == user_id,
            Registration.status.in_(_active_entry_statuses()),
        )
        .order_by(status_rank)
        .first()
    )
    return row


def _are_friends(db: Session, a: UUID, b: UUID) -> bool:
    return (
        db.query(Friendship)
        .filter(
            Friendship.status == FriendshipStatus.ACCEPTED.value,
            or_(
                (Friendship.requester_id == a) & (Friendship.addressee_id == b),
                (Friendship.requester_id == b) & (Friendship.addressee_id == a),
            ),
        )
        .first()
        is not None
    )


def _friendship_between(db: Session, a: UUID, b: UUID) -> Friendship | None:
    return (
        db.query(Friendship)
        .filter(
            or_(
                (Friendship.requester_id == a) & (Friendship.addressee_id == b),
                (Friendship.requester_id == b) & (Friendship.addressee_id == a),
            ),
        )
        .first()
    )


def _ensure_pending_friendship(db: Session, requester_id: UUID, addressee_id: UUID) -> Friendship | None:
    """Ensure a friendship exists; create PENDING from requester→addressee if none. No-op if already friends."""
    if requester_id == addressee_id:
        return None
    existing = _friendship_between(db, requester_id, addressee_id)
    if existing:
        if existing.status == FriendshipStatus.ACCEPTED.value:
            return existing
        if existing.status == FriendshipStatus.PENDING.value:
            return existing
        # Declined / other - reopen as pending from captain
        existing.requester_id = requester_id
        existing.addressee_id = addressee_id
        existing.status = FriendshipStatus.PENDING.value
        db.add(existing)
        return existing
    fr = Friendship(
        requester_id=requester_id,
        addressee_id=addressee_id,
        status=FriendshipStatus.PENDING.value,
    )
    db.add(fr)
    db.flush()
    return fr


logger = logging.getLogger(__name__)


def _notify_email_partner(
    *,
    captain: User,
    partner: User,
    tournament: Tournament,
    needs_signup: bool,
) -> None:
    """Tell an email-invited partner to claim their spot or open the event."""
    settings = get_settings()
    next_path = quote(f"/t/{tournament.slug}", safe="")
    if needs_signup or getattr(partner, "must_set_password", False):
        signup_url = f"{settings.frontend_url}/signup?next={next_path}"
        subject = f"Join {captain.full_name} for {tournament.name}"
        text = (
            f"Hi {partner.full_name},\n\n"
            f"{captain.full_name} added you as their doubles partner for "
            f"{tournament.name} on Student Padel Ireland.\n\n"
            f"You're already on the team - create your account with this same email "
            f"({partner.email}) to see your matches:\n{signup_url}\n\n"
            f"If you can't play, open the event and leave the team so your partner can re-enter.\n\n"
            f"See you on court,\nStudent Padel Ireland\n"
        )
    else:
        event_url = f"{settings.frontend_url}/t/{tournament.slug}"
        subject = f"You're on a team for {tournament.name}"
        text = (
            f"Hi {partner.full_name},\n\n"
            f"{captain.full_name} registered you as their partner for "
            f"{tournament.name} on Student Padel Ireland.\n\n"
            f"You're already on the team. Open the app to Accept (become friends) "
            f"or Decline (leave the team so they can pick someone else).\n"
            f"Open the tournament:\n{event_url}\n\n"
            f"If you can't play, leave the team from that page so your partner can re-enter.\n\n"
            f"Student Padel Ireland\n"
        )
    try:
        send_email(to=partner.email, subject=subject, text=text, reply_to=captain.email)
    except Exception:
        logger.exception("Partner invite email failed for %s", partner.email)


def _conflict_message(db: Session, tournament_id: UUID, you: UUID, partner: UUID | None, singles: bool) -> str:
    your = _membership_for_user(db, tournament_id, you)
    if your:
        _tp, team, reg = your
        if reg.status == PaymentStatus.PAID.value:
            return "You are already registered for this tournament"
        if _tp.slot != 1:
            return (
                f"You're already listed as a partner on “{team.name}”. "
                "Leave that entry from the tournament page, or wait for your teammate to finish payment."
            )
        return (
            f"You already started an entry (“{team.name}”). "
            "Finish payment below, update your details, or leave the entry from the tournament page."
        )
    if partner:
        theirs = _membership_for_user(db, tournament_id, partner)
        if theirs:
            _tp, team, reg = theirs
            status = "registered" if reg.status == PaymentStatus.PAID.value else "already entered on a pending team"
            return f"Your partner is {status} for this tournament (“{team.name}”)"
    return (
        "You are already registered for this tournament"
        if singles
        else "You or your partner are already entered in this tournament"
    )


def _team_member_count(db: Session, team_id: UUID) -> int:
    return db.query(TeamPlayer).filter(TeamPlayer.team_id == team_id).count()


def _doubles_team_complete(db: Session, team_id: UUID) -> bool:
    return _team_member_count(db, team_id) >= 2


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
    deadline = t.registration_deadline
    # Naive datetimes from the DB are treated as UTC (API stores ISO with Z)
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > deadline.astimezone(timezone.utc)


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


def _user_team_on_match(db: Session, m: Match, user_id: UUID) -> UUID | None:
    """Return the team_id the user belongs to on this match, or None."""
    if m.team_a_id and user_id in _team_user_ids(db, m.team_a_id):
        return m.team_a_id
    if m.team_b_id and user_id in _team_user_ids(db, m.team_b_id):
        return m.team_b_id
    return None


def _same_match_side(db: Session, m: Match, user_a: UUID, user_b: UUID) -> bool:
    side_a = set(_team_user_ids(db, m.team_a_id))
    side_b = set(_team_user_ids(db, m.team_b_id))
    return (user_a in side_a and user_b in side_a) or (user_a in side_b and user_b in side_b)


def _infer_winner_id_from_sets(
    m: Match,
    set1_a: int,
    set1_b: int,
    set2_a: int,
    set2_b: int,
    set3_a: int,
    set3_b: int,
) -> UUID | None:
    sets = [(set1_a, set1_b), (set2_a, set2_b), (set3_a, set3_b)]
    a_sets = sum(1 for a, b in sets if a > b and (a or b))
    b_sets = sum(1 for a, b in sets if b > a and (a or b))
    if a_sets > b_sets:
        return m.team_a_id
    if b_sets > a_sets:
        return m.team_b_id
    return None


def _require_best_of_three_winner(
    m: Match,
    set1_a: int,
    set1_b: int,
    set2_a: int,
    set2_b: int,
    set3_a: int,
    set3_b: int,
) -> UUID:
    """Best of 3: one side must win two sets; no tied sets; set 3 only if split."""
    sets = [(set1_a, set1_b), (set2_a, set2_b), (set3_a, set3_b)]
    played: list[tuple[int, int]] = []
    for a, b in sets:
        if a == 0 and b == 0:
            continue
        if a == b:
            raise HTTPException(400, "Set scores can’t be tied")
        played.append((a, b))
    if len(played) < 2:
        raise HTTPException(400, "Enter at least two sets (best of 3)")
    a_sets = sum(1 for a, b in played if a > b)
    b_sets = sum(1 for a, b in played if b > a)
    if max(a_sets, b_sets) < 2:
        raise HTTPException(400, "One side needs two sets to win")
    if a_sets == 2 and b_sets == 0 and (set3_a or set3_b):
        raise HTTPException(400, "Clear set 3 when the match finished 2–0")
    if b_sets == 2 and a_sets == 0 and (set3_a or set3_b):
        raise HTTPException(400, "Clear set 3 when the match finished 2–0")
    winner_id = m.team_a_id if a_sets > b_sets else m.team_b_id
    if not winner_id:
        raise HTTPException(400, "Both teams must be set before scoring")
    return winner_id


def _advance_winner_to_next(db: Session, m: Match, winner_id: UUID) -> None:
    if not m.next_match_id or not m.next_match_slot:
        return
    nxt = db.get(Match, m.next_match_id)
    if not nxt:
        return
    slot_team = nxt.team_a_id if m.next_match_slot == "A" else nxt.team_b_id
    if nxt.status in (
        MatchStatus.LIVE.value,
        MatchStatus.COMPLETED.value,
        MatchStatus.WALKOVER.value,
        MatchStatus.AWAITING_CONFIRM.value,
    ):
        # Idempotent: already seated - don't block confirm of the prior match
        if slot_team == winner_id:
            return
        raise HTTPException(
            400,
            "Cannot change the winner - the next knockout match has already started or finished",
        )
    previous_winner = m.winner_id
    if m.next_match_slot == "A":
        if previous_winner and previous_winner != winner_id and nxt.next_match_id:
            deeper = db.get(Match, nxt.next_match_id)
            if deeper and deeper.status == MatchStatus.SCHEDULED.value:
                if deeper.team_a_id == previous_winner:
                    deeper.team_a_id = None
                    deeper.team_a_placeholder = "TBD"
                if deeper.team_b_id == previous_winner:
                    deeper.team_b_id = None
                    deeper.team_b_placeholder = "TBD"
        nxt.team_a_id = winner_id
        nxt.team_a_placeholder = None
    else:
        if previous_winner and previous_winner != winner_id and nxt.next_match_id:
            deeper = db.get(Match, nxt.next_match_id)
            if deeper and deeper.status == MatchStatus.SCHEDULED.value:
                if deeper.team_a_id == previous_winner:
                    deeper.team_a_id = None
                    deeper.team_a_placeholder = "TBD"
                if deeper.team_b_id == previous_winner:
                    deeper.team_b_id = None
                    deeper.team_b_placeholder = "TBD"
        nxt.team_b_id = winner_id
        nxt.team_b_placeholder = None


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


def _tournament_out(
    db: Session,
    t: Tournament,
    *,
    viewer: User | None = None,
    viewer_entered: bool | None = None,
) -> TournamentOut:
    _ensure_invite_code(db, t)
    courts = (
        db.query(Court)
        .filter(Court.tournament_id == t.id)
        .order_by(Court.court_number)
        .all()
    )
    can_manage = bool(viewer and user_can_manage_tournament(viewer, t, db))
    reg_fields = [field_to_out(f) for f in list_fields(db, t.id)]
    entered = bool(viewer_entered) if viewer_entered is not None else False
    if viewer and viewer_entered is None:
        entered = (
            db.query(TeamPlayer.id)
            .join(Team, Team.id == TeamPlayer.team_id)
            .filter(
                Team.tournament_id == t.id,
                Team.withdrawn.is_(False),
                TeamPlayer.user_id == viewer.id,
            )
            .limit(1)
            .first()
            is not None
        )
    # Always build plain data - never pass ORM Court objects into the response model
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
        pay_on_arrival=bool(getattr(t, "pay_on_arrival", False)),
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
        enable_plate=bool(getattr(t, "enable_plate", False)),
        championship_size=int(getattr(t, "championship_size", 16) or 16),
        plate_size=int(getattr(t, "plate_size", 16) or 16),
        registered_teams=_team_count(db, t.id),
        invite_code=t.invite_code,
        is_official=bool(getattr(t, "is_official", False)),
        courts=[
            {"number": c.court_number, "name": c.name, "id": str(c.id)} for c in courts
        ],
        registration_fields=reg_fields,
        can_manage=can_manage,
        viewer_entered=entered,
    )


def _court_label_map(db: Session, tournament_id: UUID) -> dict[int, str]:
    return {
        c.court_number: c.name
        for c in db.query(Court).filter(Court.tournament_id == tournament_id).all()
    }


def _match_out(
    db: Session,
    m: Match,
    court_names: dict[int, str] | None = None,
    viewer: User | None = None,
) -> MatchOut:
    team_a = db.get(Team, m.team_a_id) if m.team_a_id else None
    team_b = db.get(Team, m.team_b_id) if m.team_b_id else None
    score = None
    entered_by_id = None
    confirmed_by_id = None
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
        entered_by_id = m.score.entered_by_id
        confirmed_by_id = getattr(m.score, "confirmed_by_id", None)
    names = court_names if court_names is not None else _court_label_map(db, m.tournament_id)
    court_name = None
    if m.court_number is not None:
        court_name = names.get(m.court_number) or f"Court {m.court_number}"

    can_i_score = False
    needs_my_confirm = False
    score_submitted_by_me = False
    if viewer and not getattr(m, "ratings_applied", False):
        on_team = _user_team_on_match(db, m, viewer.id)
        if on_team:
            if m.status == MatchStatus.AWAITING_CONFIRM.value:
                # Treat pending score as team-side so a doubles partner can edit/cancel
                score_submitted_by_me = bool(
                    entered_by_id and _same_match_side(db, m, viewer.id, entered_by_id)
                )
                needs_my_confirm = bool(
                    entered_by_id
                    and not confirmed_by_id
                    and not _same_match_side(db, m, viewer.id, entered_by_id)
                )
            elif m.status in (
                MatchStatus.SCHEDULED.value,
                MatchStatus.CALLED.value,
                MatchStatus.LIVE.value,
            ):
                can_i_score = bool(m.team_a_id and m.team_b_id)

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
        entered_by_id=entered_by_id,
        confirmed_by_id=confirmed_by_id,
        sort_order=int(getattr(m, "sort_order", 0) or 0),
        next_match_id=m.next_match_id,
        next_match_slot=m.next_match_slot,
        can_i_score=can_i_score,
        needs_my_confirm=needs_my_confirm,
        score_submitted_by_me=score_submitted_by_me,
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
                walkover_winner_id=_standings_walkover_winner(m, sets),
                status=m.status,
            )
        )
    rows = accumulate_standings(team_ids, results)
    ranked = rank_standings(rows, tie_order or None)
    return [UUID(r.team_id) for r in ranked]


def _standings_walkover_winner(m: Match, sets: list[tuple[int, int]]) -> str | None:
    """Use explicit winner when sets don't decide (0-0 COMPLETED / walkover)."""
    if not m.winner_id:
        return None
    if m.status == MatchStatus.WALKOVER.value:
        return str(m.winner_id)
    if m.status == MatchStatus.COMPLETED.value:
        a_sets = sum(1 for a, b in sets if a > b)
        b_sets = sum(1 for a, b in sets if b > a)
        if a_sets == b_sets:
            return str(m.winner_id)
    return None


def _parse_seed_placeholder(label: str | None, prefix: str) -> int | None:
    """Parse 'Championship seed 3' / 'Plate seed 12' → seed number."""
    if not label:
        return None
    import re

    m = re.match(rf"^{re.escape(prefix)}\s+(\d+)$", label.strip(), re.I)
    return int(m.group(1)) if m else None


def _ordered_group_qualifiers(
    groups: list[Group], ranked_by_group: dict[str, list[UUID]]
) -> list[UUID]:
    """
    Flatten standings into a global qualifier list:
    all 1sts (group order), then all 2nds, then 3rds, …
    """
    max_rank = max((len(v) for v in ranked_by_group.values()), default=0)
    out: list[UUID] = []
    seen: set[UUID] = set()
    for rank in range(1, max_rank + 1):
        for g in groups:
            teams = ranked_by_group.get(g.name.upper(), [])
            if rank <= len(teams):
                tid = teams[rank - 1]
                if tid not in seen:
                    seen.add(tid)
                    out.append(tid)
    return out


def _fill_first_round_slots(
    db: Session,
    first_matches: list[Match],
    resolve_slot,
) -> int:
    """Fill team slots + auto-advance byes. Returns slots filled."""
    filled = 0
    for m in first_matches:
        changed = False
        if not m.team_a_id:
            tid = resolve_slot(m.team_a_placeholder)
            if tid:
                m.team_a_id = tid
                m.team_a_placeholder = None
                changed = True
                filled += 1
            elif m.team_a_placeholder:
                m.team_a_placeholder = "BYE"
                changed = True
        if not m.team_b_id:
            tid = resolve_slot(m.team_b_placeholder)
            if tid:
                m.team_b_id = tid
                m.team_b_placeholder = None
                changed = True
                filled += 1
            elif m.team_b_placeholder:
                m.team_b_placeholder = "BYE"
                changed = True

        a_bye = (m.team_a_placeholder or "").upper() == "BYE" and not m.team_a_id
        b_bye = (m.team_b_placeholder or "").upper() == "BYE" and not m.team_b_id
        winner = None
        if m.team_a_id and b_bye and not m.team_b_id:
            winner = m.team_a_id
            m.team_b_placeholder = "BYE"
        elif m.team_b_id and a_bye and not m.team_a_id:
            winner = m.team_b_id
            m.team_a_placeholder = "BYE"
        elif a_bye and b_bye and m.status not in (
            MatchStatus.COMPLETED.value,
            MatchStatus.WALKOVER.value,
        ):
            m.status = MatchStatus.CANCELLED.value
            changed = True
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


def _seed_knockout_from_standings(db: Session, t: Tournament) -> int:
    """
    Fill first-round KO / Plate slots from finished group standings.
    Also auto-advances BYE sides. Returns number of slots filled.
    """
    groups = db.query(Group).filter(Group.tournament_id == t.id).order_by(Group.sort_order).all()
    if not groups:
        return 0

    unfinished = (
        db.query(Match)
        .filter(
            Match.tournament_id == t.id,
            Match.stage == "GROUP",
            Match.status.notin_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value]),
        )
        .count()
    )
    if unfinished > 0:
        return 0

    ranked_by_group: dict[str, list[UUID]] = {}
    for g in groups:
        ranked_by_group[g.name.upper()] = _group_standings_ranked(db, t, g)

    filled = 0
    enable_plate = bool(getattr(t, "enable_plate", False))

    if enable_plate:
        qualifiers = _ordered_group_qualifiers(groups, ranked_by_group)
        champ_n = int(getattr(t, "championship_size", 16) or 16)
        plate_n = int(getattr(t, "plate_size", 16) or 16)
        champ_seeds = {i + 1: tid for i, tid in enumerate(qualifiers[:champ_n])}
        plate_seeds = {
            i + 1: tid for i, tid in enumerate(qualifiers[champ_n : champ_n + plate_n])
        }

        for stage, prefix, seed_map in (
            ("KNOCKOUT", "Championship seed", champ_seeds),
            ("PLATE", "Plate seed", plate_seeds),
        ):
            stage_matches = (
                db.query(Match)
                .filter(Match.tournament_id == t.id, Match.stage == stage)
                .order_by(Match.sort_order)
                .all()
            )
            if not stage_matches:
                continue
            first_name = stage_matches[0].round
            first_matches = [m for m in stage_matches if m.round == first_name]

            def resolve_seed(label: str | None, _map=seed_map, _prefix=prefix) -> UUID | None:
                if not label or label.upper() in ("BYE", "TBD"):
                    return None
                seed = _parse_seed_placeholder(label, _prefix)
                if seed is None:
                    return None
                return _map.get(seed)

            filled += _fill_first_round_slots(db, first_matches, resolve_seed)
        return filled

    advance = t.teams_advance_per_group or 2
    first_round = (
        db.query(Match)
        .filter(Match.tournament_id == t.id, Match.stage == "KNOCKOUT")
        .order_by(Match.sort_order)
        .all()
    )
    if not first_round:
        return 0

    first_round_name = first_round[0].round
    first_matches = [m for m in first_round if m.round == first_round_name]

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

    return _fill_first_round_slots(db, first_matches, resolve_slot)


def _assert_organiser(user: User, tournament: Tournament, db: Session) -> None:
    """Allow platform ADMIN, primary organiser, or tournament co-admin."""
    if user_can_manage_tournament(user, tournament, db):
        return
    raise HTTPException(403, "Not a tournament organiser")


def _assert_owner(user: User, tournament: Tournament) -> None:
    """Delete, transfer ownership, and manage admin list - owner or platform ADMIN only."""
    if not user_owns_tournament(user, tournament):
        raise HTTPException(403, "Only the tournament owner can do this")


def _purge_tournament(db: Session, t: Tournament) -> None:
    """Delete a tournament and all dependent rows (handles non-cascade FKs)."""
    tid = t.id
    match_ids = [row[0] for row in db.query(Match.id).filter(Match.tournament_id == tid).all()]
    if match_ids:
        db.query(MatchScore).filter(MatchScore.match_id.in_(match_ids)).delete(synchronize_session=False)
        db.query(Match).filter(Match.tournament_id == tid).update(
            {Match.next_match_id: None}, synchronize_session=False
        )
        db.query(Match).filter(Match.tournament_id == tid).delete(synchronize_session=False)

    group_ids = [row[0] for row in db.query(Group.id).filter(Group.tournament_id == tid).all()]
    if group_ids:
        db.query(GroupTeam).filter(GroupTeam.group_id.in_(group_ids)).delete(synchronize_session=False)
        db.query(Group).filter(Group.tournament_id == tid).delete(synchronize_session=False)

    team_ids = [row[0] for row in db.query(Team.id).filter(Team.tournament_id == tid).all()]
    reg_ids = [row[0] for row in db.query(Registration.id).filter(Registration.tournament_id == tid).all()]
    field_ids = [
        row[0]
        for row in db.query(TournamentRegistrationField.id)
        .filter(TournamentRegistrationField.tournament_id == tid)
        .all()
    ]
    if field_ids:
        db.query(TournamentRegistrationAnswer).filter(
            TournamentRegistrationAnswer.field_id.in_(field_ids)
        ).delete(synchronize_session=False)
    if reg_ids:
        db.query(TournamentRegistrationAnswer).filter(
            TournamentRegistrationAnswer.registration_id.in_(reg_ids)
        ).delete(synchronize_session=False)
        db.query(Payment).filter(Payment.registration_id.in_(reg_ids)).delete(synchronize_session=False)
    db.query(Payment).filter(Payment.tournament_id == tid).delete(synchronize_session=False)
    db.query(Registration).filter(Registration.tournament_id == tid).delete(synchronize_session=False)
    if team_ids:
        db.query(TeamPlayer).filter(TeamPlayer.team_id.in_(team_ids)).delete(synchronize_session=False)
        db.query(Team).filter(Team.tournament_id == tid).delete(synchronize_session=False)

    db.query(TournamentRegistrationField).filter(
        TournamentRegistrationField.tournament_id == tid
    ).delete(synchronize_session=False)
    db.query(Announcement).filter(Announcement.tournament_id == tid).delete(synchronize_session=False)
    db.query(Sponsor).filter(Sponsor.tournament_id == tid).delete(synchronize_session=False)
    db.query(Court).filter(Court.tournament_id == tid).delete(synchronize_session=False)
    db.query(TournamentAdmin).filter(TournamentAdmin.tournament_id == tid).delete(synchronize_session=False)
    # Drop history rows rather than nulling FK (works even if column is still NOT NULL)
    db.query(RankingHistory).filter(RankingHistory.tournament_id == tid).delete(synchronize_session=False)
    db.delete(t)


# ── Universities ──────────────────────────────────────────────

@router.get("/universities", response_model=list[UniversityOut])
def list_universities(db: Session = Depends(get_db)):
    return db.query(University).filter(University.is_active.is_(True)).order_by(University.name).all()


# ── Tournaments ───────────────────────────────────────────────

@router.get("/tournaments", response_model=list[TournamentOut])
def list_tournaments(
    status_filter: str | None = Query(None, alias="status"),
    upcoming: bool = False,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """
    Tournament catalogue for the app.
    - Guests / landing (`upcoming`): official events only.
    - Logged-in players: official events plus personal events they organise,
      admin, or are entered in (private events stay off the public landing).
    """
    status_values = None
    if upcoming:
        status_values = [
            TournamentStatus.REGISTRATION_OPEN.value,
            TournamentStatus.REGISTRATION_CLOSED.value,
            TournamentStatus.LIVE.value,
        ]

    q = db.query(Tournament).filter(Tournament.is_official.is_(True))
    if status_filter:
        q = q.filter(Tournament.status == status_filter)
    if status_values:
        q = q.filter(Tournament.status.in_(status_values))
    by_id: dict = {t.id: t for t in q.all()}

    # Include personal (non-official) events the viewer is involved in
    if user and not upcoming:
        admin_ids = [
            row[0]
            for row in db.query(TournamentAdmin.tournament_id)
            .filter(TournamentAdmin.user_id == user.id)
            .all()
        ]
        personal_filters = [Tournament.organiser_id == user.id]
        if admin_ids:
            personal_filters.append(Tournament.id.in_(admin_ids))
        entered_ids = [
            row[0]
            for row in (
                db.query(Team.tournament_id)
                .join(TeamPlayer, TeamPlayer.team_id == Team.id)
                .filter(
                    TeamPlayer.user_id == user.id,
                    Team.withdrawn.is_(False),
                )
                .distinct()
                .all()
            )
        ]
        if entered_ids:
            personal_filters.append(Tournament.id.in_(entered_ids))
        pq = db.query(Tournament).filter(
            Tournament.is_official.is_(False),
            or_(*personal_filters),
        )
        if status_filter:
            pq = pq.filter(Tournament.status == status_filter)
        for t in pq.all():
            by_id[t.id] = t

    tournaments = sorted(
        by_id.values(),
        key=lambda t: (t.event_date or date.min, t.name or ""),
        reverse=True,
    )

    entered_set: set = set()
    if user and tournaments:
        entered_set = {
            row[0]
            for row in (
                db.query(Team.tournament_id)
                .join(TeamPlayer, TeamPlayer.team_id == Team.id)
                .filter(
                    TeamPlayer.user_id == user.id,
                    Team.withdrawn.is_(False),
                    Team.tournament_id.in_([t.id for t in tournaments]),
                )
                .distinct()
                .all()
            )
        }

    return [
        _tournament_out(db, t, viewer=user, viewer_entered=(t.id in entered_set))
        for t in tournaments
    ]


@router.get("/tournaments/{slug_or_id}", response_model=TournamentOut)
def get_tournament(
    slug_or_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    t = _resolve_tournament(db, slug_or_id)
    return _tournament_out(db, t, viewer=user)


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
    # Only platform admins create publicly listed events (landing + /tournaments).
    is_official = user.role == Role.ADMIN.value
    t = Tournament(
        name=body.name.strip(),
        slug=_unique_slug(db, body.name),
        location=body.location,
        venue=body.venue,
        event_date=body.event_date,
        start_time=body.start_time,
        number_of_courts=body.number_of_courts,
        entry_fee_cents=body.entry_fee_cents,
        pay_on_arrival=bool(body.pay_on_arrival),
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
        enable_plate=bool(body.enable_plate),
        championship_size=body.championship_size,
        plate_size=body.plate_size,
        invite_code=_unique_invite_code(db),
        is_official=is_official,
        tie_break_order=body.tie_break_order
        or "points,head_to_head,set_difference,game_difference,games_won",
    )
    db.add(t)
    db.flush()
    _sync_courts(db, t.id, body.number_of_courts, body.court_names)
    if body.registration_fields:
        sync_registration_fields(db, t.id, body.registration_fields)
    db.commit()
    db.refresh(t)
    return _tournament_out(db, t, viewer=user)


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
    _assert_organiser(user, t, db)
    data = body.model_dump(exclude_unset=True)
    court_names = data.pop("court_names", None)
    # Keep as Pydantic models — model_dump() turns nested fields into dicts
    data.pop("registration_fields", None)
    registration_fields = (
        body.registration_fields if "registration_fields" in body.model_fields_set else None
    )
    new_organiser_id = data.pop("organiser_id", None)
    # Only platform admins can promote/demote public listing
    if "is_official" in data:
        if user.role != Role.ADMIN.value:
            data.pop("is_official", None)
        else:
            data["is_official"] = bool(data["is_official"])

    format_fields = {"format", "play_format"}
    changing_format = any(f in data and getattr(t, f) != (
        data[f].value if hasattr(data[f], "value") else data[f]
    ) for f in format_fields)
    if changing_format:
        fixtures = db.query(Match).filter(Match.tournament_id == t.id).count()
        if fixtures > 0 or t.status in (
            TournamentStatus.LIVE.value,
            TournamentStatus.COMPLETED.value,
            TournamentStatus.CANCELLED.value,
        ):
            raise HTTPException(
                400,
                "Cannot change singles/doubles or bracket format after the draw exists "
                "(or once the event is live). Restore to draft and regenerate if needed.",
            )

    if new_organiser_id is not None:
        _assert_owner(user, t)
        new_owner = db.get(User, new_organiser_id)
        if not new_owner or not new_owner.is_active:
            raise HTTPException(400, "New organiser user not found")
        old_owner_id = t.organiser_id
        t.organiser_id = new_organiser_id
        # Keep previous owner as a co-admin so they aren't locked out abruptly
        if old_owner_id != new_organiser_id:
            existing = (
                db.query(TournamentAdmin)
                .filter(
                    TournamentAdmin.tournament_id == t.id,
                    TournamentAdmin.user_id == old_owner_id,
                )
                .first()
            )
            if not existing:
                db.add(
                    TournamentAdmin(
                        tournament_id=t.id,
                        user_id=old_owner_id,
                        role="MANAGER",
                        added_by_id=user.id,
                    )
                )
            # New owner doesn't need a co-admin row
            db.query(TournamentAdmin).filter(
                TournamentAdmin.tournament_id == t.id,
                TournamentAdmin.user_id == new_organiser_id,
            ).delete(synchronize_session=False)
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
    if registration_fields is not None:
        sync_registration_fields(db, t.id, registration_fields)
    db.commit()
    db.refresh(t)
    return _tournament_out(db, t, viewer=user)


@router.delete("/tournaments/{tournament_id}")
def delete_tournament(
    tournament_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_owner(user, t)
    name = t.name
    _purge_tournament(db, t)
    db.commit()
    return {"ok": True, "deleted": name}


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

    singles = _is_singles(t)

    # Detect resume early so pending captains can finish payment after close/full
    my_entry = _membership_for_user(db, t.id, user.id)
    resume_reg: Registration | None = None
    if my_entry:
        my_tp, _my_team_row, my_reg = my_entry
        if my_reg.status == PaymentStatus.PAID.value:
            raise HTTPException(400, "You are already registered for this tournament")
        if my_tp.slot != 1:
            raise HTTPException(400, _conflict_message(db, t.id, user.id, None, singles))
        resume_reg = my_reg

    if resume_reg:
        if t.status in (
            TournamentStatus.LIVE.value,
            TournamentStatus.COMPLETED.value,
            TournamentStatus.CANCELLED.value,
        ):
            raise HTTPException(
                400,
                "This event has started - you can’t finish registration. Leave the entry instead.",
            )
    else:
        if t.status != TournamentStatus.REGISTRATION_OPEN.value:
            raise HTTPException(400, "Registration is not open")
        if _deadline_passed(t):
            raise HTTPException(400, "Registration deadline has passed")
        if _paid_team_count(db, t.id) >= t.max_teams:
            raise HTTPException(400, "Tournament is full")

    partner: User | None = None
    notify_email_partner = False
    partner_needs_signup = False

    if singles:
        if body.partner_user_id or body.partner_email:
            raise HTTPException(400, "This is a singles tournament - no partner needed")
    else:
        if body.partner_user_id:
            partner = db.get(User, body.partner_user_id)
            if not partner or not partner.is_active:
                raise HTTPException(400, "Partner not found")
            # Any registered player can be named as tournament partner (friends not required)
        elif body.partner_email:
            email = body.partner_email.lower().strip()
            partner = db.query(User).filter(User.email == email).first()
            if partner:
                # Existing account (or prior invite stub) - link that user as partner
                partner_needs_signup = bool(getattr(partner, "must_set_password", False))
                if partner_needs_signup:
                    name = (body.partner_name or "").strip()
                    if len(name) >= 2:
                        partner.full_name = name
                notify_email_partner = True
            else:
                name = (body.partner_name or "").strip()
                if len(name) < 2:
                    raise HTTPException(400, "Partner name is required for a new email")
                partner = User(
                    email=email,
                    password_hash=hash_password(str(uuid4())),
                    full_name=name,
                    role="PLAYER",
                    university_id=None,
                    must_set_password=True,
                )
                db.add(partner)
                db.flush()
                _ensure_ranking(db, partner.id)
                partner_needs_signup = True
                notify_email_partner = True
        else:
            raise HTTPException(400, "Pick a partner or enter their email")

        if partner.id == user.id:
            raise HTTPException(400, "Partner must be a different player")

    if partner:
        partner_entry = _membership_for_user(db, t.id, partner.id)
        if partner_entry:
            _ptp, _pteam, preg = partner_entry
            # Allow if partner is already on the team we're resuming
            if not resume_reg or preg.team_id != resume_reg.team_id:
                raise HTTPException(400, _conflict_message(db, t.id, user.id, partner.id, singles))

    if body.phone and not user.phone:
        user.phone = body.phone
    if body.student_number and not user.student_number:
        user.student_number = body.student_number

    if resume_reg:
        team = db.get(Team, resume_reg.team_id)
        if team:
            team.name = body.team_name.strip()
            if body.university_id:
                team.university_id = body.university_id
            if not singles and partner:
                slot2 = (
                    db.query(TeamPlayer)
                    .filter(TeamPlayer.team_id == team.id, TeamPlayer.slot == 2)
                    .first()
                )
                if slot2:
                    if slot2.user_id != partner.id:
                        if _players_already_registered(
                            db, t.id, [partner.id], exclude_registration_id=resume_reg.id
                        ):
                            raise HTTPException(400, "That partner is already entered in this tournament")
                        slot2.user_id = partner.id
                        slot2.invitation_accepted = True
                        _ensure_pending_friendship(db, user.id, partner.id)
                else:
                    db.add(
                        TeamPlayer(
                            team_id=team.id,
                            user_id=partner.id,
                            slot=2,
                            invitation_accepted=True,
                        )
                    )
                    _ensure_pending_friendship(db, user.id, partner.id)
        if team:
            save_answers_for_registration(
                db,
                tournament=t,
                registration_id=resume_reg.id,
                team_id=team.id,
                answers=body.custom_answers or [],
                singles=singles,
            )
        checkout = _issue_checkout(
            db,
            t,
            team,
            resume_reg,
            customer_email=user.email,
            pay_online_now=bool(body.pay_online_now),
            return_origin=body.return_origin,
            native_return=bool(body.native_return),
        )
        if notify_email_partner and partner:
            _notify_email_partner(
                captain=user,
                partner=partner,
                tournament=t,
                needs_signup=partner_needs_signup,
            )
        return checkout

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
                invitation_accepted=True,
            )
        )
        _ensure_pending_friendship(db, user.id, partner.id)

    reg = Registration(
        tournament_id=t.id,
        team_id=team.id,
        status=PaymentStatus.PENDING.value,
        amount_cents=t.entry_fee_cents,
        currency=t.currency,
    )
    db.add(reg)
    db.flush()

    save_answers_for_registration(
        db,
        tournament=t,
        registration_id=reg.id,
        team_id=team.id,
        answers=body.custom_answers or [],
        singles=singles,
    )

    checkout = _issue_checkout(
        db,
        t,
        team,
        reg,
        customer_email=user.email,
        pay_online_now=bool(body.pay_online_now),
        return_origin=body.return_origin,
        native_return=bool(body.native_return),
    )
    if notify_email_partner and partner:
        _notify_email_partner(
            captain=user,
            partner=partner,
            tournament=t,
            needs_signup=partner_needs_signup,
        )
    return checkout


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
    _assert_organiser(user, t, db)
    if t.status in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        raise HTTPException(400, "Cannot add teams to a finished tournament")
    if t.status == TournamentStatus.LIVE.value:
        raise HTTPException(400, "Cannot add teams while the event is live")
    if _paid_team_count(db, t.id) >= t.max_teams:
        raise HTTPException(400, "Tournament is full")
    if db.query(Match).filter(Match.tournament_id == t.id).count() > 0:
        raise HTTPException(
            400,
            "Fixtures already exist - add players before generate, or regenerate the draw afterwards",
        )

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
        stripe_payment_intent_id="free_entry",
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
    return _team_out(team, db)


def _checkout_web_origin(return_origin: str | None) -> str:
    """Prefer the browser host the player started from (www vs apex), else FRONTEND_URL."""
    settings = get_settings()
    allowed = {o.rstrip("/").lower() for o in settings.cors_origins()}
    raw = (return_origin or "").strip().rstrip("/")
    if raw and raw.lower() in allowed and raw.lower().startswith("https://"):
        return raw
    return settings.frontend_url.rstrip("/")


def _checkout_success_cancel_urls(
    t: Tournament,
    reg: Registration,
    *,
    return_origin: str | None = None,
    cancel_path: str | None = None,
    native_return: bool = False,
) -> tuple[str, str]:
    # Native: custom scheme keeps auth in the WebView. https success URLs are claimed by
    # Universal Links / open in SFSafariViewController without the app session cookie.
    if native_return:
        success = (
            f"studentpadel://t/{t.slug}/confirmed"
            f"?session_id={{CHECKOUT_SESSION_ID}}&registration_id={reg.id}"
        )
        cancel = f"studentpadel://t/{t.slug}/join?cancelled=1"
        return success, cancel

    origin = _checkout_web_origin(return_origin)
    # Include registration_id so the website can recover if session confirm races
    success = (
        f"{origin}/t/{t.slug}/confirmed"
        f"?session_id={{CHECKOUT_SESSION_ID}}&registration_id={reg.id}"
    )
    cancel = f"{origin}{cancel_path or f'/t/{t.slug}/join?cancelled=1'}"
    return success, cancel


def _issue_checkout(
    db: Session,
    t: Tournament,
    team: Team | None,
    reg: Registration,
    *,
    customer_email: str | None = None,
    pay_online_now: bool = False,
    return_origin: str | None = None,
    native_return: bool = False,
) -> CheckoutResponse:
    if not team:
        raise HTTPException(404, "Team not found")

    # Free entry - mark paid immediately (Stripe rejects €0 line items)
    if t.entry_fee_cents <= 0:
        from app.services.payments import mark_registration_paid
        from app.services.reminders import maybe_remind_team_after_paid

        mark_registration_paid(db, reg, stripe_payment_id="free_entry")
        db.commit()
        maybe_remind_team_after_paid(db, t.id, reg.team_id)
        return CheckoutResponse(
            checkout_url=None,
            registration_id=reg.id,
            demo_mode=True,
            message="Registration confirmed - free entry.",
        )

    # Organiser collects cash/card at the venue - confirm the spot without Stripe
    # (unless the captain chose optional pay-online-now for the full team fee)
    if getattr(t, "pay_on_arrival", False) and not pay_online_now:
        from app.services.payments import mark_registration_paid
        from app.services.reminders import maybe_remind_team_after_paid

        reg.amount_cents = t.entry_fee_cents
        reg.currency = t.currency
        mark_registration_paid(db, reg, stripe_payment_id="pay_on_arrival")
        db.commit()
        maybe_remind_team_after_paid(db, t.id, reg.team_id)
        fee = f"{(t.entry_fee_cents / 100):.2f} {t.currency}".replace(".00 ", " ")
        return CheckoutResponse(
            checkout_url=None,
            registration_id=reg.id,
            demo_mode=False,
            message=f"You're in - pay {fee} at the venue.",
        )

    settings = get_settings()
    if settings.stripe_secret_key:
        from app.services.payments import create_checkout_session, stripe_checkout_total_cents

        success_url, cancel_url = _checkout_success_cancel_urls(
            t,
            reg,
            return_origin=return_origin,
            native_return=native_return,
        )
        charge_cents = stripe_checkout_total_cents(t.entry_fee_cents)
        # Persist expected charge before creating Checkout so a fast webhook can match
        reg.amount_cents = charge_cents
        reg.currency = t.currency
        db.commit()
        try:
            session = create_checkout_session(
                tournament_name=t.name,
                team_name=team.name,
                amount_cents=t.entry_fee_cents,
                currency=t.currency,
                success_url=success_url,
                cancel_url=cancel_url,
                registration_id=reg.id,
                tournament_id=t.id,
                customer_email=customer_email,
                previous_session_id=reg.stripe_session_id,
                covers_both_players=not _is_singles(t),
            )
        except Exception as exc:
            raise HTTPException(502, f"Could not start Stripe Checkout: {exc}") from exc

        reg.stripe_session_id = session.id
        db.commit()
        return CheckoutResponse(
            checkout_url=session.url,
            registration_id=reg.id,
            demo_mode=False,
            message="Redirect to Stripe Checkout",
        )

    from app.services.payments import mark_registration_paid
    from app.services.reminders import maybe_remind_team_after_paid

    mark_registration_paid(db, reg, stripe_payment_id="demo_payment")
    db.commit()
    maybe_remind_team_after_paid(db, t.id, reg.team_id)
    return CheckoutResponse(
        checkout_url=None,
        registration_id=reg.id,
        demo_mode=True,
        message="Registration confirmed (demo payment). Set STRIPE_SECRET_KEY for live payments.",
    )


@router.post("/tournaments/{tournament_id}/pay-online-now", response_model=CheckoutResponse)
def pay_online_now(
    tournament_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    body: PayOnlineNowRequest = PayOnlineNowRequest(),
):
    """Captain (or singles player) with a pay-on-arrival spot pays the full team fee online."""
    req = body
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if t.entry_fee_cents <= 0:
        raise HTTPException(400, "This event has no entry fee")
    if t.status in (
        TournamentStatus.COMPLETED.value,
        TournamentStatus.CANCELLED.value,
    ):
        raise HTTPException(400, "This event is finished")

    membership = _membership_for_user(db, t.id, user.id)
    if not membership:
        raise HTTPException(404, "You are not registered for this tournament")
    tp, team, reg = membership
    if tp.slot != 1:
        raise HTTPException(400, "Only the team captain can pay online for the entry")
    if team.withdrawn:
        raise HTTPException(400, "This entry was withdrawn")
    if reg.status != PaymentStatus.PAID.value:
        # Pending captains should use register with pay_online_now
        return _issue_checkout(
            db,
            t,
            team,
            reg,
            customer_email=user.email,
            pay_online_now=True,
            return_origin=req.return_origin,
            native_return=bool(req.native_return),
        )

    via = (reg.stripe_payment_intent_id or "").strip().lower()
    if via != "pay_on_arrival":
        raise HTTPException(400, "This entry is already paid online")

    settings = get_settings()
    if settings.stripe_secret_key:
        from app.services.payments import create_checkout_session, stripe_checkout_total_cents

        charge_cents = stripe_checkout_total_cents(t.entry_fee_cents)
        reg.amount_cents = charge_cents
        reg.currency = t.currency
        db.commit()
        success_url, cancel_url = _checkout_success_cancel_urls(
            t,
            reg,
            return_origin=req.return_origin,
            cancel_path=f"/t/{t.slug}/live?pay_cancelled=1",
            native_return=bool(req.native_return),
        )
        try:
            session = create_checkout_session(
                tournament_name=t.name,
                team_name=team.name,
                amount_cents=t.entry_fee_cents,
                currency=t.currency,
                success_url=success_url,
                cancel_url=cancel_url,
                registration_id=reg.id,
                tournament_id=t.id,
                customer_email=user.email,
                previous_session_id=reg.stripe_session_id,
                covers_both_players=not _is_singles(t),
            )
        except Exception as exc:
            raise HTTPException(502, f"Could not start Stripe Checkout: {exc}") from exc
        reg.stripe_session_id = session.id
        db.commit()
        return CheckoutResponse(
            checkout_url=session.url,
            registration_id=reg.id,
            demo_mode=False,
            message="Redirect to Stripe Checkout",
        )

    reg.amount_cents = t.entry_fee_cents
    reg.currency = t.currency

    # Demo: treat as online paid immediately
    reg.stripe_payment_intent_id = "demo_payment"
    if not reg.paid_at:
        reg.paid_at = datetime.now(timezone.utc)
    db.commit()
    return CheckoutResponse(
        checkout_url=None,
        registration_id=reg.id,
        demo_mode=True,
        message="Entry marked paid online (demo). Set STRIPE_SECRET_KEY for live payments.",
    )


def _try_fulfill_pending_registration(db: Session, reg: Registration) -> Registration:
    """If a PENDING entry has a Stripe session, attempt fulfillment (webhook race / missed hook)."""
    if reg.status != PaymentStatus.PENDING.value:
        return reg
    session_id = (reg.stripe_session_id or "").strip()
    if not session_id.startswith("cs_"):
        return reg
    from app.services.payments import fulfill_checkout_session

    try:
        fulfilled = fulfill_checkout_session(db, session_id)
    except HTTPException:
        db.rollback()
        refreshed = db.get(Registration, reg.id)
        return refreshed or reg
    except Exception:
        db.rollback()
        refreshed = db.get(Registration, reg.id)
        return refreshed or reg
    return fulfilled or reg


@router.get("/registrations/{registration_id}")
def get_registration(
    registration_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reg = db.get(Registration, registration_id)
    if not reg:
        raise HTTPException(404, "Registration not found")
    # Native return-from-Stripe often lands here before/without the webhook finishing
    reg = _try_fulfill_pending_registration(db, reg)
    return _registration_payload(db, reg, user)


@router.get("/payments/confirm")
def confirm_payment_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.services.payments import fulfill_checkout_session

    if not session_id or not session_id.startswith("cs_"):
        raise HTTPException(400, "Invalid checkout session id")

    try:
        reg = fulfill_checkout_session(db, session_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"Could not confirm payment: {exc}") from exc

    if not reg:
        # Session exists locally but Stripe says not paid yet (redirect raced webhook)
        reg = db.query(Registration).filter(Registration.stripe_session_id == session_id).first()
        if reg and reg.status == PaymentStatus.PENDING.value:
            raise HTTPException(404, "Payment not completed yet - try again in a moment")
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
    can_view = (
        user.id in member_ids
        or (t is not None and user_can_manage_tournament(user, t, db))
    )
    if not can_view:
        raise HTTPException(403, "Not allowed to view this registration")
    my_slot = next((m.slot for m in members if m.user_id == user.id), None)
    if team.registration is None:
        team.registration = reg
    return {
        "registration_id": str(reg.id),
        "status": reg.status,
        "amount_cents": reg.amount_cents,
        "currency": reg.currency,
        "paid_at": reg.paid_at.isoformat() if reg.paid_at else None,
        "payment_via": _payment_via(reg),
        "tournament": _tournament_out(db, t) if t else None,
        "team_name": team.name,
        "players": _unique_player_names(members),
        "slot": my_slot,
        "can_leave": bool(t and _player_can_leave_entry(db, t, team)),
    }


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Stripe webhook - signature verification required (see Stripe webhook docs)."""
    import logging

    logger = logging.getLogger(__name__)
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(400, "Stripe not configured")
    if not settings.stripe_webhook_secret:
        # Never accept unsigned webhook bodies - forged events could mark entries paid
        raise HTTPException(500, "STRIPE_WEBHOOK_SECRET is not configured")

    import stripe

    stripe.api_key = settings.stripe_secret_key
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except Exception as exc:
        raise HTTPException(400, f"Webhook signature verification failed: {exc}") from exc

    # Instant methods: checkout.session.completed with payment_status=paid
    # Delayed methods (e.g. bank debit): async_payment_succeeded when funds clear
    if event["type"] in (
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
    ):
        session = event["data"]["object"]
        session_id = session.get("id") if isinstance(session, dict) else getattr(session, "id", None)
        from app.services.payments import fulfill_checkout_session

        if session_id:
            try:
                reg = fulfill_checkout_session(db, session_id)
            except HTTPException as exc:
                # Business rejection (withdrawn/full/mismatch) - ack so Stripe stops retrying.
                # Player may have been charged; organiser handles refund manually.
                logger.warning(
                    "Stripe webhook fulfill rejected for %s: %s",
                    session_id,
                    getattr(exc, "detail", exc),
                )
                db.rollback()
            except Exception:
                logger.exception("Stripe webhook fulfill crashed for %s", session_id)
                db.rollback()
                # 500 → Stripe retries
                raise HTTPException(500, "Fulfillment failed") from None
            else:
                if reg is None:
                    # Paid session with no matching registration - keep retrying briefly
                    logger.error("Stripe webhook: paid session %s matched no registration", session_id)
                    raise HTTPException(500, "Registration not found for paid session")
                if reg.status != PaymentStatus.PAID.value:
                    logger.error(
                        "Stripe webhook: session %s fulfilled but registration %s status=%s",
                        session_id,
                        reg.id,
                        reg.status,
                    )
                    raise HTTPException(500, "Registration not marked paid")
    return {"received": True}


@router.get("/tournaments/{tournament_id}/teams", response_model=list[TeamOut])
def list_teams(tournament_id: UUID, db: Session = Depends(get_db)):
    teams = (
        db.query(Team)
        .options(joinedload(Team.members).joinedload(TeamPlayer.user), joinedload(Team.registration))
        .filter(Team.tournament_id == tournament_id, Team.withdrawn.is_(False))
        .order_by(Team.name)
        .all()
    )
    return [_team_out(team, db) for team in teams]


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
    _assert_organiser(user, t, db)
    team = (
        db.query(Team)
        .options(joinedload(Team.members).joinedload(TeamPlayer.user), joinedload(Team.registration))
        .filter(Team.id == team_id, Team.tournament_id == tournament_id, Team.withdrawn.is_(False))
        .first()
    )
    if not team:
        raise HTTPException(404, "Team not found")
    team.player1_present = body.player1_present
    if _is_singles(t):
        team.player2_present = True
        team.checked_in = body.player1_present
    else:
        team.player2_present = body.player2_present
        team.checked_in = body.player1_present and body.player2_present
    db.commit()
    db.refresh(team)
    return _team_out(team, db)


@router.post("/tournaments/{tournament_id}/teams/{team_id}/mark-fee-collected", response_model=TeamOut)
def mark_fee_collected(
    tournament_id: UUID,
    team_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Organiser marks a pay-on-arrival entry as fee collected at the venue."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)
    team = (
        db.query(Team)
        .options(joinedload(Team.members).joinedload(TeamPlayer.user), joinedload(Team.registration))
        .filter(Team.id == team_id, Team.tournament_id == tournament_id, Team.withdrawn.is_(False))
        .first()
    )
    if not team or not team.registration:
        raise HTTPException(404, "Team not found")
    reg = team.registration
    if reg.status != PaymentStatus.PAID.value:
        raise HTTPException(400, "Entry is not confirmed yet")
    via = (reg.stripe_payment_intent_id or "").strip().lower()
    if via not in {"pay_on_arrival", "collected_on_arrival"}:
        raise HTTPException(400, "This entry was already paid online")
    reg.stripe_payment_intent_id = "collected_on_arrival"
    if not reg.paid_at:
        reg.paid_at = datetime.now(timezone.utc)
    payment_row = (
        db.query(Payment)
        .filter(
            Payment.registration_id == reg.id,
            Payment.status == PaymentStatus.PAID.value,
        )
        .first()
    )
    if payment_row:
        payment_row.stripe_payment_id = "collected_on_arrival"
    db.commit()
    db.refresh(team)
    return _team_out(team, db)


def _entry_is_paid(team: Team) -> bool:
    return bool(team.registration and team.registration.status == PaymentStatus.PAID.value)


def _tournament_blocks_paid_withdraw(t: Tournament) -> bool:
    return t.status in (
        TournamentStatus.LIVE.value,
        TournamentStatus.COMPLETED.value,
        TournamentStatus.CANCELLED.value,
    )


def _tournament_has_fixtures(db: Session, tournament_id: UUID) -> bool:
    return (
        db.query(Match.id).filter(Match.tournament_id == tournament_id).first() is not None
    )


def _player_can_leave_entry(db: Session, t: Tournament, team: Team) -> bool:
    if team.withdrawn or not team.registration:
        return False
    status = team.registration.status
    if status == PaymentStatus.PENDING.value:
        return t.status not in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value)
    if status == PaymentStatus.PAID.value:
        # Once a draw exists, leaving would leave ghost teams in fixtures
        if _tournament_blocks_paid_withdraw(t) or _tournament_has_fixtures(db, t.id):
            return False
        return True
    return False


def _apply_team_withdraw(db: Session, t: Tournament, team: Team, *, as_organiser: bool) -> TeamOut:
    paid = _entry_is_paid(team)
    if paid and _tournament_blocks_paid_withdraw(t):
        raise HTTPException(
            400,
            "Cannot withdraw a paid entry after the event has started"
            if not as_organiser
            else "Cannot withdraw a paid team after the event is live",
        )
    if paid and not as_organiser and _tournament_has_fixtures(db, t.id):
        raise HTTPException(
            400,
            "You can’t leave after the draw is published - contact the organiser",
        )
    if not as_organiser and not _player_can_leave_entry(db, t, team):
        raise HTTPException(400, "You can no longer leave this tournament")

    team.withdrawn = True
    team.checked_in = False
    old_session_id = team.registration.stripe_session_id if team.registration else None
    if team.registration and team.registration.status in (
        PaymentStatus.PENDING.value,
        PaymentStatus.FAILED.value,
        PaymentStatus.CANCELLED.value,
    ):
        team.registration.status = PaymentStatus.CANCELLED.value
    if team.registration and old_session_id:
        # Drop session link so a late webhook/confirm can't revive or upgrade a withdrawn entry
        team.registration.stripe_session_id = None
    db.commit()
    if old_session_id:
        from app.services.payments import expire_checkout_session

        expire_checkout_session(old_session_id)
    return _team_out(team, db)


@router.post("/tournaments/{tournament_id}/teams/{team_id}/withdraw", response_model=TeamOut)
def withdraw_team(
    tournament_id: UUID,
    team_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Organiser withdraw. Unpaid/pending can always be removed; paid only before LIVE."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)
    team = (
        db.query(Team)
        .options(joinedload(Team.registration))
        .filter(Team.id == team_id, Team.tournament_id == tournament_id)
        .first()
    )
    if not team or team.withdrawn:
        raise HTTPException(404, "Team not found")
    return _apply_team_withdraw(db, t, team, as_organiser=True)


@router.post("/tournaments/{tournament_id}/leave", response_model=TeamOut)
def leave_tournament(
    tournament_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Player self-withdraw: cancel a pending entry, or leave a paid entry before the event starts."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")

    membership = _membership_for_user(db, t.id, user.id)
    if not membership:
        raise HTTPException(400, "You are not entered in this tournament")
    _tp, team, reg = membership
    # Ensure registration is loaded on team for helper
    if team.registration is None:
        team.registration = reg

    if not _player_can_leave_entry(db, t, team):
        if _entry_is_paid(team) and (
            _tournament_blocks_paid_withdraw(t) or _tournament_has_fixtures(db, t.id)
        ):
            raise HTTPException(
                400,
                "You can’t leave after the draw is published or the event has started - contact the organiser",
            )
        raise HTTPException(400, "You can no longer leave this tournament")

    # Doubles: any member leaving cancels the whole team entry
    return _apply_team_withdraw(db, t, team, as_organiser=False)


@router.post("/tournaments/{tournament_id}/replace-partner")
def replace_partner(
    tournament_id: UUID,
    body: RegisterTeamRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Captain adds/replaces doubles partner before the draw (keeps existing payment)."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if _is_singles(t):
        raise HTTPException(400, "Singles events don’t use partners")
    if t.status in (
        TournamentStatus.LIVE.value,
        TournamentStatus.COMPLETED.value,
        TournamentStatus.CANCELLED.value,
    ) or _tournament_has_fixtures(db, t.id):
        raise HTTPException(400, "Can’t change partners after the draw is published")

    membership = _membership_for_user(db, t.id, user.id)
    if not membership:
        raise HTTPException(400, "You are not entered in this tournament")
    tp, team, reg = membership
    if tp.slot != 1:
        raise HTTPException(400, "Only the team captain can change the partner")

    partner: User | None = None
    notify_email_partner = False
    partner_needs_signup = False
    if body.partner_user_id:
        partner = db.get(User, body.partner_user_id)
        if not partner or not partner.is_active:
            raise HTTPException(400, "Partner not found")
    elif body.partner_email:
        email = body.partner_email.lower().strip()
        partner = db.query(User).filter(User.email == email).first()
        if partner:
            partner_needs_signup = bool(getattr(partner, "must_set_password", False))
            if partner_needs_signup:
                name = (body.partner_name or "").strip()
                if len(name) >= 2:
                    partner.full_name = name
            notify_email_partner = True
        else:
            name = (body.partner_name or "").strip()
            if len(name) < 2:
                raise HTTPException(400, "Partner name is required for a new email")
            partner = User(
                email=email,
                password_hash=hash_password(str(uuid4())),
                full_name=name,
                role="PLAYER",
                university_id=None,
                must_set_password=True,
            )
            db.add(partner)
            db.flush()
            _ensure_ranking(db, partner.id)
            partner_needs_signup = True
            notify_email_partner = True
    else:
        raise HTTPException(400, "Pick a partner or enter their email")

    if partner.id == user.id:
        raise HTTPException(400, "Partner must be a different player")

    partner_entry = _membership_for_user(db, t.id, partner.id)
    if partner_entry:
        _ptp, _pteam, preg = partner_entry
        if preg.team_id != team.id:
            raise HTTPException(400, "That player is already entered in this tournament")

    if body.team_name and body.team_name.strip():
        team.name = body.team_name.strip()

    slot2 = (
        db.query(TeamPlayer)
        .filter(TeamPlayer.team_id == team.id, TeamPlayer.slot == 2)
        .first()
    )
    if slot2:
        slot2.user_id = partner.id
        slot2.invitation_accepted = True
        db.add(slot2)
    else:
        db.add(
            TeamPlayer(
                team_id=team.id,
                user_id=partner.id,
                slot=2,
                invitation_accepted=True,
            )
        )
    _ensure_pending_friendship(db, user.id, partner.id)
    save_answers_for_registration(
        db,
        tournament=t,
        registration_id=reg.id,
        team_id=team.id,
        answers=body.custom_answers or [],
        singles=False,
    )
    db.commit()
    if notify_email_partner:
        _notify_email_partner(
            captain=user,
            partner=partner,
            tournament=t,
            needs_signup=partner_needs_signup,
        )
    return {
        "ok": True,
        "registration_id": str(reg.id),
        "tournament_slug": t.slug,
        "payment_status": reg.status,
    }


@router.post("/tournaments/{tournament_id}/partner-invite/respond")
def respond_partner_invite(
    tournament_id: UUID,
    body: PartnerInviteRespond,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Partner accepts (become friends, stay on team) or declines (leave team slot, decline friendship)."""
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if _is_singles(t):
        raise HTTPException(400, "Singles events have no partner invite")

    membership = _membership_for_user(db, t.id, user.id)
    if not membership:
        raise HTTPException(400, "You are not on a team for this tournament")
    tp, team, reg = membership
    if tp.slot != 2:
        raise HTTPException(400, "Only the listed partner can respond to this invite")

    captain_tp = (
        db.query(TeamPlayer)
        .filter(TeamPlayer.team_id == team.id, TeamPlayer.slot == 1)
        .first()
    )
    if not captain_tp:
        raise HTTPException(400, "Team captain not found")

    fr = _friendship_between(db, captain_tp.user_id, user.id)

    if body.accept:
        if fr and fr.status == FriendshipStatus.PENDING.value:
            fr.status = FriendshipStatus.ACCEPTED.value
            db.add(fr)
        elif not fr:
            db.add(
                Friendship(
                    requester_id=captain_tp.user_id,
                    addressee_id=user.id,
                    status=FriendshipStatus.ACCEPTED.value,
                )
            )
        tp.invitation_accepted = True
        db.add(tp)
        db.commit()
        return {"ok": True, "accepted": True, "tournament_slug": t.slug}

    # Decline: remove partner only so captain can pick someone else
    if fr and fr.status == FriendshipStatus.PENDING.value:
        db.delete(fr)

    if t.status in (
        TournamentStatus.LIVE.value,
        TournamentStatus.COMPLETED.value,
        TournamentStatus.CANCELLED.value,
    ) or _tournament_has_fixtures(db, t.id):
        raise HTTPException(
            400,
            "You can’t leave after the draw is published - contact the organiser",
        )

    db.delete(tp)
    db.commit()
    return {
        "ok": True,
        "accepted": False,
        "tournament_slug": t.slug,
        "needs_new_partner": True,
    }


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
    _assert_organiser(user, t, db)

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
        .options(joinedload(Team.members))
        .join(Registration)
        .filter(
            Team.tournament_id == tournament_id,
            Team.withdrawn.is_(False),
            Registration.status == PaymentStatus.PAID.value,
        )
        .all()
    )
    singles = _is_singles(t)
    if not singles:
        incomplete = [team for team in paid_teams if len(team.members or []) < 2]
        paid_teams = [team for team in paid_teams if len(team.members or []) >= 2]
        if incomplete:
            names = ", ".join(team.name for team in incomplete[:5])
            extra = f" (+{len(incomplete) - 5} more)" if len(incomplete) > 5 else ""
            raise HTTPException(
                400,
                f"{len(incomplete)} paid team(s) are missing a partner ({names}{extra}). "
                "Ask them to add a partner, or withdraw those entries before generating.",
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
    enable_plate = bool(getattr(t, "enable_plate", False))
    championship_size = int(getattr(t, "championship_size", 16) or 16)
    plate_size = int(getattr(t, "plate_size", 16) or 16)

    if not enable_plate and advance > group_size:
        raise HTTPException(
            400,
            f"Teams advancing per group ({advance}) cannot exceed group size ({group_size})",
        )

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
        enable_plate=enable_plate,
        championship_size=championship_size,
        plate_size=plate_size,
    )
    try:
        generated = generate_tournament(config)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e

    # Persist the advance actually used (may be clamped for uneven / small groups)
    if generated.advance_per_group is not None and generated.advance_per_group > 0:
        t.teams_advance_per_group = generated.advance_per_group
    if generated.enable_plate:
        t.enable_plate = True
        if generated.championship_size:
            t.championship_size = generated.championship_size
        if generated.plate_size:
            t.plate_size = generated.plate_size

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

    # Wire knockout / plate next_match links (indices are per-stage)
    for stage in ("KNOCKOUT", "PLATE"):
        stage_gens = [gm for gm in generated.matches if gm.stage == stage]
        stage_db = [m for m in created_matches if m.stage == stage]
        for i, gm in enumerate(stage_gens):
            if gm.feeds_into_index is not None and gm.feeds_into_index < len(stage_db):
                stage_db[i].next_match_id = stage_db[gm.feeds_into_index].id
                stage_db[i].next_match_slot = gm.feeds_into_slot

    if t.status in (TournamentStatus.REGISTRATION_OPEN.value, TournamentStatus.REGISTRATION_CLOSED.value, TournamentStatus.DRAFT.value):
        t.status = TournamentStatus.REGISTRATION_CLOSED.value

    db.commit()
    return {
        "groups": len(generated.groups),
        "matches": len(created_matches),
        "knockout_rounds": generated.knockout_rounds,
        "plate_rounds": generated.plate_rounds,
        "group_sizes": generated.group_sizes,
        "advance_per_group": generated.advance_per_group,
        "advance_adjusted": generated.advance_adjusted,
        "bye_slots": generated.bye_slots,
        "enable_plate": generated.enable_plate,
        "championship_size": generated.championship_size,
        "plate_size": generated.plate_size,
        "paid_teams": len(paid_teams),
        "max_teams": t.max_teams,
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
    _assert_organiser(user, t, db)

    # Organisers finalise results - never leave a player-confirm limbo
    if body.status == MatchStatus.AWAITING_CONFIRM:
        body = body.model_copy(update={"status": MatchStatus.COMPLETED})

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

    if body.status in (
        MatchStatus.COMPLETED,
        MatchStatus.WALKOVER,
        MatchStatus.LIVE,
        MatchStatus.AWAITING_CONFIRM,
    ):
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
        winner_id = _infer_winner_id_from_sets(
            m,
            body.set1_a,
            body.set1_b,
            body.set2_a,
            body.set2_b,
            body.set3_a,
            body.set3_b,
        )

    if body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER):
        if not winner_id:
            raise HTTPException(400, "Completed matches need a winner (or set scores that determine one)")
        if winner_id not in (m.team_a_id, m.team_b_id):
            raise HTTPException(400, "Winner must be one of the match teams")
        _advance_winner_to_next(db, m, winner_id)
        m.winner_id = winner_id
        m.score.confirmed_by_id = user.id
    elif body.status == MatchStatus.AWAITING_CONFIRM:
        winner_id = winner_id or _infer_winner_id_from_sets(
            m,
            body.set1_a,
            body.set1_b,
            body.set2_a,
            body.set2_b,
            body.set3_a,
            body.set3_b,
        )
        if not winner_id:
            raise HTTPException(400, "Enter set scores with a clear winner")
        m.winner_id = winner_id
        m.score.confirmed_by_id = None
    else:
        # Live / other - clear pending confirm markers
        if body.status == MatchStatus.LIVE:
            m.score.confirmed_by_id = None
            m.winner_id = None

    if not correcting and body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER):
        _apply_tournament_match_ratings(db, m, t)

    # Day-of: any live/completed scoring flips the event to LIVE (unless already finished)
    if t and t.status not in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        if body.status in (
            MatchStatus.LIVE,
            MatchStatus.COMPLETED,
            MatchStatus.WALKOVER,
            MatchStatus.AWAITING_CONFIRM,
        ):
            if t.status != TournamentStatus.LIVE.value:
                t.status = TournamentStatus.LIVE.value

    # When group stage finishes, seed knockout placeholders → real teams
    if t and m.stage == "GROUP" and body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER):
        _seed_knockout_from_standings(db, t)

    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user)


@router.patch("/matches/{match_id}/player-score", response_model=MatchOut)
def player_submit_score(
    match_id: UUID,
    body: PlayerScoreSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Player proposes a final score - the other team must confirm before it counts."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    t = db.get(Tournament, m.tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if t.status in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        raise HTTPException(400, "Tournament is closed")
    if getattr(m, "ratings_applied", False):
        raise HTTPException(400, "This result is locked")
    if not m.team_a_id or not m.team_b_id:
        raise HTTPException(400, "Both teams must be set before scoring")
    if not _user_team_on_match(db, m, user.id):
        raise HTTPException(403, "Only players in this match can enter the score")
    if m.status == MatchStatus.AWAITING_CONFIRM.value:
        raise HTTPException(
            400,
            "A score is already waiting for confirm - cancel it first if you need to change it",
        )
    if m.status not in (
        MatchStatus.SCHEDULED.value,
        MatchStatus.CALLED.value,
        MatchStatus.LIVE.value,
    ):
        raise HTTPException(400, "This match can’t take a new score right now")

    winner_id = _require_best_of_three_winner(
        m,
        body.set1_a,
        body.set1_b,
        body.set2_a,
        body.set2_b,
        body.set3_a,
        body.set3_b,
    )

    if not m.score:
        m.score = MatchScore(match_id=m.id)
        db.add(m.score)
    m.score.set1_a = body.set1_a
    m.score.set1_b = body.set1_b
    m.score.set2_a = body.set2_a
    m.score.set2_b = body.set2_b
    m.score.set3_a = body.set3_a
    m.score.set3_b = body.set3_b
    m.score.current_set = 3 if (body.set3_a or body.set3_b) else (2 if (body.set2_a or body.set2_b) else 1)
    m.score.entered_by_id = user.id
    m.score.confirmed_by_id = None
    m.winner_id = winner_id
    m.status = MatchStatus.AWAITING_CONFIRM.value
    # Do not flip tournament → LIVE here. Confirm (or organiser call/start) does that,
    # so proposing a score on a scheduled match can't block paid withdrawals early.

    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user)


@router.post("/matches/{match_id}/confirm-score", response_model=MatchOut)
def player_confirm_score(
    match_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Other team confirms a proposed score → match completes and ratings apply."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    t = db.get(Tournament, m.tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if t.status in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        raise HTTPException(400, "Tournament is closed")
    if getattr(m, "ratings_applied", False):
        return _match_out(db, m, viewer=user)
    if m.status != MatchStatus.AWAITING_CONFIRM.value:
        raise HTTPException(400, "Nothing to confirm yet. Enter the score first.")
    if not _user_team_on_match(db, m, user.id):
        raise HTTPException(403, "Only players in this match can confirm")
    if not m.score or not m.score.entered_by_id:
        raise HTTPException(400, "No score has been submitted yet")
    if m.score.entered_by_id == user.id:
        raise HTTPException(400, "The other team needs to confirm your score")
    if _same_match_side(db, m, user.id, m.score.entered_by_id):
        raise HTTPException(400, "The other team needs to confirm this score")

    winner_id = m.winner_id or _infer_winner_id_from_sets(
        m,
        m.score.set1_a,
        m.score.set1_b,
        m.score.set2_a,
        m.score.set2_b,
        m.score.set3_a,
        m.score.set3_b,
    )
    if not winner_id:
        raise HTTPException(400, "Pending score has no clear winner - ask them to re-enter it")

    _advance_winner_to_next(db, m, winner_id)
    m.winner_id = winner_id
    m.score.confirmed_by_id = user.id
    m.status = MatchStatus.COMPLETED.value
    _apply_tournament_match_ratings(db, m, t)

    if t.status not in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value):
        if t.status != TournamentStatus.LIVE.value:
            t.status = TournamentStatus.LIVE.value
    if m.stage == "GROUP":
        _seed_knockout_from_standings(db, t)

    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user)


@router.post("/matches/{match_id}/cancel-pending-score", response_model=MatchOut)
def player_cancel_pending_score(
    match_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Withdraw or reject a score waiting for confirm (either side, or organiser)."""
    m = db.get(Match, match_id)
    if not m:
        raise HTTPException(404, "Match not found")
    t = db.get(Tournament, m.tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    if m.status != MatchStatus.AWAITING_CONFIRM.value:
        raise HTTPException(400, "No pending score to cancel")
    if getattr(m, "ratings_applied", False):
        raise HTTPException(400, "This result is locked")

    is_organiser = user_can_manage_tournament(user, t, db)
    on_team = _user_team_on_match(db, m, user.id)
    entered_by = m.score.entered_by_id if m.score else None
    same_side_as_scorer = bool(entered_by and on_team and _same_match_side(db, m, user.id, entered_by))
    if not is_organiser and not on_team:
        raise HTTPException(403, "Only players in this match (or an organiser) can cancel a pending score")

    # Scoring side editing keeps the numbers; opponent reject / organiser wipe clears them
    keep_sets = bool(same_side_as_scorer and not is_organiser)

    m.status = MatchStatus.LIVE.value
    m.winner_id = None
    if m.score:
        m.score.entered_by_id = None
        m.score.confirmed_by_id = None
        if not keep_sets:
            m.score.set1_a = 0
            m.score.set1_b = 0
            m.score.set2_a = 0
            m.score.set2_b = 0
            m.score.set3_a = 0
            m.score.set3_b = 0
            m.score.current_set = 1

    db.commit()
    db.refresh(m)
    return _match_out(db, m, viewer=user)


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
    _assert_organiser(user, t, db)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        data["status"] = data["status"].value
    for k, v in data.items():
        setattr(m, k, v)
    # Calling/starting a match is day-of activity - mark the tournament live
    if (
        t.status not in (TournamentStatus.COMPLETED.value, TournamentStatus.CANCELLED.value)
        and getattr(m, "status", None) in (MatchStatus.LIVE.value, MatchStatus.CALLED.value)
    ):
        if t.status != TournamentStatus.LIVE.value:
            t.status = TournamentStatus.LIVE.value
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
                    walkover_winner_id=_standings_walkover_winner(m, sets),
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
    _assert_organiser(user, t, db)
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


@router.patch("/tournaments/{tournament_id}/announcements/{announcement_id}", response_model=AnnouncementOut)
def update_announcement(
    tournament_id: UUID,
    announcement_id: UUID,
    body: AnnouncementUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)
    a = db.get(Announcement, announcement_id)
    if not a or a.tournament_id != t.id:
        raise HTTPException(404, "Announcement not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(a, field, value)
    db.commit()
    db.refresh(a)
    return a


@router.delete("/tournaments/{tournament_id}/announcements/{announcement_id}")
def delete_announcement(
    tournament_id: UUID,
    announcement_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)
    a = db.get(Announcement, announcement_id)
    if not a or a.tournament_id != t.id:
        raise HTTPException(404, "Announcement not found")
    db.delete(a)
    db.commit()
    return {"ok": True}


# ── Tournament admins ─────────────────────────────────────────

@router.get("/tournaments/{tournament_id}/admins", response_model=list[TournamentAdminOut])
def list_tournament_admins(
    tournament_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)
    out: list[TournamentAdminOut] = []
    owner = db.get(User, t.organiser_id)
    if owner:
        out.append(
            TournamentAdminOut(
                id=t.id,  # synthetic - owner has no tournament_admins row
                tournament_id=t.id,
                user_id=owner.id,
                full_name=owner.full_name,
                email=owner.email,
                role="OWNER",
                is_owner=True,
                created_at=t.created_at,
            )
        )
    rows = (
        db.query(TournamentAdmin)
        .filter(
            TournamentAdmin.tournament_id == t.id,
            TournamentAdmin.user_id != t.organiser_id,
        )
        .order_by(TournamentAdmin.created_at.asc())
        .all()
    )
    for row in rows:
        u = db.get(User, row.user_id)
        if not u or not u.is_active:
            continue
        out.append(
            TournamentAdminOut(
                id=row.id,
                tournament_id=row.tournament_id,
                user_id=u.id,
                full_name=u.full_name,
                email=u.email,
                role=row.role,
                is_owner=False,
                created_at=row.created_at,
            )
        )
    return out


@router.post("/tournaments/{tournament_id}/admins", response_model=TournamentAdminOut)
def add_tournament_admin(
    tournament_id: UUID,
    body: TournamentAdminCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_owner(user, t)
    if body.user_id == t.organiser_id:
        raise HTTPException(400, "That user is already the tournament owner")
    target = db.get(User, body.user_id)
    if not target or not target.is_active:
        raise HTTPException(404, "User not found")
    existing = (
        db.query(TournamentAdmin)
        .filter(
            TournamentAdmin.tournament_id == t.id,
            TournamentAdmin.user_id == body.user_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(400, "User is already an admin of this tournament")
    row = TournamentAdmin(
        tournament_id=t.id,
        user_id=body.user_id,
        role=body.role,
        added_by_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return TournamentAdminOut(
        id=row.id,
        tournament_id=row.tournament_id,
        user_id=target.id,
        full_name=target.full_name,
        email=target.email,
        role=row.role,
        is_owner=False,
        created_at=row.created_at,
    )


@router.delete("/tournaments/{tournament_id}/admins/{admin_user_id}")
def remove_tournament_admin(
    tournament_id: UUID,
    admin_user_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_owner(user, t)
    if admin_user_id == t.organiser_id:
        raise HTTPException(400, "Cannot remove the tournament owner - transfer ownership first")
    row = (
        db.query(TournamentAdmin)
        .filter(
            TournamentAdmin.tournament_id == t.id,
            TournamentAdmin.user_id == admin_user_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(404, "Admin not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


_SPONSOR_LEVEL_ORDER = case(
    (Sponsor.level == "MAIN", 0),
    (Sponsor.level == "GOLD", 1),
    (Sponsor.level == "SILVER", 2),
    else_=3,
)
_SPONSOR_LOGO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_MAX_SPONSOR_LOGO_BYTES = 2 * 1024 * 1024
_MAX_SPONSORS_PER_TOURNAMENT = 12


def _sponsor_public_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path.startswith("/"):
        return f"{get_settings().backend_url.rstrip('/')}{path}"
    return path


def _infer_sponsor_image_type(data: bytes, filename: str | None, content_type: str | None) -> str | None:
    """iOS/WebView often sends empty or octet-stream content types - sniff the bytes."""
    ctype = (content_type or "").lower().strip()
    if ";" in ctype:
        ctype = ctype.split(";", 1)[0].strip()
    if ctype in _SPONSOR_LOGO_TYPES:
        return ctype
    head = data[:64]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"GIF87a") or head.startswith(b"GIF89a"):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    # HEIC/HEIF - common from iPhone Photos; we don't decode these
    if b"ftypheic" in head or b"ftypheif" in head or b"ftypmif1" in head or b"ftypmsf1" in head:
        return None
    name = (filename or "").lower()
    if name.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if name.endswith(".png"):
        return "image/png"
    if name.endswith(".webp"):
        return "image/webp"
    if name.endswith(".gif"):
        return "image/gif"
    return None


def _sponsor_out(s: Sponsor) -> SponsorOut:
    # logo_data is deferred - use logo_content_type as the uploaded-logo flag
    if s.logo_content_type:
        logo = _sponsor_public_url(f"/api/sponsors/{s.id}/logo")
    else:
        logo = _sponsor_public_url(s.logo_url)
    return SponsorOut(
        id=s.id,
        name=s.name,
        logo_url=logo,
        website=s.website,
        description=s.description,
        level=s.level or "GOLD",
        has_logo=bool(logo),
    )


@router.get("/tournaments/{slug_or_id}/sponsors", response_model=list[SponsorOut])
def list_sponsors(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
    rows = (
        db.query(Sponsor)
        .filter(Sponsor.tournament_id == t.id)
        .order_by(_SPONSOR_LEVEL_ORDER, Sponsor.created_at.asc())
        .all()
    )
    return [_sponsor_out(s) for s in rows]


@router.get("/sponsors/{sponsor_id}/logo")
def sponsor_logo(sponsor_id: UUID, db: Session = Depends(get_db)):
    s = db.get(Sponsor, sponsor_id)
    if not s:
        raise HTTPException(404, "Logo not found")
    data = s.logo_data
    if not data:
        raise HTTPException(404, "Logo not found")
    ctype = (s.logo_content_type or "image/png").strip() or "image/png"
    return Response(
        content=bytes(data),
        media_type=ctype,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/tournaments/{tournament_id}/sponsors", response_model=SponsorOut)
async def create_sponsor(
    tournament_id: UUID,
    name: str = Form(...),
    website: str | None = Form(None),
    featured: str | None = Form(None),
    logo: UploadFile | None = File(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)

    clean_name = (name or "").strip()
    if len(clean_name) < 2:
        raise HTTPException(400, "Sponsor name is required")
    if len(clean_name) > 200:
        raise HTTPException(400, "Sponsor name is too long")

    count = db.query(Sponsor).filter(Sponsor.tournament_id == t.id).count()
    if count >= _MAX_SPONSORS_PER_TOURNAMENT:
        raise HTTPException(400, f"Maximum {_MAX_SPONSORS_PER_TOURNAMENT} sponsors per tournament")

    site = (website or "").strip() or None
    if site and not (site.startswith("http://") or site.startswith("https://")):
        site = f"https://{site}"

    is_featured = (featured or "").strip().lower() in {"1", "true", "yes", "on"}
    level = "MAIN" if is_featured else "GOLD"

    logo_bytes: bytes | None = None
    logo_ctype: str | None = None
    # Accept uploads even when filename is blank (some WebViews do that)
    if logo is not None:
        data = await logo.read()
        if data:
            if len(data) > _MAX_SPONSOR_LOGO_BYTES:
                raise HTTPException(400, "Logo must be 2MB or smaller")
            inferred = _infer_sponsor_image_type(data, logo.filename, logo.content_type)
            if not inferred:
                raise HTTPException(
                    400,
                    "Logo must be a PNG, JPG, WEBP, or GIF. On iPhone, choose “Most Compatible” or export as JPG.",
                )
            logo_bytes = data
            logo_ctype = inferred

    s = Sponsor(
        tournament_id=t.id,
        name=clean_name,
        website=site,
        level=level,
        logo_content_type=logo_ctype,
        logo_data=logo_bytes,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _sponsor_out(s)


@router.delete("/tournaments/{tournament_id}/sponsors/{sponsor_id}")
def delete_sponsor(
    tournament_id: UUID,
    sponsor_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = db.get(Tournament, tournament_id)
    if not t:
        raise HTTPException(404, "Tournament not found")
    _assert_organiser(user, t, db)
    s = db.get(Sponsor, sponsor_id)
    if not s or s.tournament_id != t.id:
        raise HTTPException(404, "Sponsor not found")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.get("/tournaments/{slug_or_id}/player-view")
def player_view(
    slug_or_id: str,
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    t = _resolve_tournament(db, slug_or_id)
    my_team = None
    my_payment_status = None
    my_slot: int | None = None
    my_teammates: list[str] = []
    partner_user_id: UUID | None = None
    partner_name: str | None = None
    partner_email: str | None = None
    entered_user_ids: list[UUID] = []
    next_match = None
    my_results = []
    my_upcoming: list = []
    if user:
        entered_user_ids = [
            row[0]
            for row in (
                db.query(TeamPlayer.user_id)
                .join(Team, Team.id == TeamPlayer.team_id)
                .join(Registration, Registration.team_id == Team.id)
                .filter(
                    Team.tournament_id == t.id,
                    Team.withdrawn.is_(False),
                    Registration.status.in_(_active_entry_statuses()),
                )
                .distinct()
                .all()
            )
        ]
        membership_row = _membership_for_user(db, t.id, user.id)
        membership = membership_row[0] if membership_row else None
        if membership:
            my_slot = membership.slot
            my_team = (
                db.query(Team)
                .options(joinedload(Team.registration), joinedload(Team.members).joinedload(TeamPlayer.user))
                .filter(Team.id == membership.team_id)
                .first()
            )
            if my_team and my_team.registration:
                # Recover stuck Checkout payments when the player re-opens the event
                if my_team.registration.status == PaymentStatus.PENDING.value:
                    my_team.registration = _try_fulfill_pending_registration(db, my_team.registration)
                my_payment_status = my_team.registration.status
            if my_team:
                my_teammates = [
                    m.user.full_name
                    for m in sorted(my_team.members, key=lambda x: x.slot)
                    if m.user
                ]
                for m in sorted(my_team.members, key=lambda x: x.slot):
                    if m.user and m.user_id != user.id:
                        partner_user_id = m.user_id
                        partner_name = m.user.full_name
                        partner_email = m.user.email
                        break
            # Only expose fixtures for paid entries
            if my_team and my_payment_status == PaymentStatus.PAID.value:
                status_rank = case(
                    (Match.status == MatchStatus.AWAITING_CONFIRM.value, 0),
                    (Match.status == MatchStatus.LIVE.value, 1),
                    (Match.status == MatchStatus.CALLED.value, 2),
                    else_=3,
                )
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
                                MatchStatus.AWAITING_CONFIRM.value,
                            ]
                        ),
                        ((Match.team_a_id == my_team.id) | (Match.team_b_id == my_team.id)),
                    )
                    .order_by(status_rank, Match.scheduled_start)
                    .all()
                )
                my_upcoming = [_match_out(db, m, court_names=None, viewer=user) for m in upcoming]
                next_match = my_upcoming[0] if my_upcoming else None
                done = (
                    db.query(Match)
                    .options(joinedload(Match.score))
                    .filter(
                        Match.tournament_id == t.id,
                        Match.status.in_([MatchStatus.COMPLETED.value, MatchStatus.WALKOVER.value]),
                        ((Match.team_a_id == my_team.id) | (Match.team_b_id == my_team.id)),
                    )
                    .order_by(Match.scheduled_start.desc())
                    .all()
                )
                for m in done:
                    my_results.append(_match_out(db, m, viewer=user))

    partner_invite_pending = False
    needs_partner = False
    if my_team and user and not _is_singles(t):
        member_count = len(my_team.members or [])
        if my_slot == 1 and member_count < 2:
            needs_partner = True
        if my_slot == 2 and partner_user_id is None:
            # partner_user_id above is the *other* player; for slot 2 captain is the other
            pass
        if my_slot == 2:
            captain = next((m for m in (my_team.members or []) if m.slot == 1), None)
            if captain:
                fr = _friendship_between(db, captain.user_id, user.id)
                if fr and fr.status == FriendshipStatus.PENDING.value:
                    partner_invite_pending = True

    court_rank = case((Match.court_number.is_(None), 1), else_=0)
    live = (
        db.query(Match)
        .options(joinedload(Match.score))
        .filter(Match.tournament_id == t.id, Match.status == MatchStatus.LIVE.value)
        .order_by(court_rank, Match.court_number, Match.scheduled_start)
        .all()
    )
    called = (
        db.query(Match)
        .options(joinedload(Match.score))
        .filter(Match.tournament_id == t.id, Match.status == MatchStatus.CALLED.value)
        .order_by(court_rank, Match.court_number, Match.scheduled_start)
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
            {
                "id": my_team.id,
                "name": my_team.name,
                "payment_status": my_payment_status,
                "payment_via": _payment_via(my_team.registration) if my_team.registration else None,
                "slot": my_slot,
                "players": my_teammates,
                "partner_user_id": partner_user_id,
                "partner_name": partner_name,
                "partner_email": partner_email,
                "can_leave": _player_can_leave_entry(db, t, my_team),
                "partner_invite_pending": partner_invite_pending,
                "needs_partner": needs_partner,
                "custom_answers": answers_for_team(db, my_team),
            }
            if my_team
            else None
        ),
        "entered_user_ids": entered_user_ids,
        "next_match": next_match,
        "my_upcoming": my_upcoming,
        "my_results": my_results,
        "live_matches": [_match_out(db, m, court_names) for m in live],
        "called_matches": [_match_out(db, m, court_names) for m in called],
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
    unassigned: list = []
    for m in matches:
        if m.court_number is None:
            # Only surface active matches without a court - don't clutter with scheduled TBCs
            if m.status in (MatchStatus.LIVE.value, MatchStatus.CALLED.value):
                unassigned.append(_match_out(db, m, court_names))
            continue
        by_court.setdefault(m.court_number, []).append(_match_out(db, m, court_names))
    return {
        "tournament": _tournament_out(db, t),
        "courts": by_court,
        "court_names": {str(k): v for k, v in court_names.items()},
        "unassigned": unassigned,
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
    _assert_organiser(user, t, db)
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


def _ranking_board_rows(
    db: Session,
    *,
    limit: int | None = 50,
    user_ids: list[UUID] | None = None,
) -> list:
    """Build public ranking rows, optionally limited to a set of user ids."""
    from app.models import ProfileMedia
    from app.api.profiles import _api_media_path, _public_url
    from sqlalchemy.orm import aliased

    AvatarMedia = aliased(ProfileMedia)
    q = (
        db.query(Ranking, User, University, AvatarMedia)
        .join(User, Ranking.user_id == User.id)
        .outerjoin(University, User.university_id == University.id)
        .outerjoin(
            AvatarMedia,
            (AvatarMedia.user_id == User.id) & (AvatarMedia.is_avatar.is_(True)),
        )
        .filter(or_(Ranking.matches_played > 0, Ranking.tournaments_played > 0))
    )
    if user_ids is not None:
        if not user_ids:
            return []
        q = q.filter(Ranking.user_id.in_(user_ids))
    q = q.order_by(Ranking.points.desc(), Ranking.wins.desc())
    if limit is not None:
        q = q.limit(limit)
    rows = q.all()
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


def _tournament_ids_for_player(db: Session, user_id: UUID) -> list[UUID]:
    """Tournaments where the user has an active (pending/paid) non-withdrawn entry."""
    rows = (
        db.query(Team.tournament_id)
        .join(TeamPlayer, TeamPlayer.team_id == Team.id)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            TeamPlayer.user_id == user_id,
            Team.withdrawn.is_(False),
            Registration.status.in_(_active_entry_statuses()),
        )
        .distinct()
        .all()
    )
    return [tid for (tid,) in rows]


def _coplayer_ids_for_tournaments(db: Session, tournament_ids: list[UUID]) -> list[UUID]:
    if not tournament_ids:
        return []
    rows = (
        db.query(TeamPlayer.user_id)
        .join(Team, Team.id == TeamPlayer.team_id)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id.in_(tournament_ids),
            Team.withdrawn.is_(False),
            Registration.status.in_(_active_entry_statuses()),
        )
        .distinct()
        .all()
    )
    return [uid for (uid,) in rows]


@router.get("/rankings")
def rankings(limit: int = 50, db: Session = Depends(get_db)):
    return _ranking_board_rows(db, limit=limit)


@router.get("/rankings/my-events")
def rankings_my_events(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 100,
):
    """Rankings for players entered in the same tournaments as the current user."""
    my_tournaments = _tournament_ids_for_player(db, user.id)
    if not my_tournaments:
        return []
    coplayers = _coplayer_ids_for_tournaments(db, my_tournaments)
    # Always include self even if somehow missing from the join
    if user.id not in coplayers:
        coplayers.append(user.id)
    return _ranking_board_rows(db, limit=max(1, min(limit, 200)), user_ids=coplayers)


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
    if user.role == Role.ADMIN.value:
        tournaments = db.query(Tournament).order_by(Tournament.event_date.desc()).all()
    else:
        admin_ids = [
            row[0]
            for row in db.query(TournamentAdmin.tournament_id)
            .filter(TournamentAdmin.user_id == user.id)
            .all()
        ]
        filters = [Tournament.organiser_id == user.id]
        if admin_ids:
            filters.append(Tournament.id.in_(admin_ids))
        tournaments = (
            db.query(Tournament)
            .filter(or_(*filters))
            .order_by(Tournament.event_date.desc())
            .all()
        )
    stats = []
    for t in tournaments:
        teams = _team_count(db, t.id)
        paid = (
            db.query(Registration)
            .join(Team, Team.id == Registration.team_id)
            .filter(
                Registration.tournament_id == t.id,
                Registration.status == PaymentStatus.PAID.value,
                Team.withdrawn.is_(False),
            )
            .count()
        )
        revenue = (
            db.query(Registration)
            .join(Team, Team.id == Registration.team_id)
            .filter(
                Registration.tournament_id == t.id,
                Registration.status == PaymentStatus.PAID.value,
                Team.withdrawn.is_(False),
            )
            .all()
        )
        # Count only fees actually collected (exclude pay-on-arrival still owing at venue)
        collected_revenue = [
            r
            for r in revenue
            if (r.stripe_payment_intent_id or "").strip().lower() != "pay_on_arrival"
        ]
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
        has_fixtures = (
            db.query(Match.id).filter(Match.tournament_id == t.id).limit(1).first() is not None
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
        is_owner = t.organiser_id == user.id or user.role == Role.ADMIN.value
        from app.services.payments import entry_revenue_cents

        stats.append(
            {
                "tournament": _tournament_out(db, t),
                "teams": teams,
                "players": teams * per_team,
                "paid_registrations": paid,
                # Entry fees only — platform service fee is excluded from organiser revenue
                "revenue_cents": sum(
                    entry_revenue_cents(r.amount_cents, stripe_session_id=r.stripe_session_id)
                    for r in collected_revenue
                ),
                "live_matches": live,
                "completed_matches": completed,
                "has_fixtures": has_fixtures,
                "checked_in": checked,
                "is_owner": is_owner,
                "can_manage_admins": is_owner,
            }
        )
    return {"tournaments": stats}
