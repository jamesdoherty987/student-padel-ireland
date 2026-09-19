from __future__ import annotations

import re
from datetime import date, datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, get_optional_user, require_role
from app.core.config import get_settings
from app.core.roles import Role
from app.core.security import hash_password
from app.db.session import get_db
from app.models import (
    Announcement,
    Court,
    Group,
    GroupTeam,
    Match,
    MatchScore,
    MatchStatus,
    PaymentStatus,
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
    MatchMove,
    MatchOut,
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


def _tournament_out(db: Session, t: Tournament) -> TournamentOut:
    data = TournamentOut.model_validate(t)
    data.registered_teams = _team_count(db, t.id)
    return data


def _match_out(db: Session, m: Match) -> MatchOut:
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
    return MatchOut(
        id=m.id,
        tournament_id=m.tournament_id,
        round=m.round,
        stage=m.stage,
        court_number=m.court_number,
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
    )


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
    user: User = Depends(require_role(Role.ORGANISER)),
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
        rules=body.rules,
        description=body.description,
        status=TournamentStatus.DRAFT.value,
        organiser_id=user.id,
        match_duration_minutes=body.match_duration_minutes,
        group_size=body.group_size,
        teams_advance_per_group=body.teams_advance_per_group,
        tie_break_order=body.tie_break_order
        or "points,head_to_head,set_difference,game_difference,games_won",
    )
    db.add(t)
    db.flush()
    for i in range(1, body.number_of_courts + 1):
        db.add(Court(tournament_id=t.id, name=f"Court {i}", court_number=i))
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
    for field, value in body.model_dump(exclude_unset=True).items():
        if hasattr(value, "value"):
            value = value.value
        setattr(t, field, value)
    # Sync courts only when the count actually changes (avoid wiping mid-event)
    if body.number_of_courts is not None:
        existing = db.query(Court).filter(Court.tournament_id == t.id).order_by(Court.court_number).all()
        if len(existing) != body.number_of_courts:
            for c in existing:
                db.delete(c)
            for i in range(1, body.number_of_courts + 1):
                db.add(Court(tournament_id=t.id, name=f"Court {i}", court_number=i))
    db.commit()
    db.refresh(t)
    return _tournament_out(db, t)


# ── Registration / Teams ──────────────────────────────────────

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

    # Partner user — create placeholder account if needed
    partner = db.query(User).filter(User.email == body.partner_email.lower()).first()
    if not partner:
        partner = User(
            email=body.partner_email.lower(),
            password_hash=hash_password(str(uuid4())),
            full_name=body.partner_name.strip(),
            role="PLAYER",
            university_id=body.university_id,
            must_set_password=True,
        )
        db.add(partner)
        db.flush()
        _ensure_ranking(db, partner.id)

    if partner.id == user.id:
        raise HTTPException(400, "Partner must be a different player")

    paid_already = (
        db.query(TeamPlayer)
        .join(Team)
        .join(Registration, Registration.team_id == Team.id)
        .filter(
            Team.tournament_id == t.id,
            Team.withdrawn.is_(False),
            TeamPlayer.user_id.in_([user.id, partner.id]),
            Registration.status == PaymentStatus.PAID.value,
        )
        .first()
    )
    if paid_already:
        raise HTTPException(400, "You or your partner are already registered for this tournament")

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
        return _issue_checkout(db, t, team, pending_mine)

    team = Team(
        tournament_id=t.id,
        name=body.team_name.strip(),
        university_id=body.university_id or user.university_id,
    )
    db.add(team)
    db.flush()
    db.add(TeamPlayer(team_id=team.id, user_id=user.id, slot=1, invitation_accepted=True))
    db.add(TeamPlayer(team_id=team.id, user_id=partner.id, slot=2, invitation_accepted=False))

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


