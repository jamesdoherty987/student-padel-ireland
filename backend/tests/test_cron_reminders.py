from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def test_cron_requires_secret():
    get_settings.cache_clear()
    client = TestClient(app)
    with patch("app.api.cron.get_settings") as gs:
        gs.return_value.cron_secret = ""
        r = client.post("/api/cron/tournament-reminders")
        assert r.status_code == 503

    with patch("app.api.cron.get_settings") as gs:
        gs.return_value.cron_secret = "super-secret"
        r = client.post("/api/cron/tournament-reminders")
        assert r.status_code == 401

    with patch("app.api.cron.get_settings") as gs, patch(
        "app.api.cron.run_day_before_reminders",
        return_value={"ok": True, "totals": {"sent": 0}},
    ) as run:
        gs.return_value.cron_secret = "super-secret"
        r = client.post(
            "/api/cron/tournament-reminders",
            headers={"Authorization": "Bearer super-secret"},
        )
        assert r.status_code == 200
        assert r.json()["ok"] is True
        run.assert_called_once()
