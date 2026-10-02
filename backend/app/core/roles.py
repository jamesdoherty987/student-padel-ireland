from enum import StrEnum


class Role(StrEnum):
    PLAYER = "PLAYER"
    ADMIN = "ADMIN"
    # Legacy — migrated to PLAYER on startup; kept so old tokens/rows don't explode
    ORGANISER = "ORGANISER"


ROLE_RANK = {
    Role.PLAYER: 1,
    Role.ORGANISER: 1,  # treated as player
    Role.ADMIN: 2,
}


def has_min_role(user_role: str, required: Role) -> bool:
    try:
        return ROLE_RANK[Role(user_role)] >= ROLE_RANK[required]
    except (ValueError, KeyError):
        return False
