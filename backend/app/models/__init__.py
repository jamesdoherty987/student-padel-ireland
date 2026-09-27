from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from enum import StrEnum
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserRole(StrEnum):
    PLAYER = "PLAYER"
    ORGANISER = "ORGANISER"
    ADMIN = "ADMIN"


class TournamentStatus(StrEnum):
    DRAFT = "DRAFT"
    REGISTRATION_OPEN = "REGISTRATION_OPEN"
    REGISTRATION_CLOSED = "REGISTRATION_CLOSED"
    LIVE = "LIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class TournamentFormat(StrEnum):
    GROUP_KNOCKOUT = "GROUP_KNOCKOUT"
    ROUND_ROBIN = "ROUND_ROBIN"
    STRAIGHT_KNOCKOUT = "STRAIGHT_KNOCKOUT"
    SWISS = "SWISS"


class MatchStatus(StrEnum):
    SCHEDULED = "SCHEDULED"
    CALLED = "CALLED"
    LIVE = "LIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    WALKOVER = "WALKOVER"


class PaymentStatus(StrEnum):
    PENDING = "PENDING"
    PAID = "PAID"
    REFUNDED = "REFUNDED"
    FAILED = "FAILED"


class FriendshipStatus(StrEnum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    BLOCKED = "BLOCKED"


class CompetitionStatus(StrEnum):
    OPEN = "OPEN"
    LIVE = "LIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class CompetitionFormat(StrEnum):
    SINGLES = "SINGLES"
    DOUBLES = "DOUBLES"
    MIXED = "MIXED"  # allow both within one competition


class University(Base, TimestampMixin):
    __tablename__ = "universities"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    short_name: Mapped[str] = mapped_column(String(40), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    logo_url: Mapped[Optional[str]] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(40))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.PLAYER.value)
    university_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("universities.id"))
    student_number: Mapped[Optional[str]] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    must_set_password: Mapped[bool] = mapped_column(Boolean, default=False)
    bio: Mapped[Optional[str]] = mapped_column(String(500))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500))

    university: Mapped[Optional[University]] = relationship()
    ranking: Mapped[Optional["Ranking"]] = relationship(back_populates="user", uselist=False)
    media: Mapped[list["ProfileMedia"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", order_by="ProfileMedia.sort_order"
    )


class Tournament(Base, TimestampMixin):
    __tablename__ = "tournaments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    location: Mapped[str] = mapped_column(String(200), nullable=False)
    venue: Mapped[str] = mapped_column(String(200), nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    number_of_courts: Mapped[int] = mapped_column(Integer, default=4)
    entry_fee_cents: Mapped[int] = mapped_column(Integer, default=5000)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    max_teams: Mapped[int] = mapped_column(Integer, default=48)
    registration_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    format: Mapped[str] = mapped_column(String(40), default=TournamentFormat.GROUP_KNOCKOUT.value)
    rules: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default=TournamentStatus.DRAFT.value)
    organiser_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    match_duration_minutes: Mapped[int] = mapped_column(Integer, default=20)
    group_size: Mapped[int] = mapped_column(Integer, default=4)
    teams_advance_per_group: Mapped[int] = mapped_column(Integer, default=2)
    # JSON-ish comma list of tie-break keys
    tie_break_order: Mapped[str] = mapped_column(
        String(200),
        default="points,head_to_head,set_difference,game_difference,games_won",
    )
    description: Mapped[Optional[str]] = mapped_column(Text)

    organiser: Mapped[User] = relationship()
    teams: Mapped[list["Team"]] = relationship(back_populates="tournament")
    courts: Mapped[list["Court"]] = relationship(back_populates="tournament")
    matches: Mapped[list["Match"]] = relationship(back_populates="tournament")
    groups: Mapped[list["Group"]] = relationship(back_populates="tournament")
    announcements: Mapped[list["Announcement"]] = relationship(back_populates="tournament")
    sponsors: Mapped[list["Sponsor"]] = relationship(back_populates="tournament")


class Court(Base, TimestampMixin):
    __tablename__ = "courts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    court_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    tournament: Mapped[Tournament] = relationship(back_populates="courts")


class Team(Base, TimestampMixin):
    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    university_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("universities.id"))
    seed: Mapped[Optional[int]] = mapped_column(Integer)
    checked_in: Mapped[bool] = mapped_column(Boolean, default=False)
    player1_present: Mapped[bool] = mapped_column(Boolean, default=False)
    player2_present: Mapped[bool] = mapped_column(Boolean, default=False)
    withdrawn: Mapped[bool] = mapped_column(Boolean, default=False)

    tournament: Mapped[Tournament] = relationship(back_populates="teams")
    university: Mapped[Optional[University]] = relationship()
    members: Mapped[list["TeamPlayer"]] = relationship(back_populates="team", cascade="all, delete-orphan")
    registration: Mapped[Optional["Registration"]] = relationship(back_populates="team", uselist=False)


