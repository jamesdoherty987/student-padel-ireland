"""
Doubles-aware Elo ratings for padel.

Approach (used by padel apps / Tennis Abstract "D-Lo"):
- Each player has a personal rating (starts at 1500).
- Singles: classic Elo between the two players.
- Doubles: team strength = average of both partners; expected win
  probability uses both partners and both opponents. After the match,
  every player updates individually from that shared team expectation.

Beating stronger opposition (or a stronger pair) moves your rating more;
beating weaker opposition moves it less. Changing partners does not
reset your rating — it stays personal.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Ranking, RankingHistory, User

INITIAL_RATING = 1500
K_PROVISIONAL = 40  # fewer than PROVISIONAL_MATCHES games
K_STANDARD = 24
K_VETERAN = 16  # many games → more stable
PROVISIONAL_MATCHES = 15
VETERAN_MATCHES = 60
SCALE = 400.0


@dataclass
class PlayerRatingUpdate:
    user_id: UUID
    rating_before: int
    rating_after: int
    delta: int
    won: bool


def expected_score(rating: float, opponent_rating: float) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent_rating - rating) / SCALE))


def team_rating(ratings: Sequence[float]) -> float:
    if not ratings:
        raise ValueError("Team needs at least one rating")
    return sum(ratings) / len(ratings)


def k_factor(matches_played: int) -> float:
    if matches_played < PROVISIONAL_MATCHES:
        return float(K_PROVISIONAL)
    if matches_played >= VETERAN_MATCHES:
        return float(K_VETERAN)
    return float(K_STANDARD)


def margin_multiplier(sets_won: int, sets_lost: int) -> float:
    """Mild score-margin boost so 2-0 moves ratings slightly more than 2-1."""
    diff = abs(sets_won - sets_lost)
    if diff <= 0:
        return 1.0
    if diff == 1:
        return 1.0
    return 1.15  # e.g. 2–0


def compute_side_updates(
    side_a_ratings: Sequence[tuple[UUID, float, int]],
    side_b_ratings: Sequence[tuple[UUID, float, int]],
    *,
    a_won: bool,
    sets_a: int = 0,
    sets_b: int = 0,
) -> list[PlayerRatingUpdate]:
    """
    side_*_ratings: list of (user_id, rating, matches_played).
    Works for 1v1 (singles) and 2v2 (doubles). Uneven sides are allowed
    but rare — team strength is still the average of whoever played.
    """
    if not side_a_ratings or not side_b_ratings:
        raise ValueError("Both sides need at least one player")

    avg_a = team_rating([r for _, r, _ in side_a_ratings])
    avg_b = team_rating([r for _, r, _ in side_b_ratings])
    e_a = expected_score(avg_a, avg_b)
    e_b = 1.0 - e_a
    s_a = 1.0 if a_won else 0.0
    s_b = 1.0 - s_a
    margin = margin_multiplier(sets_a, sets_b)

    updates: list[PlayerRatingUpdate] = []
    for user_id, rating, matches in side_a_ratings:
        k = k_factor(matches)
        delta = round(k * margin * (s_a - e_a))
        updates.append(
            PlayerRatingUpdate(
                user_id=user_id,
                rating_before=int(round(rating)),
                rating_after=max(100, int(round(rating)) + delta),
                delta=delta,
                won=a_won,
            )
        )
    for user_id, rating, matches in side_b_ratings:
        k = k_factor(matches)
        delta = round(k * margin * (s_b - e_b))
        updates.append(
            PlayerRatingUpdate(
                user_id=user_id,
                rating_before=int(round(rating)),
                rating_after=max(100, int(round(rating)) + delta),
                delta=delta,
                won=not a_won,
            )
        )
    return updates


def ensure_ranking(db: Session, user_id: UUID) -> Ranking:
    ranking = db.query(Ranking).filter(Ranking.user_id == user_id).first()
    if ranking:
        # Migrate legacy Ireland-points scale onto Elo (<800 was never a real Elo rating here)
        if ranking.points < 800:
            ranking.points = INITIAL_RATING
        return ranking
    ranking = Ranking(user_id=user_id, points=INITIAL_RATING)
    db.add(ranking)
    db.flush()
    return ranking


def load_side(
    db: Session, user_ids: Iterable[UUID]
) -> list[tuple[UUID, float, int]]:
    out: list[tuple[UUID, float, int]] = []
    for uid in user_ids:
        r = ensure_ranking(db, uid)
        out.append((uid, float(r.points), r.matches_played))
    return out


def apply_rating_updates(
    db: Session,
    updates: Sequence[PlayerRatingUpdate],
    *,
    tournament_id: Optional[UUID] = None,
    community_match_id: Optional[UUID] = None,
    placement: Optional[str] = None,
) -> list[PlayerRatingUpdate]:
    placement_safe = (placement or "")[:40] or None
    for u in updates:
        ranking = ensure_ranking(db, u.user_id)
        ranking.points = u.rating_after
        ranking.matches_played = (ranking.matches_played or 0) + 1
        if u.won:
            ranking.wins = (ranking.wins or 0) + 1
        else:
            ranking.losses = (ranking.losses or 0) + 1
        db.add(
            RankingHistory(
                user_id=u.user_id,
                tournament_id=tournament_id,
                community_match_id=community_match_id,
                points_delta=u.delta,
                points_after=u.rating_after,
                placement=placement_safe,
            )
        )
    _recompute_ireland_ranks(db)
    return list(updates)


def _recompute_ireland_ranks(db: Session) -> None:
    rows = db.query(Ranking).order_by(Ranking.points.desc(), Ranking.wins.desc()).all()
    for i, row in enumerate(rows, start=1):
        row.rank_ireland = i


def rate_match(
    db: Session,
    *,
    side_a_user_ids: Sequence[UUID],
    side_b_user_ids: Sequence[UUID],
    a_won: bool,
    sets_a: int = 0,
    sets_b: int = 0,
    tournament_id: Optional[UUID] = None,
    community_match_id: Optional[UUID] = None,
    placement: Optional[str] = None,
) -> list[PlayerRatingUpdate]:
    side_a = load_side(db, side_a_user_ids)
    side_b = load_side(db, side_b_user_ids)
    updates = compute_side_updates(
        side_a,
        side_b,
        a_won=a_won,
        sets_a=sets_a,
        sets_b=sets_b,
    )
    return apply_rating_updates(
        db,
        updates,
        tournament_id=tournament_id,
        community_match_id=community_match_id,
        placement=placement,
    )


def display_name_for(db: Session, user_id: UUID) -> str:
    user = db.get(User, user_id)
    return user.full_name if user else str(user_id)
