from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, tournaments
from app.core.config import get_settings
from app.db.session import init_db
from app.db.seed import seed_if_empty

settings = get_settings()

app = FastAPI(
    title="Student Padel Ireland API",
    version="0.1.0",
    description="Tournament platform for Irish student padel",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(tournaments.router, prefix="/api")


@app.on_event("startup")
def on_startup():
    init_db()
    seed_if_empty()


@app.get("/health")
def health():
    return {"status": "ok", "service": "student-padel-ireland"}


@app.get("/api/config/public")
def public_config():
    return {
        "stripe_publishable_key": settings.stripe_publishable_key or None,
        "frontend_url": settings.frontend_url,
        "demo_payments": not bool(settings.stripe_secret_key),
    }