class TeamPlayer(Base, TimestampMixin):
    __tablename__ = "team_players"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_player"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    slot: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 or 2
    invitation_accepted: Mapped[bool] = mapped_column(Boolean, default=True)

    team: Mapped[Team] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Registration(Base, TimestampMixin):
    __tablename__ = "registrations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=PaymentStatus.PENDING.value)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    stripe_session_id: Mapped[Optional[str]] = mapped_column(String(255))
    stripe_payment_intent_id: Mapped[Optional[str]] = mapped_column(String(255))
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    team: Mapped[Team] = relationship(back_populates="registration")


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    registration_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("registrations.id"), nullable=False)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    stripe_payment_id: Mapped[Optional[str]] = mapped_column(String(255))
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    status: Mapped[str] = mapped_column(String(20), default=PaymentStatus.PENDING.value)


class Group(Base, TimestampMixin):
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    tournament: Mapped[Tournament] = relationship(back_populates="groups")
    group_teams: Mapped[list["GroupTeam"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class GroupTeam(Base, TimestampMixin):
    __tablename__ = "group_teams"
    __table_args__ = (UniqueConstraint("group_id", "team_id", name="uq_group_team"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id"), nullable=False)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), nullable=False)
    seed_in_group: Mapped[int] = mapped_column(Integer, default=0)

    group: Mapped[Group] = relationship(back_populates="group_teams")
    team: Mapped[Team] = relationship()


class Match(Base, TimestampMixin):
    __tablename__ = "matches"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    round: Mapped[str] = mapped_column(String(60), nullable=False)  # GROUP_A, QF, SF, FINAL, ...
    stage: Mapped[str] = mapped_column(String(40), default="GROUP")  # GROUP | KNOCKOUT
    group_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("groups.id"))
    court_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("courts.id"))
    court_number: Mapped[Optional[int]] = mapped_column(Integer)
    scheduled_start: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    team_a_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("teams.id"))
    team_b_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("teams.id"))
    # Placeholder labels for knockout TBD slots
    team_a_placeholder: Mapped[Optional[str]] = mapped_column(String(120))
    team_b_placeholder: Mapped[Optional[str]] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default=MatchStatus.SCHEDULED.value)
    winner_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("teams.id"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    next_match_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("matches.id"))
    next_match_slot: Mapped[Optional[str]] = mapped_column(String(1))  # A or B
    ratings_applied: Mapped[bool] = mapped_column(Boolean, default=False)

    tournament: Mapped[Tournament] = relationship(back_populates="matches")
    score: Mapped[Optional["MatchScore"]] = relationship(back_populates="match", uselist=False, cascade="all, delete-orphan")


class MatchScore(Base, TimestampMixin):
    __tablename__ = "match_scores"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"), unique=True, nullable=False)
    # Best of 3 sets typical for padel - store set games
    set1_a: Mapped[int] = mapped_column(Integer, default=0)
    set1_b: Mapped[int] = mapped_column(Integer, default=0)
    set2_a: Mapped[int] = mapped_column(Integer, default=0)
    set2_b: Mapped[int] = mapped_column(Integer, default=0)
    set3_a: Mapped[int] = mapped_column(Integer, default=0)
    set3_b: Mapped[int] = mapped_column(Integer, default=0)
    current_set: Mapped[int] = mapped_column(Integer, default=1)
    entered_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))

    match: Mapped[Match] = relationship(back_populates="score")


class Ranking(Base, TimestampMixin):
    __tablename__ = "rankings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    points: Mapped[int] = mapped_column(Integer, default=1500)
    rank_ireland: Mapped[Optional[int]] = mapped_column(Integer)
    tournaments_played: Mapped[int] = mapped_column(Integer, default=0)
    matches_played: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship(back_populates="ranking")


