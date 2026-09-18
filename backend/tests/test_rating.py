"""Unit tests for doubles-aware Elo."""

from uuid import uuid4

from app.services.rating import (
    INITIAL_RATING,
    compute_side_updates,
    expected_score,
    team_rating,
)


def test_expected_score_equal():
    assert abs(expected_score(1500, 1500) - 0.5) < 1e-9


def test_expected_score_favourite():
    e = expected_score(1700, 1500)
    assert e > 0.7


def test_team_rating_average():
    assert team_rating([1600, 1400]) == 1500


def test_doubles_upset_gives_large_gain():
    """Weaker pair beats stronger pair → winners gain more than losers lose symmetrically per K."""
    a1, a2, b1, b2 = uuid4(), uuid4(), uuid4(), uuid4()
    # Side A weaker avg 1400, Side B stronger avg 1600; A wins
    updates = compute_side_updates(
        [(a1, 1450, 5), (a2, 1350, 5)],
        [(b1, 1650, 5), (b2, 1550, 5)],
        a_won=True,
        sets_a=2,
        sets_b=0,
    )
    by_id = {u.user_id: u for u in updates}
    assert by_id[a1].delta > 20
    assert by_id[a2].delta > 20
    assert by_id[b1].delta < -20
    assert by_id[b2].delta < -20


def test_singles_favourite_win_small_gain():
    a, b = uuid4(), uuid4()
    updates = compute_side_updates(
        [(a, 1700, 30)],
        [(b, 1400, 30)],
        a_won=True,
        sets_a=2,
        sets_b=0,
    )
    by_id = {u.user_id: u for u in updates}
    assert 0 < by_id[a].delta < 12
    assert by_id[b].delta < 0


def test_partner_and_opponents_affect_expectation():
    """Same player, stronger partner → lower expected upset value when winning."""
    me = uuid4()
    weak_partner, strong_partner = uuid4(), uuid4()
    o1, o2 = uuid4(), uuid4()
    weak_team = compute_side_updates(
        [(me, 1500, 20), (weak_partner, 1300, 20)],
        [(o1, 1500, 20), (o2, 1500, 20)],
        a_won=True,
        sets_a=2,
        sets_b=1,
    )
    strong_team = compute_side_updates(
        [(me, 1500, 20), (strong_partner, 1700, 20)],
        [(o1, 1500, 20), (o2, 1500, 20)],
        a_won=True,
        sets_a=2,
        sets_b=1,
    )
    delta_weak_partner = next(u.delta for u in weak_team if u.user_id == me)
    delta_strong_partner = next(u.delta for u in strong_team if u.user_id == me)
    # Winning with a weaker partner against equal opponents is more surprising
    assert delta_weak_partner > delta_strong_partner


def test_initial_constant():
    assert INITIAL_RATING == 1500
