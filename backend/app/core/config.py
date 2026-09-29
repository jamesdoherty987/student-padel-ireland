from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Accept plain postgres:// / postgresql:// from Supabase and use the psycopg2 driver."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://") :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    secret_key: str = "dev-secret-change-me"
    environment: str = "development"
    frontend_url: str = "http://localhost:5173"
    # Public URL of this API (used for absolute profile media links in production)
    backend_url: str = "http://localhost:8000"

    database_url: str = "sqlite:///./padel.db"

    # When unset: seed demo users/tournament in development only (never in production).
    # Set SEED_DEMO_DATA=true to force demo seed on a prod DB (not recommended).
    seed_demo_data: bool | None = None

    # Optional first admin when demo seed is off (production bootstrap)
    admin_email: str = ""
    admin_password: str = ""
    admin_name: str = "Platform Admin"

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_publishable_key: str = ""

    resend_api_key: str = ""
    email_from: str = "Student Padel Ireland <noreply@studentpadelireland.ie>"

    # Comma-separated extra CORS origins (Capacitor, preview deploys, custom domains)
    cors_extra_origins: str = ""

    access_token_expire_minutes: int = 60 * 24 * 30  # 30 days - stay signed in on this browser

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_db_url(cls, v: object) -> object:
        if isinstance(v, str) and v.strip():
            return normalize_database_url(v.strip())
        return v

    @field_validator("frontend_url", "backend_url", mode="before")
    @classmethod
    def _strip_trailing_slash(cls, v: object) -> object:
        if isinstance(v, str):
            return v.rstrip("/")
        return v

    def is_sqlite_db(self) -> bool:
        return self.database_url.startswith("sqlite")

    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    def should_seed_demo(self) -> bool:
        if self.seed_demo_data is not None:
            return self.seed_demo_data
        return not self.is_production()

    def cors_origins(self) -> list[str]:
        origins = {
            self.frontend_url,
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
            # Capacitor WebView (see capacitor.config.ts server.hostname)
            "https://app.studentpadelireland.ie",
            "capacitor://localhost",
            "ionic://localhost",
            "http://localhost",
            "https://localhost",
        }
        for part in self.cors_extra_origins.split(","):
            cleaned = part.strip().rstrip("/")
            if cleaned:
                origins.add(cleaned)
        return sorted(origins)


@lru_cache
def get_settings() -> Settings:
    return Settings()