class RankingHistory(Base, TimestampMixin):
    __tablename__ = "ranking_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    tournament_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tournaments.id"))
    # Stored without FK to avoid create-order cycles with community_matches
    community_match_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid)
    points_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    points_after: Mapped[int] = mapped_column(Integer, nullable=False)
    placement: Mapped[Optional[str]] = mapped_column(String(40))


class Friendship(Base, TimestampMixin):
    """Directed friend request; accepted pairs are mutual."""

    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    addressee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default=FriendshipStatus.PENDING.value)

    requester: Mapped[User] = relationship(foreign_keys=[requester_id])
    addressee: Mapped[User] = relationship(foreign_keys=[addressee_id])


class CommunityCompetition(Base, TimestampMixin):
    """Private friend competition / ladder — no entry fee, invite-only."""

    __tablename__ = "community_competitions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(20), default=CompetitionFormat.DOUBLES.value)
    status: Mapped[str] = mapped_column(String(20), default=CompetitionStatus.OPEN.value)
    invite_code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    max_players: Mapped[int] = mapped_column(Integer, default=16)
    number_of_courts: Mapped[int] = mapped_column(Integer, default=2)

    created_by: Mapped[User] = relationship()
    members: Mapped[list["CompetitionMember"]] = relationship(
        back_populates="competition", cascade="all, delete-orphan"
    )
    matches: Mapped[list["CommunityMatch"]] = relationship(
        back_populates="competition", cascade="all, delete-orphan"
    )


class CompetitionMember(Base, TimestampMixin):
    __tablename__ = "competition_members"
    __table_args__ = (UniqueConstraint("competition_id", "user_id", name="uq_competition_member"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    competition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("community_competitions.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="PLAYER")  # OWNER | PLAYER

    competition: Mapped[CommunityCompetition] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class CommunityMatch(Base, TimestampMixin):
    __tablename__ = "community_matches"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    competition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("community_competitions.id"), nullable=False)
    format: Mapped[str] = mapped_column(String(20), default=CompetitionFormat.DOUBLES.value)
    status: Mapped[str] = mapped_column(String(20), default=MatchStatus.SCHEDULED.value)
    # Side A
    player_a1_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    player_a2_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    # Side B
    player_b1_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    player_b2_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    winner_side: Mapped[Optional[str]] = mapped_column(String(1))  # A | B
    set1_a: Mapped[int] = mapped_column(Integer, default=0)
    set1_b: Mapped[int] = mapped_column(Integer, default=0)
    set2_a: Mapped[int] = mapped_column(Integer, default=0)
    set2_b: Mapped[int] = mapped_column(Integer, default=0)
    set3_a: Mapped[int] = mapped_column(Integer, default=0)
    set3_b: Mapped[int] = mapped_column(Integer, default=0)
    played_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    recorded_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    confirmed_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("users.id"))
    ratings_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[Optional[str]] = mapped_column(String(300))
    court_number: Mapped[Optional[int]] = mapped_column(Integer)

    competition: Mapped[CommunityCompetition] = relationship(back_populates="matches")
    player_a1: Mapped[User] = relationship(foreign_keys=[player_a1_id])
    player_a2: Mapped[Optional[User]] = relationship(foreign_keys=[player_a2_id])
    player_b1: Mapped[User] = relationship(foreign_keys=[player_b1_id])
    player_b2: Mapped[Optional[User]] = relationship(foreign_keys=[player_b2_id])


class Announcement(Base, TimestampMixin):
    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tournaments.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)

    tournament: Mapped[Tournament] = relationship(back_populates="announcements")


class Sponsor(Base, TimestampMixin):
    __tablename__ = "sponsors"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tournament_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tournaments.id"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    logo_url: Mapped[Optional[str]] = mapped_column(String(500))
    website: Mapped[Optional[str]] = mapped_column(String(500))
    description: Mapped[Optional[str]] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(40), default="GOLD")  # MAIN, GOLD, SILVER, PRIZE, HYDRATION
    is_platform: Mapped[bool] = mapped_column(Boolean, default=False)

    tournament: Mapped[Optional[Tournament]] = relationship(back_populates="sponsors")


class PlatformSetting(Base, TimestampMixin):
    __tablename__ = "platform_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)


class ProfileMedia(Base, TimestampMixin):
    """Photos / short clips on a player profile."""

    __tablename__ = "profile_media"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(20), nullable=False)  # image | video
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    caption: Mapped[Optional[str]] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_avatar: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="media")
