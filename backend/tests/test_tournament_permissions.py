"""Permission helpers for tournament organisers / co-admins."""

from __future__ import annotations

import uuid
from datetime import date, time

from app.api.deps import user_can_manage_tournament, user_owns_tournament
from app.core.roles import Role
from app.models import Tournament, TournamentAdmin, User, UserRole


def _user(role: str = UserRole.PLAYER.value) -> User:
    return User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4().hex[:8]}@test.ie",
        password_hash="x",
        full_name="Test User",
        role=role,
    )


def _tournament(owner: User) -> Tournament:
    return Tournament(
        id=uuid.uuid4(),
        name="Test Open",
        slug=f"test-{uuid.uuid4().hex[:8]}",
        location="Dublin",
        venue="Test Venue",
        event_date=date(2026, 6, 1),
        start_time=time(10, 0),
        organiser_id=owner.id,
    )


class _FakeQuery:
    def __init__(self, row):
        self._row = row

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._row


class _FakeDb:
    def __init__(self, admin_row=None):
        self._admin_row = admin_row

    def query(self, *args, **kwargs):
        return _FakeQuery(self._admin_row)


def test_owner_can_manage_and_owns():
    owner = _user()
    t = _tournament(owner)
    db = _FakeDb()
    assert user_owns_tournament(owner, t) is True
    assert user_can_manage_tournament(owner, t, db) is True


def test_platform_admin_owns_any_tournament():
    owner = _user()
    admin = _user(Role.ADMIN.value)
    t = _tournament(owner)
    db = _FakeDb()
    assert user_owns_tournament(admin, t) is True
    assert user_can_manage_tournament(admin, t, db) is True


def test_co_admin_can_manage_but_does_not_own():
    owner = _user()
    co = _user()
    t = _tournament(owner)
    row = TournamentAdmin(id=uuid.uuid4(), tournament_id=t.id, user_id=co.id, role="MANAGER")
    db = _FakeDb(admin_row=(row.id,))
    assert user_owns_tournament(co, t) is False
    assert user_can_manage_tournament(co, t, db) is True


def test_stranger_cannot_manage():
    owner = _user()
    stranger = _user()
    t = _tournament(owner)
    db = _FakeDb(admin_row=None)
    assert user_owns_tournament(stranger, t) is False
    assert user_can_manage_tournament(stranger, t, db) is False
