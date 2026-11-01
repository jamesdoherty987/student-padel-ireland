"""Sole admin sync from ADMIN_EMAIL / ADMIN_PASSWORD."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.db.seed import ensure_single_admin
from app.models import UserRole


def test_ensure_single_admin_skips_without_creds():
    db = MagicMock()
    with patch("app.db.seed._admin_credentials", return_value=None):
        db.query.return_value.count.return_value = 1
        ensure_single_admin(db)
    db.commit.assert_not_called()


def test_ensure_single_admin_creates_when_missing():
    db = MagicMock()
    # No user with that email
    email_query = MagicMock()
    email_query.filter.return_value.first.return_value = None
    # No existing admins to reclaim
    admins_query = MagicMock()
    admins_query.filter.return_value.all.return_value = []
    # Ranking check
    ranking_query = MagicMock()
    ranking_query.filter.return_value.first.return_value = None
    # Demote others query
    others_query = MagicMock()
    others_query.filter.return_value.all.return_value = []

    def query_side_effect(model):
        name = getattr(model, "__name__", str(model))
        if name == "User":
            # First call: by email; later: existing admins / others
            if not hasattr(query_side_effect, "n"):
                query_side_effect.n = 0
            query_side_effect.n += 1
            if query_side_effect.n == 1:
                return email_query
            if query_side_effect.n == 2:
                return admins_query
            return others_query
        return ranking_query

    db.query.side_effect = query_side_effect

    with patch(
        "app.db.seed._admin_credentials",
        return_value=("admin@example.com", "password12345", "Platform Admin"),
    ), patch("app.db.seed.hash_password", return_value="hashed"), patch(
        "app.db.seed.verify_password", return_value=True
    ), patch("app.db.seed.get_settings") as gs:
        gs.return_value = SimpleNamespace(admin_name="Platform Admin")
        ensure_single_admin(db)

    assert db.add.called
    db.commit.assert_called()


def test_ensure_single_admin_demotes_extras():
    primary = SimpleNamespace(
        id="a1",
        email="admin@example.com",
        full_name="Platform Admin",
        role=UserRole.ADMIN.value,
        is_active=True,
        is_suspended=False,
        must_set_password=False,
        password_hash="hashed",
    )
    extra = SimpleNamespace(
        id="a2",
        email="other@example.com",
        role=UserRole.ADMIN.value,
    )

    email_query = MagicMock()
    email_query.filter.return_value.first.return_value = primary
    others_query = MagicMock()
    others_query.filter.return_value.all.return_value = [extra]

    def query_side_effect(model):
        name = getattr(model, "__name__", str(model))
        if name == "User":
            if not hasattr(query_side_effect, "n"):
                query_side_effect.n = 0
            query_side_effect.n += 1
            return email_query if query_side_effect.n == 1 else others_query
        return MagicMock()

    db = MagicMock()
    db.query.side_effect = query_side_effect

    with patch(
        "app.db.seed._admin_credentials",
        return_value=("admin@example.com", "password12345", "Platform Admin"),
    ), patch("app.db.seed.verify_password", return_value=True), patch(
        "app.db.seed.get_settings"
    ) as gs:
        gs.return_value = SimpleNamespace(admin_name="")
        ensure_single_admin(db)

    assert extra.role == UserRole.PLAYER.value
    db.commit.assert_called()
