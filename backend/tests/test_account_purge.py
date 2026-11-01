"""Admin hard-delete account helper."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services.accounts import purge_user


def test_purge_user_rejects_self_reassign():
    db = MagicMock()
    uid = uuid4()
    user = SimpleNamespace(id=uid)
    with pytest.raises(ValueError):
        purge_user(db, user, reassign_to=user)


def test_purge_user_deletes_row():
    db = MagicMock()
    target = SimpleNamespace(id=uuid4())
    admin = SimpleNamespace(id=uuid4())

    with patch("app.services.accounts._purge_profile_files"):
        purge_user(db, target, reassign_to=admin)

    assert db.delete.called
    assert db.delete.call_args.args[0] is target
    # Ownership reassigned
    assert db.query.called
