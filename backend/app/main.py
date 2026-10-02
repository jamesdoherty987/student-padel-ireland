from pathlib import Path
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import auth, community, profiles, tournaments
from app.core.config import get_settings
from app.db.session import init_db
from app.db.seed import seed_if_empty

settings = get_settings()

app = FastAPI(
    title="Student Padel Ireland API",
    version="0.1.0",
    description="Tournament platform for Irish student padel",
)

_cors_origins = settings.cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
(UPLOAD_DIR / "profiles").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(auth.router, prefix="/api")
app.include_router(community.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(tournaments.router, prefix="/api")


def _warn_production_config() -> None:
    if not settings.is_production():
        return
    if settings.secret_key in {"", "dev-secret-change-me", "change-me-to-a-long-random-string"}:
        print("WARNING: SECRET_KEY is still a default value - set a long random secret in production.")
    if settings.is_sqlite_db():
        print("WARNING: DATABASE_URL is SQLite - use Supabase Postgres for production.")
    if not settings.stripe_secret_key:
        print("INFO: Stripe not configured - tournament registration will use demo (free) payments.")
    if settings.should_seed_demo():
        print("WARNING: SEED_DEMO_DATA is enabled in production - demo passwords will be created.")


@app.on_event("startup")
def on_startup():
    _warn_production_config()
    init_db()
    seed_if_empty()


@app.get("/health")
def health():
    # RENDER_GIT_COMMIT is set automatically on Render deploys
    sha = (os.environ.get("RENDER_GIT_COMMIT") or os.environ.get("GIT_COMMIT") or "").strip()
    return {
        "status": "ok",
        "service": "student-padel-ireland",
        "git_sha": sha[:12] if sha else "unknown",
    }


@app.get("/api/config/public")
def public_config():
    return {
        "stripe_publishable_key": settings.stripe_publishable_key or None,
        "frontend_url": settings.frontend_url,
        "demo_payments": not bool(settings.stripe_secret_key),
        "environment": settings.environment,
    }
