from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models import MatchStatus, TournamentFormat, TournamentStatus, UserRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserPublic"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=200)
    phone: Optional[str] = None
    university_id: Optional[UUID] = None
    student_number: Optional[str] = None
    role: UserRole = UserRole.PLAYER

    @field_validator("role")
    @classmethod
    def only_player_or_organiser_signup(cls, v: UserRole) -> UserRole:
        if v == UserRole.ADMIN:
            raise ValueError("Cannot self-register as ADMIN")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    phone: Optional[str] = None
    role: str
    university_id: Optional[UUID] = None
    student_number: Optional[str] = None
    is_active: bool

    model_config = {"from_attributes": True}


class ProfileMediaOut(BaseModel):
    id: UUID
    media_type: str
    url: str
    caption: Optional[str] = None
    sort_order: int = 0
    is_avatar: bool = False
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class UserProfilePublic(BaseModel):
    id: UUID
    full_name: str
    university_name: Optional[str] = None
    university_short: Optional[str] = None
    points: int = 0
    rank_ireland: Optional[int] = None
    tournaments_played: int = 0
    matches_played: int = 0
    wins: int = 0
    losses: int = 0
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    media: list[ProfileMediaOut] = Field(default_factory=list)
    is_own_profile: bool = False


class ProfileUpdate(BaseModel):
    bio: Optional[str] = Field(default=None, max_length=500)
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=200)


class ProfileMediaCaptionUpdate(BaseModel):
    caption: Optional[str] = Field(default=None, max_length=200)


class UniversityOut(BaseModel):
    id: UUID
    name: str
    short_name: str
    slug: str
    logo_url: Optional[str] = None

    model_config = {"from_attributes": True}


class TournamentCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    location: str
    venue: str
    event_date: date
    start_time: time
    number_of_courts: int = Field(default=4, ge=1, le=32)
    entry_fee_cents: int = Field(default=5000, ge=0)
    max_teams: int = Field(default=48, ge=2, le=256)
    registration_deadline: Optional[datetime] = None
    format: TournamentFormat = TournamentFormat.GROUP_KNOCKOUT
    rules: Optional[str] = None
    description: Optional[str] = None
    match_duration_minutes: int = Field(default=20, ge=5, le=120)
    group_size: int = Field(default=4, ge=2, le=8)
    teams_advance_per_group: int = Field(default=2, ge=1, le=4)
    tie_break_order: Optional[str] = None


class TournamentUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    event_date: Optional[date] = None
    start_time: Optional[time] = None
    number_of_courts: Optional[int] = Field(default=None, ge=1, le=32)
    entry_fee_cents: Optional[int] = Field(default=None, ge=0)
    max_teams: Optional[int] = Field(default=None, ge=2, le=256)
    registration_deadline: Optional[datetime] = None
    format: Optional[TournamentFormat] = None
    rules: Optional[str] = None
    description: Optional[str] = None
    status: Optional[TournamentStatus] = None
    match_duration_minutes: Optional[int] = Field(default=None, ge=5, le=120)
    group_size: Optional[int] = Field(default=None, ge=2, le=8)
    teams_advance_per_group: Optional[int] = Field(default=None, ge=1, le=4)
    tie_break_order: Optional[str] = None


class TournamentOut(BaseModel):
    id: UUID
    name: str
    slug: str
    location: str
    venue: str
    event_date: date
    start_time: time
    number_of_courts: int
    entry_fee_cents: int
    currency: str
    max_teams: int
    registration_deadline: Optional[datetime] = None
    format: str
    rules: Optional[str] = None
    description: Optional[str] = None
    status: str
    organiser_id: UUID
    match_duration_minutes: int
    group_size: int
    teams_advance_per_group: int
    registered_teams: int = 0

    model_config = {"from_attributes": True}


class TeamOut(BaseModel):
    id: UUID
    tournament_id: UUID
    name: str
    university_id: Optional[UUID] = None
    seed: Optional[int] = None
    checked_in: bool
    withdrawn: bool
    player_names: list[str] = []
    payment_status: Optional[str] = None

    model_config = {"from_attributes": True}


class RegisterTeamRequest(BaseModel):
    tournament_id: UUID
    team_name: str = Field(min_length=2, max_length=120)
    partner_name: str = Field(min_length=2, max_length=200)
    partner_email: EmailStr
    phone: Optional[str] = None
    university_id: Optional[UUID] = None
    student_number: Optional[str] = None


class CheckoutResponse(BaseModel):
    checkout_url: Optional[str] = None
    registration_id: UUID
    demo_mode: bool = False
    message: str = ""


class GenerateRequest(BaseModel):
    match_duration_minutes: Optional[int] = Field(default=None, ge=5, le=120)
    courts: Optional[int] = Field(default=None, ge=1, le=32)
    group_size: Optional[int] = Field(default=None, ge=2, le=8)
    teams_advance_per_group: Optional[int] = Field(default=None, ge=1, le=4)


class ScoreUpdate(BaseModel):
    set1_a: int = Field(ge=0, le=20)
    set1_b: int = Field(ge=0, le=20)
    set2_a: int = Field(default=0, ge=0, le=20)
    set2_b: int = Field(default=0, ge=0, le=20)
    set3_a: int = Field(default=0, ge=0, le=20)
    set3_b: int = Field(default=0, ge=0, le=20)
    current_set: int = Field(default=1, ge=1, le=3)
    status: MatchStatus = MatchStatus.LIVE
    winner_id: Optional[UUID] = None


