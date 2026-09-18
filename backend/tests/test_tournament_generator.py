"""Automated tests for the tournament generator — the critical correctness surface."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from itertools import combinations

import pytest

from app.services.tournament_generator import (
    GeneratorConfig,
    TeamRef,
    generate_tournament,
    _round_robin_pairs,
    _next_power_of_two,
    validate_generated,
)


def _teams(n: int) -> list[TeamRef]:
    return [TeamRef(id=f"t{i}", name=f"Team {i}", seed=i) for i in range(1, n + 1)]


def _config(n: int, courts: int = 6, group_size: int = 4, advance: int = 2) -> GeneratorConfig:
    return GeneratorConfig(
        teams=_teams(n),
        courts=courts,
        match_duration_minutes=20,
        start_time=datetime(2026, 6, 15, 10, 0),
        group_size=group_size,
        teams_advance_per_group=advance,
        format="GROUP_KNOCKOUT",
    )


def test_round_robin_no_self_matches():
    ids = [f"t{i}" for i in range(4)]
    pairs = _round_robin_pairs(ids)
    for a, b in pairs:
        assert a != b
    # Each unordered pair exactly once
    unordered = [frozenset({a, b}) for a, b in pairs]
    assert len(unordered) == len(set(unordered))
    assert len(pairs) == len(list(combinations(ids, 2)))


def test_round_robin_odd_count():
    ids = [f"t{i}" for i in range(5)]
    pairs = _round_robin_pairs(ids)
    for a, b in pairs:
        assert a != b
        assert a != "__BYE__" and b != "__BYE__"
    assert len(pairs) == len(list(combinations(ids, 2)))


@pytest.mark.parametrize("n", [8, 12, 16, 24, 32, 48, 64])
def test_group_knockout_all_teams_assigned(n):
    result = generate_tournament(_config(n))
    assigned = [tid for g in result.groups for tid in g.team_ids]
    assert len(assigned) == n
    assert len(set(assigned)) == n
    assert set(assigned) == {t.id for t in _teams(n)}


@pytest.mark.parametrize("n", [8, 16, 48])
def test_no_self_matches_anywhere(n):
    result = generate_tournament(_config(n))
    for m in result.matches:
        if m.team_a_id and m.team_b_id:
            assert m.team_a_id != m.team_b_id, f"Self-match in {m.round}"


@pytest.mark.parametrize("n,group_size", [(48, 4), (32, 4), (16, 4), (12, 3)])
def test_each_team_plays_everyone_in_group(n, group_size):
    result = generate_tournament(_config(n, group_size=group_size))
    for g in result.groups:
        expected_pairs = {frozenset(p) for p in combinations(g.team_ids, 2)}
        actual = {
            frozenset({m.team_a_id, m.team_b_id})
            for m in result.matches
            if m.group_name == g.name and m.stage == "GROUP"
        }
        assert actual == expected_pairs


def test_classic_48_teams_6_courts():
    result = generate_tournament(_config(48, courts=6, group_size=4, advance=2))
    assert len(result.groups) == 12
    assert all(len(g.team_ids) == 4 for g in result.groups)
    # 12 groups * C(4,2)=6 = 72 group matches
    group_matches = [m for m in result.matches if m.stage == "GROUP"]
    assert len(group_matches) == 72
    # 12*2=24 advance → bracket of 32 → R32 has 16 matches
    assert "ROUND_OF_32" in result.knockout_rounds
    assert result.knockout_rounds[-1] == "FINAL"
    r32 = [m for m in result.matches if m.round == "ROUND_OF_32"]
    assert len(r32) == 16
    finals = [m for m in result.matches if m.round == "FINAL"]
    assert len(finals) == 1


def test_courts_assigned_and_times_monotonic_per_court():
    result = generate_tournament(_config(16, courts=4))
    by_court: dict[int, list] = defaultdict(list)
    for m in result.matches:
        assert m.court_number is not None
        assert 1 <= m.court_number <= 4
        assert m.scheduled_start is not None
        by_court[m.court_number].append(m.scheduled_start)
    for times in by_court.values():
        assert times == sorted(times)


def test_knockout_feeders_no_team_plays_itself_placeholder():
    result = generate_tournament(_config(16))
    ko = [m for m in result.matches if m.stage == "KNOCKOUT"]
    for m in ko:
        if m.team_a_placeholder and m.team_b_placeholder:
            # Placeholders for same match should differ when both are concrete group refs
            if m.team_a_placeholder.startswith("1st") or m.team_a_placeholder.startswith("2nd"):
                assert m.team_a_placeholder != m.team_b_placeholder


def test_unsupported_format_raises():
    cfg = _config(8)
    cfg.format = "SWISS"
    with pytest.raises(ValueError, match="Unsupported"):
        generate_tournament(cfg)


def test_too_few_teams_raises():
    with pytest.raises(ValueError, match="at least 2"):
        generate_tournament(_config(1))


def test_validate_catches_self_match():
    result = generate_tournament(_config(8))
    result.matches[0].team_b_id = result.matches[0].team_a_id
    with pytest.raises(ValueError, match="Self-match"):
        validate_generated(result, {t.id for t in _teams(8)})


def test_next_power_of_two():
    assert _next_power_of_two(1) == 1
    assert _next_power_of_two(2) == 2
    assert _next_power_of_two(3) == 4
    assert _next_power_of_two(24) == 32
    assert _next_power_of_two(48) == 64


def test_round_robin_format():
    cfg = _config(6)
    cfg.format = "ROUND_ROBIN"
    result = generate_tournament(cfg)
    assert len(result.groups) == 1
    assert len(result.matches) == 15  # C(6,2)
    assert all(m.stage == "GROUP" for m in result.matches)


def test_appearances_balanced_within_group():
    result = generate_tournament(_config(48))
    appearances: Counter[str] = Counter()
    for m in result.matches:
        if m.stage == "GROUP":
            appearances[m.team_a_id] += 1
            appearances[m.team_b_id] += 1
    for tid, count in appearances.items():
        assert count == 3  # 4-team groups → 3 matches each