def _issue_checkout(db: Session, t: Tournament, team: Team | None, reg: Registration) -> CheckoutResponse:
    if not team:
        raise HTTPException(404, "Team not found")
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
                        "product_data": {"name": f"{t.name} — {team.name}"},
                        "unit_amount": t.entry_fee_cents,
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{settings.frontend_url}/t/{t.slug}/confirmed?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{settings.frontend_url}/t/{t.slug}/join",
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
        message="Registration confirmed (demo payment — set STRIPE_SECRET_KEY for live payments)",
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

    # Seed teams
    for i, team in enumerate(sorted(paid_teams, key=lambda x: x.name), start=1):
        team.seed = i

    start_dt = datetime.combine(t.event_date, t.start_time).replace(tzinfo=timezone.utc)
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
        m = Match(
            tournament_id=t.id,
            round=gm.round,
            stage=gm.stage,
            group_id=group_map[gm.group_name].id if gm.group_name else None,
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
    _assert_organiser(user, t)

    if getattr(m, "ratings_applied", False):
        raise HTTPException(400, "This match already updated ratings and cannot be re-scored")

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

    # Apply doubles/singles Elo once when a match first completes
    if (
        body.status in (MatchStatus.COMPLETED, MatchStatus.WALKOVER)
        and m.winner_id
        and m.team_a_id
        and m.team_b_id
        and not m.ratings_applied
    ):
        side_a = [
            tp.user_id
            for tp in db.query(TeamPlayer).filter(TeamPlayer.team_id == m.team_a_id).all()
        ]
        side_b = [
            tp.user_id
            for tp in db.query(TeamPlayer).filter(TeamPlayer.team_id == m.team_b_id).all()
        ]
        if side_a and side_b:
            sets = [
                (body.set1_a, body.set1_b),
                (body.set2_a, body.set2_b),
                (body.set3_a, body.set3_b),
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
                placement=f"t:{t.slug if t else m.round}"[:40],
            )
            m.ratings_applied = True

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
    _assert_organiser(user, t)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        data["status"] = data["status"].value
    for k, v in data.items():
        setattr(m, k, v)
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
    next_match = None
    my_results = []
    if user:
        membership = (
            db.query(TeamPlayer)
            .join(Team)
            .filter(Team.tournament_id == t.id, TeamPlayer.user_id == user.id, Team.withdrawn.is_(False))
            .first()
        )
        if membership:
            my_team = db.get(Team, membership.team_id)
            upcoming = (
                db.query(Match)
                .options(joinedload(Match.score))
                .filter(
                    Match.tournament_id == t.id,
                    Match.status.in_([MatchStatus.SCHEDULED.value, MatchStatus.CALLED.value, MatchStatus.LIVE.value]),
                    ((Match.team_a_id == my_team.id) | (Match.team_b_id == my_team.id)),
                )
                .order_by(Match.scheduled_start)
                .first()
            )
            if upcoming:
                next_match = _match_out(db, upcoming)
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
    return {
        "tournament": _tournament_out(db, t),
        "my_team": {"id": my_team.id, "name": my_team.name} if my_team else None,
        "next_match": next_match,
        "my_results": my_results,
        "live_matches": [_match_out(db, m) for m in live],
        "standings": get_standings(slug_or_id, db),
    }


@router.get("/tournaments/{slug_or_id}/display")
def tv_display(slug_or_id: str, db: Session = Depends(get_db)):
    t = _resolve_tournament(db, slug_or_id)
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
        by_court.setdefault(m.court_number, []).append(_match_out(db, m))
    return {
        "tournament": _tournament_out(db, t),
        "courts": by_court,
        "live_count": sum(1 for m in matches if m.status == MatchStatus.LIVE.value),
    }


@router.get("/rankings")
def rankings(limit: int = 50, db: Session = Depends(get_db)):
    from app.models import Ranking
    from app.api.profiles import _public_url

    rows = (
        db.query(Ranking, User, University)
        .join(User, Ranking.user_id == User.id)
        .outerjoin(University, User.university_id == University.id)
        .order_by(Ranking.points.desc())
        .limit(limit)
        .all()
    )
    return [
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
            avatar_url=_public_url(u.avatar_url),
        )
        for i, (r, u, uni) in enumerate(rows)
    ]


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
def organiser_dashboard(user: User = Depends(require_role(Role.ORGANISER)), db: Session = Depends(get_db)):
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
        checked = db.query(Team).filter(Team.tournament_id == t.id, Team.checked_in.is_(True)).count()
        stats.append(
            {
                "tournament": _tournament_out(db, t),
                "teams": teams,
                "players": teams * 2,
                "paid_registrations": paid,
                "revenue_cents": sum(r.amount_cents for r in revenue),
                "live_matches": live,
                "completed_matches": completed,
                "checked_in": checked,
            }
        )
    return {"tournaments": stats}
