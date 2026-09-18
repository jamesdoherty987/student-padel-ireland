"""Configurable standings / tie-break calculation."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class MatchResult:
    team_a_id: str
    team_b_id: str
    # Set scores as list of (games_a, games_b); winner is who takes more sets
    sets: list[tuple[int, int]]
    walkover_winner_id: str | None = None
    status: str = "COMPLETED"


@dataclass
class StandingRow:
    team_id: str
    played: int = 0
    wins: int = 0
    losses: int = 0
    points: int = 0
    sets_won: int = 0
    sets_lost: int = 0
    games_won: int = 0
    games_lost: int = 0
    head_to_head: dict[str, int] = field(default_factory=dict)  # opponent -> points earned vs them

    @property
    def set_difference(self) -> int:
        return self.sets_won - self.sets_lost

    @property
    def game_difference(self) -> int:
        return self.games_won - self.games_lost


DEFAULT_TIE_BREAK = [
    "points",
    "head_to_head",
    "set_difference",
    "game_difference",
    "games_won",
]

POINTS_WIN = 3
POINTS_LOSS = 0


def _sets_won(sets: list[tuple[int, int]]) -> tuple[int, int]:
    a = b = 0
    for ga, gb in sets:
        if ga > gb:
            a += 1
        elif gb > ga:
            b += 1
    return a, b


def accumulate_standings(team_ids: Iterable[str], results: Iterable[MatchResult]) -> dict[str, StandingRow]:
    rows = {tid: StandingRow(team_id=tid) for tid in team_ids}
    for r in results:
        if r.status not in ("COMPLETED", "WALKOVER"):
            continue
        if r.team_a_id not in rows or r.team_b_id not in rows:
            continue
        a = rows[r.team_a_id]
        b = rows[r.team_b_id]
        a.played += 1
        b.played += 1

        if r.walkover_winner_id:
            winner = r.walkover_winner_id
            loser = r.team_b_id if winner == r.team_a_id else r.team_a_id
            rows[winner].wins += 1
            rows[winner].points += POINTS_WIN
            rows[loser].losses += 1
            rows[loser].points += POINTS_LOSS
            rows[winner].head_to_head[loser] = rows[winner].head_to_head.get(loser, 0) + POINTS_WIN
            rows[loser].head_to_head[winner] = rows[loser].head_to_head.get(winner, 0) + POINTS_LOSS
            continue

        sa, sb = _sets_won(r.sets)
        a.sets_won += sa
        a.sets_lost += sb
        b.sets_won += sb
        b.sets_lost += sa
        for ga, gb in r.sets:
            a.games_won += ga
            a.games_lost += gb
            b.games_won += gb
            b.games_lost += ga

        if sa > sb:
            a.wins += 1
            a.points += POINTS_WIN
            b.losses += 1
            b.points += POINTS_LOSS
            a.head_to_head[b.team_id] = a.head_to_head.get(b.team_id, 0) + POINTS_WIN
            b.head_to_head[a.team_id] = b.head_to_head.get(a.team_id, 0) + POINTS_LOSS
        elif sb > sa:
            b.wins += 1
            b.points += POINTS_WIN
            a.losses += 1
            a.points += POINTS_LOSS
            b.head_to_head[a.team_id] = b.head_to_head.get(a.team_id, 0) + POINTS_WIN
            a.head_to_head[b.team_id] = a.head_to_head.get(b.team_id, 0) + POINTS_LOSS

    return rows


def _tie_key(row: StandingRow, criterion: str, tied_ids: set[str]) -> tuple:
    if criterion == "points":
        return (row.points,)
    if criterion == "set_difference":
        return (row.set_difference,)
    if criterion == "game_difference":
        return (row.game_difference,)
    if criterion == "games_won":
        return (row.games_won,)
    if criterion == "sets_won":
        return (row.sets_won,)
    if criterion == "head_to_head":
        # Points earned among the currently tied subset
        h2h = sum(pts for opp, pts in row.head_to_head.items() if opp in tied_ids)
        return (h2h,)
    return (0,)


def rank_standings(
    rows: dict[str, StandingRow],
    tie_break_order: list[str] | None = None,
) -> list[StandingRow]:
    order = tie_break_order or DEFAULT_TIE_BREAK
    remaining = list(rows.values())

    def sort_group(group: list[StandingRow], criteria: list[str]) -> list[StandingRow]:
        if len(group) <= 1 or not criteria:
            return sorted(group, key=lambda r: r.team_id)
        crit = criteria[0]
        tied_ids = {r.team_id for r in group}
        group_sorted = sorted(
            group,
            key=lambda r: (_tie_key(r, crit, tied_ids), r.team_id),
            reverse=True if crit != "team_id" else False,
        )
        # Re-group by key and recurse
        result: list[StandingRow] = []
        i = 0
        while i < len(group_sorted):
            key = _tie_key(group_sorted[i], crit, tied_ids)
            j = i + 1
            while j < len(group_sorted) and _tie_key(group_sorted[j], crit, tied_ids) == key:
                j += 1
            subgroup = group_sorted[i:j]
            if len(subgroup) > 1:
                result.extend(sort_group(subgroup, criteria[1:]))
            else:
                result.extend(subgroup)
            i = j
        return result

    return sort_group(remaining, order)
