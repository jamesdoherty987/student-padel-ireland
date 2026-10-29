"""
Configurable tournament generator.

Supports GROUP_KNOCKOUT initially. Architecture is pluggable so ROUND_ROBIN,
STRAIGHT_KNOCKOUT, SWISS, etc. can be added without rewriting callers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Protocol, Sequence


@dataclass(frozen=True)
class TeamRef:
    id: str
    name: str
    seed: int | None = None
    university: str | None = None


@dataclass
class GeneratedGroup:
    name: str
    sort_order: int
    team_ids: list[str]


@dataclass
class GeneratedMatch:
    round: str
    stage: str  # GROUP | KNOCKOUT
    group_name: str | None
    team_a_id: str | None
    team_b_id: str | None
    team_a_placeholder: str | None
    team_b_placeholder: str | None
    court_number: int | None
    scheduled_start: datetime | None
    sort_order: int
    # Links for knockout progression (indices into knockout matches list)
    feeds_into_index: int | None = None
    feeds_into_slot: str | None = None  # A | B


@dataclass
class GeneratorConfig:
    teams: list[TeamRef]
    courts: int
    match_duration_minutes: int
    start_time: datetime
    group_size: int = 4
    teams_advance_per_group: int = 2
    format: str = "GROUP_KNOCKOUT"
    enable_plate: bool = False
    championship_size: int = 16
    plate_size: int = 16
    # Optional: rest minutes between matches on same court
    court_buffer_minutes: int = 0


@dataclass
class GeneratedTournament:
    groups: list[GeneratedGroup] = field(default_factory=list)
    matches: list[GeneratedMatch] = field(default_factory=list)
    knockout_rounds: list[str] = field(default_factory=list)
    plate_rounds: list[str] = field(default_factory=list)
    # Metadata for organisers (partial fields / auto-adjustments)
    group_sizes: list[int] = field(default_factory=list)
    advance_per_group: int | None = None
    advance_adjusted: bool = False
    bye_slots: int = 0
    championship_size: int | None = None
    plate_size: int | None = None
    enable_plate: bool = False


def _balanced_group_sizes(n: int, preferred_size: int) -> list[int]:
    """
    Split n teams into groups as evenly as possible.

    Prefers groups near ``preferred_size`` but never leaves a size-1 group when
    n >= 2 (important when the event doesn't sell out).
    """
    if n <= 0:
        return []
    if n == 1:
        return [1]
    preferred = max(2, preferred_size)
    group_count = max(1, math.ceil(n / preferred))
    while group_count > 1 and n // group_count < 2:
        group_count -= 1
    base, rem = divmod(n, group_count)
    sizes = [base + (1 if i < rem else 0) for i in range(group_count)]
    # Safety: fold any accidental singleton into another group
    while len(sizes) > 1 and min(sizes) < 2:
        sizes.sort()
        singleton = sizes.pop(0)
        sizes[0] += singleton
    return sizes


def preview_draw(
    *,
    team_count: int,
    group_size: int = 4,
    teams_advance_per_group: int = 2,
    format: str = "GROUP_KNOCKOUT",
    enable_plate: bool = False,
    championship_size: int = 16,
    plate_size: int = 16,
) -> dict:
    """Dry-run summary for the generate confirm UI (no DB / no team list needed)."""
    fmt = format or "GROUP_KNOCKOUT"
    if team_count < 2:
        return {
            "ok": False,
            "error": "Need at least 2 paid entries to generate",
            "team_count": team_count,
            "format": fmt,
        }
    if fmt == "ROUND_ROBIN":
        group_matches = team_count * (team_count - 1) // 2
        return {
            "ok": True,
            "format": fmt,
            "team_count": team_count,
            "group_count": 1,
            "group_sizes": [team_count],
            "group_matches": group_matches,
            "advance_per_group": 0,
            "advance_adjusted": False,
            "advancing": 0,
            "bracket_size": 0,
            "bye_slots": 0,
            "knockout_rounds": [],
            "knockout_matches": 0,
            "plate_rounds": [],
            "plate_matches": 0,
            "enable_plate": False,
            "championship_size": 0,
            "plate_size": 0,
            "total_matches": group_matches,
        }

    sizes = _balanced_group_sizes(team_count, group_size)
    group_matches = sum(s * (s - 1) // 2 for s in sizes)

    if enable_plate:
        champ = _next_power_of_two(max(2, championship_size))
        plate = _next_power_of_two(max(2, plate_size))
        needed = champ + plate
        if needed > team_count:
            return {
                "ok": False,
                "error": (
                    f"Championship ({champ}) + Plate ({plate}) need {needed} teams, "
                    f"but only {team_count} are entered"
                ),
                "team_count": team_count,
                "format": fmt,
                "enable_plate": True,
            }
        champ_rounds = _knockout_round_names(champ)
        plate_rounds = _knockout_round_names(plate)
        knockout_matches = champ - 1
        plate_matches = plate - 1
        return {
            "ok": True,
            "format": fmt,
            "team_count": team_count,
            "group_count": len(sizes),
            "group_sizes": sizes,
            "group_matches": group_matches,
            "advance_per_group": 0,
            "advance_adjusted": False,
            "requested_advance": 0,
            "advancing": needed,
            "bracket_size": champ,
            "bye_slots": 0,
            "knockout_rounds": champ_rounds,
            "knockout_matches": knockout_matches,
            "plate_rounds": plate_rounds,
            "plate_matches": plate_matches,
            "enable_plate": True,
            "championship_size": champ,
            "plate_size": plate,
            "total_matches": group_matches + knockout_matches + plate_matches,
            "note": (
                f"{champ} teams → Championship knockout · "
                f"{plate} teams → Plate knockout"
            ),
        }

    min_size = min(sizes) if sizes else 0
    requested_advance = max(1, teams_advance_per_group)
    effective_advance = min(requested_advance, min_size) if min_size else 0
    advance_adjusted = effective_advance != requested_advance
    advancing = len(sizes) * effective_advance
    if advancing < 2:
        return {
            "ok": True,
            "format": fmt,
            "team_count": team_count,
            "group_count": len(sizes),
            "group_sizes": sizes,
            "group_matches": group_matches,
            "advance_per_group": effective_advance,
            "advance_adjusted": advance_adjusted,
            "advancing": advancing,
            "bracket_size": 0,
            "bye_slots": 0,
            "knockout_rounds": [],
            "knockout_matches": 0,
            "plate_rounds": [],
            "plate_matches": 0,
            "enable_plate": False,
            "championship_size": 0,
            "plate_size": 0,
            "total_matches": group_matches,
            "note": "Group stage only - not enough advancers for a knockout.",
        }
    bracket_size = _next_power_of_two(advancing)
    bye_slots = bracket_size - advancing
    rounds = _knockout_round_names(bracket_size)
    knockout_matches = bracket_size - 1  # full single-elim tree
    return {
        "ok": True,
        "format": fmt,
        "team_count": team_count,
        "group_count": len(sizes),
        "group_sizes": sizes,
        "group_matches": group_matches,
        "advance_per_group": effective_advance,
        "advance_adjusted": advance_adjusted,
        "requested_advance": requested_advance,
        "advancing": advancing,
        "bracket_size": bracket_size,
        "bye_slots": bye_slots,
        "knockout_rounds": rounds,
        "knockout_matches": knockout_matches,
        "plate_rounds": [],
        "plate_matches": 0,
        "enable_plate": False,
        "championship_size": 0,
        "plate_size": 0,
        "total_matches": group_matches + knockout_matches,
    }


class FormatGenerator(Protocol):
    def generate(self, config: GeneratorConfig) -> GeneratedTournament: ...


def _group_letter(index: int) -> str:
    """A, B, ... Z, AA, AB, ..."""
    letters = []
    n = index
    while True:
        letters.append(chr(ord("A") + (n % 26)))
        n = n // 26 - 1
        if n < 0:
            break
    return "".join(reversed(letters))


def _next_power_of_two(n: int) -> int:
    if n <= 1:
        return 1
    return 1 << (n - 1).bit_length()


def _is_power_of_two(n: int) -> bool:
    return n >= 2 and (n & (n - 1)) == 0


def _bracket_seed_order(n: int) -> list[int]:
    """Standard single-elim seed positions for a bracket of size n (power of 2)."""
    if n == 1:
        return [1]
    prev = _bracket_seed_order(n // 2)
    out: list[int] = []
    for p in prev:
        out.append(p)
        out.append(n + 1 - p)
    return out


def _build_seeded_bracket(
    *,
    stage: str,
    bracket_size: int,
    placeholder_prefix: str,
    sort_start: int,
) -> tuple[list[GeneratedMatch], list[str]]:
    """
    Build a full single-elim tree. First-round placeholders are
    ``{prefix} 1`` … ``{prefix} N`` placed in standard seed order.
    ``feeds_into_index`` is relative to the returned list.
    """
    if not _is_power_of_two(bracket_size):
        raise ValueError(f"{stage} bracket size must be a power of 2, got {bracket_size}")
    round_names = _knockout_round_names(bracket_size)
    seeds = _bracket_seed_order(bracket_size)
    matches: list[GeneratedMatch] = []
    sort = sort_start
    first_round_count = bracket_size // 2

    for i in range(first_round_count):
        sa = seeds[i * 2]
        sb = seeds[i * 2 + 1]
        matches.append(
            GeneratedMatch(
                round=round_names[0],
                stage=stage,
                group_name=None,
                team_a_id=None,
                team_b_id=None,
                team_a_placeholder=f"{placeholder_prefix} {sa}",
                team_b_placeholder=f"{placeholder_prefix} {sb}",
                court_number=None,
                scheduled_start=None,
                sort_order=sort,
            )
        )
        sort += 1

    prev_round_start = 0
    prev_round_count = first_round_count
    for rn in round_names[1:]:
        this_count = prev_round_count // 2
        this_start = len(matches)
        for i in range(this_count):
            matches.append(
                GeneratedMatch(
                    round=rn,
                    stage=stage,
                    group_name=None,
                    team_a_id=None,
                    team_b_id=None,
                    team_a_placeholder=f"Winner match {prev_round_start + i * 2 + 1}",
                    team_b_placeholder=f"Winner match {prev_round_start + i * 2 + 2}",
                    court_number=None,
                    scheduled_start=None,
                    sort_order=sort,
                )
            )
            feeder_a = prev_round_start + i * 2
            feeder_b = prev_round_start + i * 2 + 1
            matches[feeder_a].feeds_into_index = this_start + i
            matches[feeder_a].feeds_into_slot = "A"
            matches[feeder_b].feeds_into_index = this_start + i
            matches[feeder_b].feeds_into_slot = "B"
            sort += 1
        prev_round_start = this_start
        prev_round_count = this_count

    return matches, round_names


def _knockout_round_names(bracket_size: int) -> list[str]:
    """Return round names from first knockout round to FINAL."""
    names = {
        2: ["FINAL"],
        4: ["SEMI_FINAL", "FINAL"],
        8: ["QUARTER_FINAL", "SEMI_FINAL", "FINAL"],
        16: ["ROUND_OF_16", "QUARTER_FINAL", "SEMI_FINAL", "FINAL"],
        32: ["ROUND_OF_32", "ROUND_OF_16", "QUARTER_FINAL", "SEMI_FINAL", "FINAL"],
        64: ["ROUND_OF_64", "ROUND_OF_32", "ROUND_OF_16", "QUARTER_FINAL", "SEMI_FINAL", "FINAL"],
    }
    if bracket_size in names:
        return names[bracket_size]
    # Generic fallback
    rounds: list[str] = []
    size = bracket_size
    while size > 2:
        rounds.append(f"ROUND_OF_{size}")
        size //= 2
    rounds.append("FINAL")
    return rounds


def _seed_into_groups(teams: Sequence[TeamRef], group_count: int, group_size: int) -> list[list[TeamRef]]:
    """
    Snake seeding across evenly sized groups (partial fields OK).

    Group capacities come from ``_balanced_group_sizes`` so unsold spots don't
    leave a singleton group or dump leftovers into the last group.
    """
    ordered = sorted(
        teams,
        key=lambda t: (t.seed is None, t.seed if t.seed is not None else 10_000, t.name),
    )
    sizes = _balanced_group_sizes(len(ordered), group_size)
    if not sizes:
        return []
    # Prefer caller group_count only when it matches balanced plan length
    if group_count != len(sizes):
        sizes = _balanced_group_sizes(len(ordered), group_size)
    group_count = len(sizes)
    groups: list[list[TeamRef]] = [[] for _ in range(group_count)]
    direction = 1
    g = 0
    for team in ordered:
        placed = False
        for _ in range(group_count * 2):
            if len(groups[g]) < sizes[g]:
                groups[g].append(team)
                placed = True
                break
            if direction == 1 and g == group_count - 1:
                direction = -1
            elif direction == -1 and g == 0:
                direction = 1
            else:
                g += direction
                g = max(0, min(group_count - 1, g))
        if not placed:
            # Fallback: fill the group with the most remaining capacity
            idx = max(range(group_count), key=lambda i: sizes[i] - len(groups[i]))
            groups[idx].append(team)
            g = idx

        if direction == 1 and g == group_count - 1:
            direction = -1
        elif direction == -1 and g == 0:
            direction = 1
        else:
            g += direction
            g = max(0, min(group_count - 1, g))

    return [grp for grp in groups if grp]


def _round_robin_pairs(team_ids: list[str]) -> list[tuple[str, str]]:
    """Circle method - each team plays every other once. No self-matches."""
    ids = list(team_ids)
    if len(ids) < 2:
        return []
    if len(ids) % 2 == 1:
        ids.append("__BYE__")
    n = len(ids)
    rounds = n - 1
    half = n // 2
    rotating = ids[1:]
    pairs: list[tuple[str, str]] = []
    for _ in range(rounds):
        left = [ids[0]] + rotating[: half - 1]
        right = list(reversed(rotating[half - 1 :]))
        for a, b in zip(left, right):
            if a == "__BYE__" or b == "__BYE__":
                continue
            if a == b:
                raise ValueError(f"Self-match generated for team {a}")
            pairs.append((a, b))
        rotating = rotating[1:] + rotating[:1]
    return pairs


def _ordinal(n: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}.get(n, f"{n}th")


def _bracket_seed_positions(size: int) -> list[int]:
    """
    Seed numbers 1..size in first-round left-to-right bracket order.
    Example size=8 → [1, 8, 4, 5, 2, 7, 3, 6] so top seeds meet late and byes land on top seeds.
    """
    if size < 1:
        return []
    if size == 1:
        return [1]
    half = _bracket_seed_positions(size // 2)
    out: list[int] = []
    for s in half:
        out.append(s)
        out.append(size + 1 - s)
    return out


def _advancing_placeholders(group_names: list[str], teams_advance: int) -> list[str]:
    """Ordered advancing labels (strongest / 1sts first)."""
    slots: list[str] = []
    if teams_advance == 2:
        for g in group_names:
            slots.append(f"1st Group {g}")
        for g in group_names:
            slots.append(f"2nd Group {g}")
        return slots
    for rank in range(1, teams_advance + 1):
        names = group_names if rank % 2 == 1 else list(reversed(group_names))
        for g in names:
            slots.append(f"{_ordinal(rank)} Group {g}")
    return slots


def _knockout_first_round_placeholders(
    group_names: list[str],
    teams_advance: int,
    first_round_count: int,
) -> list[tuple[str, str]]:
    """
    Build first-round KO placeholders.

    When advancing is an exact power of two and advance==2, keep classic 1A vs 2B pairing.
    Otherwise pad with single-side BYEs via standard bracket seeding - never BYE vs BYE.
    """
    group_count = len(group_names)
    bracket_size = first_round_count * 2
    if group_count < 1 or teams_advance < 1 or first_round_count < 1:
        raise ValueError("Invalid knockout placeholder inputs")

    advancing = group_count * teams_advance

    # Exact bracket, classic cross-group pairing (no byes)
    if teams_advance == 2 and advancing == bracket_size:
        pairs: list[tuple[str, str]] = []
        for i in range(group_count):
            g1 = group_names[i]
            g2 = group_names[(i + 1) % group_count] if group_count > 1 else g1
            pairs.append((f"1st Group {g1}", f"2nd Group {g2}"))
        return pairs

    slots = _advancing_placeholders(group_names, teams_advance)
    if len(slots) > bracket_size:
        raise ValueError(
            f"Advancing teams ({len(slots)}) exceed bracket size ({bracket_size})"
        )
    while len(slots) < bracket_size:
        slots.append("BYE")

    order = _bracket_seed_positions(bracket_size)
    placed = [slots[seed - 1] for seed in order]

    pairs = []
    for i in range(0, bracket_size, 2):
        a, b = placed[i], placed[i + 1]
        if a == "BYE" and b == "BYE":
            raise ValueError(
                "BYE vs BYE generated - advancing field too small for this bracket"
            )
        pairs.append((a, b))
    return pairs


def _schedule_on_courts(
    matches: list[GeneratedMatch],
    courts: int,
    start: datetime,
    duration_minutes: int,
    buffer_minutes: int = 0,
) -> None:
    """Assign courts + times; avoid double-booking the same team when IDs are known."""
    if courts < 1:
        raise ValueError("courts must be >= 1")
    slot = timedelta(minutes=duration_minutes + buffer_minutes)
    court_free_at = [start for _ in range(courts)]
    team_free_at: dict[str, datetime] = {}

    for m in matches:
        earliest = start
        for tid in (m.team_a_id, m.team_b_id):
            if tid:
                earliest = max(earliest, team_free_at.get(tid, start))

        best_court = 0
        best_time = max(court_free_at[0], earliest)
        for i in range(1, courts):
            candidate = max(court_free_at[i], earliest)
            if candidate < best_time:
                best_time = candidate
                best_court = i

        m.court_number = best_court + 1
        m.scheduled_start = best_time
        court_free_at[best_court] = best_time + slot
        for tid in (m.team_a_id, m.team_b_id):
            if tid:
                team_free_at[tid] = best_time + slot


def _schedule_knockout_rounds(
    matches: list[GeneratedMatch],
    courts: int,
    start: datetime,
    duration_minutes: int,
    buffer_minutes: int = 0,
) -> None:
    """Schedule KO round-by-round so later rounds cannot start before earlier ones finish."""
    if not matches:
        return
    rounds: list[list[GeneratedMatch]] = []
    current: str | None = None
    bucket: list[GeneratedMatch] = []
    for m in matches:
        if m.round != current:
            if bucket:
                rounds.append(bucket)
            bucket = [m]
            current = m.round
        else:
            bucket.append(m)
    if bucket:
        rounds.append(bucket)

    cursor = start
    slot = timedelta(minutes=duration_minutes + buffer_minutes)
    for round_matches in rounds:
        _schedule_on_courts(round_matches, courts, cursor, duration_minutes, buffer_minutes)
        ends = [(m.scheduled_start or cursor) + slot for m in round_matches]
        cursor = max(ends) if ends else cursor + slot


class GroupKnockoutGenerator:
    """Group stage → knockout. Configurable team counts (not hard-coded to 48)."""

    def generate(self, config: GeneratorConfig) -> GeneratedTournament:
        teams = [t for t in config.teams if t.id]
        n = len(teams)
        if n < 2:
            raise ValueError("Need at least 2 teams to generate a tournament")
        if config.courts < 1:
            raise ValueError("Need at least 1 court")
        if config.group_size < 2:
            raise ValueError("group_size must be >= 2")
        if config.teams_advance_per_group < 1:
            raise ValueError("teams_advance_per_group must be >= 1")
        if config.teams_advance_per_group > config.group_size:
            raise ValueError(
                f"teams_advance_per_group ({config.teams_advance_per_group}) "
                f"cannot exceed group_size ({config.group_size})"
            )
        if config.match_duration_minutes < 1:
            raise ValueError("match_duration_minutes must be >= 1")

        planned_sizes = _balanced_group_sizes(n, config.group_size)
        group_count = len(planned_sizes)
        seeded_groups = _seed_into_groups(teams, group_count, config.group_size)
        seeded_groups = [g for g in seeded_groups if g]
        group_count = len(seeded_groups)
        if group_count < 1:
            raise ValueError("Could not form groups from the paid entries")

        min_group_size = min(len(g) for g in seeded_groups)
        requested_advance = config.teams_advance_per_group
        effective_advance = min(requested_advance, min_group_size)
        advance_adjusted = effective_advance != requested_advance
        if effective_advance < 1:
            raise ValueError(
                f"Cannot advance teams: smallest group has only {min_group_size} "
                f"{'entry' if min_group_size == 1 else 'entries'}."
            )

        result = GeneratedTournament(
            group_sizes=[len(g) for g in seeded_groups],
            advance_per_group=effective_advance,
            advance_adjusted=advance_adjusted,
        )
        group_matches: list[GeneratedMatch] = []
        sort = 0

        for gi, group_teams in enumerate(seeded_groups):
            name = _group_letter(gi)
            result.groups.append(
                GeneratedGroup(
                    name=name,
                    sort_order=gi,
                    team_ids=[t.id for t in group_teams],
                )
            )
            pairs = _round_robin_pairs([t.id for t in group_teams])
            # Sanity: unique unordered pairs, no self
            seen: set[frozenset[str]] = set()
            for a, b in pairs:
                if a == b:
                    raise ValueError(f"Self-match in group {name}: {a}")
                key = frozenset({a, b})
                if key in seen:
                    raise ValueError(f"Duplicate fixture in group {name}: {a} vs {b}")
                seen.add(key)
                group_matches.append(
                    GeneratedMatch(
                        round=f"GROUP_{name}",
                        stage="GROUP",
                        group_name=name,
                        team_a_id=a,
                        team_b_id=b,
                        team_a_placeholder=None,
                        team_b_placeholder=None,
                        court_number=None,
                        scheduled_start=None,
                        sort_order=sort,
                    )
                )
                sort += 1

        _schedule_on_courts(
            group_matches,
            config.courts,
            config.start_time,
            config.match_duration_minutes,
            config.court_buffer_minutes,
        )
        result.matches.extend(group_matches)

        last_group_end = config.start_time
        if group_matches:
            last = max((m.scheduled_start or config.start_time) for m in group_matches)
            last_group_end = last + timedelta(minutes=config.match_duration_minutes + 10)

        # Championship + Plate dual brackets
        if config.enable_plate:
            champ = config.championship_size
            plate = config.plate_size
            if not _is_power_of_two(champ) or not _is_power_of_two(plate):
                raise ValueError("Championship and Plate sizes must be powers of 2")
            if champ + plate > n:
                raise ValueError(
                    f"Championship ({champ}) + Plate ({plate}) need {champ + plate} teams, "
                    f"but only {n} are entered"
                )
            result.enable_plate = True
            result.championship_size = champ
            result.plate_size = plate
            result.bye_slots = 0
            # Advance enough per group so standings can fill both brackets later
            needed = champ + plate
            result.advance_per_group = max(
                effective_advance,
                min(config.group_size, math.ceil(needed / max(1, group_count))),
            )

            champ_matches, champ_rounds = _build_seeded_bracket(
                stage="KNOCKOUT",
                bracket_size=champ,
                placeholder_prefix="Championship seed",
                sort_start=sort,
            )
            sort += len(champ_matches)
            plate_matches, plate_rounds = _build_seeded_bracket(
                stage="PLATE",
                bracket_size=plate,
                placeholder_prefix="Plate seed",
                sort_start=sort,
            )
            result.knockout_rounds = champ_rounds
            result.plate_rounds = plate_rounds

            _schedule_knockout_rounds(
                champ_matches + plate_matches,
                config.courts,
                last_group_end,
                config.match_duration_minutes,
                config.court_buffer_minutes,
            )
            result.matches.extend(champ_matches)
            result.matches.extend(plate_matches)
            return result

        # Single knockout bracket (classic)
        advancing = group_count * effective_advance
        if advancing < 2:
            return result

        bracket_size = _next_power_of_two(advancing)
        if bracket_size < advancing:
            raise ValueError("Internal error: bracket_size < advancing teams")
        result.bye_slots = bracket_size - advancing

        round_names = _knockout_round_names(bracket_size)
        result.knockout_rounds = round_names

        ko_matches: list[GeneratedMatch] = []
        first_round_count = bracket_size // 2

        group_names = [_group_letter(i) for i in range(group_count)]
        placeholders = _knockout_first_round_placeholders(
            group_names, effective_advance, first_round_count
        )

        for i in range(first_round_count):
            pa, pb = placeholders[i]
            ko_matches.append(
                GeneratedMatch(
                    round=round_names[0],
                    stage="KNOCKOUT",
                    group_name=None,
                    team_a_id=None,
                    team_b_id=None,
                    team_a_placeholder=pa,
                    team_b_placeholder=pb,
                    court_number=None,
                    scheduled_start=None,
                    sort_order=sort,
                )
            )
            sort += 1

        prev_round_start = 0
        prev_round_count = first_round_count
        for rn in round_names[1:]:
            this_count = prev_round_count // 2
            this_start = len(ko_matches)
            for i in range(this_count):
                ko_matches.append(
                    GeneratedMatch(
                        round=rn,
                        stage="KNOCKOUT",
                        group_name=None,
                        team_a_id=None,
                        team_b_id=None,
                        team_a_placeholder=f"Winner match {prev_round_start + i * 2 + 1}",
                        team_b_placeholder=f"Winner match {prev_round_start + i * 2 + 2}",
                        court_number=None,
                        scheduled_start=None,
                        sort_order=sort,
                    )
                )
                feeder_a = prev_round_start + i * 2
                feeder_b = prev_round_start + i * 2 + 1
                ko_matches[feeder_a].feeds_into_index = this_start + i
                ko_matches[feeder_a].feeds_into_slot = "A"
                ko_matches[feeder_b].feeds_into_index = this_start + i
                ko_matches[feeder_b].feeds_into_slot = "B"
                sort += 1
            prev_round_start = this_start
            prev_round_count = this_count

        _schedule_knockout_rounds(
            ko_matches,
            config.courts,
            last_group_end,
            config.match_duration_minutes,
            config.court_buffer_minutes,
        )
        result.matches.extend(ko_matches)
        return result


class RoundRobinGenerator:
    """Single round-robin across all teams (no groups/knockout)."""

    def generate(self, config: GeneratorConfig) -> GeneratedTournament:
        teams = list(config.teams)
        if len(teams) < 2:
            raise ValueError("Need at least 2 teams")
        result = GeneratedTournament(
            group_sizes=[len(teams)],
            advance_per_group=0,
            advance_adjusted=False,
            bye_slots=0,
        )
        result.groups.append(GeneratedGroup(name="A", sort_order=0, team_ids=[t.id for t in teams]))
        pairs = _round_robin_pairs([t.id for t in teams])
        matches: list[GeneratedMatch] = []
        for i, (a, b) in enumerate(pairs):
            if a == b:
                raise ValueError(f"Self-match: {a}")
            matches.append(
                GeneratedMatch(
                    round="GROUP_A",
                    stage="GROUP",
                    group_name="A",
                    team_a_id=a,
                    team_b_id=b,
                    team_a_placeholder=None,
                    team_b_placeholder=None,
                    court_number=None,
                    scheduled_start=None,
                    sort_order=i,
                )
            )
        _schedule_on_courts(
            matches, config.courts, config.start_time, config.match_duration_minutes, config.court_buffer_minutes
        )
        result.matches = matches
        return result


GENERATORS: dict[str, FormatGenerator] = {
    "GROUP_KNOCKOUT": GroupKnockoutGenerator(),
    "ROUND_ROBIN": RoundRobinGenerator(),
}


def generate_tournament(config: GeneratorConfig) -> GeneratedTournament:
    fmt = config.format or "GROUP_KNOCKOUT"
    gen = GENERATORS.get(fmt)
    if gen is None:
        raise ValueError(f"Unsupported format: {fmt}. Supported: {', '.join(GENERATORS)}")
    result = gen.generate(config)
    validate_generated(result, expected_team_ids={t.id for t in config.teams})
    return result


def validate_generated(result: GeneratedTournament, expected_team_ids: set[str]) -> None:
    """Hard invariants - fail loudly rather than produce broken brackets."""
    assigned = set()
    for g in result.groups:
        for tid in g.team_ids:
            if tid in assigned:
                raise ValueError(f"Team {tid} assigned to multiple groups")
            assigned.add(tid)
    if assigned != expected_team_ids:
        missing = expected_team_ids - assigned
        extra = assigned - expected_team_ids
        raise ValueError(f"Group assignment mismatch. Missing={missing} Extra={extra}")

    for m in result.matches:
        if m.team_a_id and m.team_b_id and m.team_a_id == m.team_b_id:
            raise ValueError(f"Self-match in {m.round}: {m.team_a_id}")
        if m.stage == "GROUP":
            if not m.team_a_id or not m.team_b_id:
                raise ValueError(f"Group match missing teams: {m.round}")
            if m.team_a_id not in expected_team_ids or m.team_b_id not in expected_team_ids:
                raise ValueError("Group match references unknown team")
        if m.stage == "KNOCKOUT":
            a_bye = (m.team_a_placeholder or "").upper() == "BYE" and not m.team_a_id
            b_bye = (m.team_b_placeholder or "").upper() == "BYE" and not m.team_b_id
            if a_bye and b_bye:
                raise ValueError(f"BYE vs BYE in {m.round}")

    # Count team appearances in group stage - each pair once
    from collections import Counter

    appearances: Counter[str] = Counter()
    for m in result.matches:
        if m.stage == "GROUP":
            appearances[m.team_a_id or ""] += 1
            appearances[m.team_b_id or ""] += 1
    for tid in expected_team_ids:
        group = next(g for g in result.groups if tid in g.team_ids)
        expected_games = len(group.team_ids) - 1
        if appearances[tid] != expected_games:
            raise ValueError(
                f"Team {tid} has {appearances[tid]} group matches, expected {expected_games}"
            )
