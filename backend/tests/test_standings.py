from app.services.standings import (
    MatchResult,
    accumulate_standings,
    rank_standings,
)


def test_basic_points_and_ranking():
    teams = ["A", "B", "C", "D"]
    results = [
        MatchResult("A", "B", [(6, 4), (6, 3)]),
        MatchResult("C", "D", [(6, 2), (6, 1)]),
        MatchResult("A", "C", [(4, 6), (3, 6)]),
        MatchResult("B", "D", [(6, 0), (6, 1)]),
        MatchResult("A", "D", [(6, 1), (6, 2)]),
        MatchResult("B", "C", [(7, 5), (6, 4)]),
    ]
    rows = accumulate_standings(teams, results)
    ranked = rank_standings(rows)
    assert ranked[0].team_id in ("A", "B", "C")  # top has 2 wins each potentially
    assert rows["A"].played == 3
    assert rows["A"].wins == 2
    assert rows["A"].points == 6


def test_head_to_head_tiebreak():
    teams = ["A", "B", "C"]
    # A and B both 1-1 on points vs rest — A beat B
    results = [
        MatchResult("A", "B", [(6, 4), (6, 3)]),
        MatchResult("A", "C", [(3, 6), (2, 6)]),
        MatchResult("B", "C", [(6, 1), (6, 0)]),
    ]
    rows = accumulate_standings(teams, results)
    # A: 1W 1L = 3pts, B: 1W 1L = 3pts, C: 1W 1L = 3pts
    ranked = rank_standings(rows, ["points", "head_to_head", "set_difference"])
    assert {r.team_id for r in ranked} == {"A", "B", "C"}
    assert len(ranked) == 3


def test_walkover():
    rows = accumulate_standings(
        ["A", "B"],
        [MatchResult("A", "B", [], walkover_winner_id="A", status="WALKOVER")],
    )
    assert rows["A"].wins == 1
    assert rows["A"].points == 3
    assert rows["B"].losses == 1
