from app.core.config import Settings, normalize_database_url


def test_normalize_postgres_urls():
    assert normalize_database_url("postgresql://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"
    assert normalize_database_url("postgres://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"
    assert normalize_database_url("sqlite:///./x.db") == "sqlite:///./x.db"
    assert normalize_database_url("postgresql+psycopg2://u:p@h/db") == "postgresql+psycopg2://u:p@h/db"


def test_seed_demo_defaults():
    assert Settings(environment="production", seed_demo_data=None).should_seed_demo() is False
    assert Settings(environment="development", seed_demo_data=None).should_seed_demo() is True
    assert Settings(environment="production", seed_demo_data=True).should_seed_demo() is True


def test_strip_trailing_slash_on_urls():
    s = Settings(frontend_url="https://app.example.com/", backend_url="https://api.example.com/")
    assert s.frontend_url == "https://app.example.com"
    assert s.backend_url == "https://api.example.com"


def test_cors_includes_capacitor_origin():
    origins = Settings().cors_origins()
    assert "https://app.studentpadelireland.ie" in origins
    assert "capacitor://localhost" in origins
    assert "https://studentpadelireland.ie" in origins
    assert "https://www.studentpadelireland.ie" in origins
    assert "https://studentpadel.ie" in origins
    assert "https://www.studentpadel.ie" in origins
