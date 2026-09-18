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


TokenResponse.model_rebuild()
