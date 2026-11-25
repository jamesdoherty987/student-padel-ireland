from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app


def test_app_version_defaults():
    s = Settings()
    assert s.app_version_ios_latest == "1.0.8"
    assert s.app_version_android_latest == "1.0.7"
    assert "apps.apple.com" in s.app_store_url
    assert "ie.studentpadel.app" in s.play_store_url


def test_app_version_endpoint_public():
    client = TestClient(app)
    res = client.get("/api/app-version")
    assert res.status_code == 200
    body = res.json()
    assert body["ios"]["latest"]
    assert body["android"]["latest"]
    assert body["ios"]["store_url"].startswith("https://")
    assert body["android"]["store_url"].startswith("https://")
