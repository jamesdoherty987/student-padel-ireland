from enum import StrEnum


class Role(StrEnum):
    PLAYER = "PLAYER"
    ORGANISER = "ORGANISER"
    ADMIN = "ADMIN"


ROLE_RANK = {
    Role.PLAYER: 1,
    Role.ORGANISER: 2,
    Role.ADMIN: 3,
}


def has_min_role(user_role: str, required: Role) -> bool:
    try:
        return ROLE_RANK[Role(user_role)] >= ROLE_RANK[required]
    except (ValueError, KeyError):
        return False