class MatchOut(BaseModel):
    id: UUID
    tournament_id: UUID
    round: str
    stage: str
    court_number: Optional[int] = None
    scheduled_start: Optional[datetime] = None
    team_a_id: Optional[UUID] = None
    team_b_id: Optional[UUID] = None
    team_a_name: Optional[str] = None
    team_b_name: Optional[str] = None
    team_a_placeholder: Optional[str] = None
    team_b_placeholder: Optional[str] = None
    status: str
    winner_id: Optional[UUID] = None
    score: Optional[dict] = None

    model_config = {"from_attributes": True}


class MatchMove(BaseModel):
    court_number: Optional[int] = Field(default=None, ge=1, le=32)
    scheduled_start: Optional[datetime] = None
    team_a_id: Optional[UUID] = None
    team_b_id: Optional[UUID] = None
    status: Optional[MatchStatus] = None


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    is_pinned: bool = False


class AnnouncementOut(BaseModel):
    id: UUID
    tournament_id: UUID
    title: str
    body: str
    is_pinned: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class StandingOut(BaseModel):
    team_id: UUID
    team_name: str
    played: int
    wins: int
    losses: int
    points: int
    sets_won: int
    sets_lost: int
    games_won: int
    games_lost: int
    set_difference: int
    game_difference: int


class CheckInRequest(BaseModel):
    player1_present: bool = True
    player2_present: bool = True


class SponsorOut(BaseModel):
    id: UUID
    name: str
    logo_url: Optional[str] = None
    website: Optional[str] = None
    description: Optional[str] = None
    level: str

    model_config = {"from_attributes": True}


# ── Community / friends ───────────────────────────────────────

class PlayerSearchOut(BaseModel):
    id: UUID
    full_name: str
    university_short: Optional[str] = None
    points: int = 1500
    friendship_status: Optional[str] = None  # none | pending_out | pending_in | friends


class FriendRequestCreate(BaseModel):
    user_id: UUID


class FriendshipOut(BaseModel):
    id: UUID
    user_id: UUID
    full_name: str
    university_short: Optional[str] = None
    points: int = 1500
    status: str
    direction: str  # incoming | outgoing | friend
    created_at: datetime


class CompetitionCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    format: str = "DOUBLES"  # SINGLES | DOUBLES | MIXED
    max_players: int = Field(default=16, ge=2, le=64)
    number_of_courts: int = Field(default=2, ge=1, le=12)
    friend_ids: list[UUID] = Field(default_factory=list, max_length=32)


class CompetitionMemberOut(BaseModel):
    user_id: UUID
    full_name: str
    role: str
    points: int = 1500
    wins: int = 0
    losses: int = 0
    # Local to this competition (from completed matches here)
    comp_wins: int = 0
    comp_losses: int = 0


class CompetitionOut(BaseModel):
    id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    format: str
    status: str
    invite_code: str
    created_by_id: UUID
    created_by_name: str
    max_players: int
    number_of_courts: int = 2
    member_count: int
    members: list[CompetitionMemberOut] = Field(default_factory=list)
    is_member: bool = False
    is_owner: bool = False


class CompetitionInviteFriends(BaseModel):
    friend_ids: list[UUID] = Field(min_length=1, max_length=32)


class CommunityMatchCreate(BaseModel):
    format: str = "DOUBLES"  # SINGLES | DOUBLES
    player_a1_id: UUID
    player_a2_id: Optional[UUID] = None
    player_b1_id: UUID
    player_b2_id: Optional[UUID] = None
    court_number: Optional[int] = Field(default=None, ge=1, le=12)
    notes: Optional[str] = Field(default=None, max_length=300)


class CommunityMatchCourtUpdate(BaseModel):
    court_number: Optional[int] = Field(default=None, ge=1, le=12)


class CommunityMatchScore(BaseModel):
    set1_a: int = Field(default=0, ge=0, le=7)
    set1_b: int = Field(default=0, ge=0, le=7)
    set2_a: int = Field(default=0, ge=0, le=7)
    set2_b: int = Field(default=0, ge=0, le=7)
    set3_a: int = Field(default=0, ge=0, le=7)
    set3_b: int = Field(default=0, ge=0, le=7)
    winner_side: Optional[str] = None  # A | B — inferred from sets if omitted
    status: str = "AWAITING_CONFIRM"  # AWAITING_CONFIRM | CANCELLED


class RatingDeltaOut(BaseModel):
    user_id: UUID
    full_name: str
    delta: int
    rating_after: int
    won: bool


class CommunityMatchOut(BaseModel):
    id: UUID
    competition_id: UUID
    competition_name: Optional[str] = None
    competition_slug: Optional[str] = None
    format: str
    status: str
    player_a1_id: UUID
    player_a1_name: str
    player_a2_id: Optional[UUID] = None
    player_a2_name: Optional[str] = None
    player_b1_id: UUID
    player_b1_name: str
    player_b2_id: Optional[UUID] = None
    player_b2_name: Optional[str] = None
    winner_side: Optional[str] = None
    set1_a: int = 0
    set1_b: int = 0
    set2_a: int = 0
    set2_b: int = 0
    set3_a: int = 0
    set3_b: int = 0
    played_at: Optional[datetime] = None
    notes: Optional[str] = None
    court_number: Optional[int] = None
    ratings_applied: bool = False
    recorded_by_id: Optional[UUID] = None
    confirmed_by_id: Optional[UUID] = None
    needs_my_confirm: bool = False
    can_i_score: bool = False
    rating_changes: list[RatingDeltaOut] = Field(default_factory=list)


class CommunityHomeOut(BaseModel):
    competitions: list[CompetitionOut]
    needs_confirm: list[CommunityMatchOut]
    needs_score: list[CommunityMatchOut]
    my_next_matches: list[CommunityMatchOut] = Field(default_factory=list)
    friend_request_count: int = 0


TokenResponse.model_rebuild()
