from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models import Base

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.is_sqlite_db() else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _sqlite_add_column_if_missing(table: str, column: str, col_type: str) -> None:
    if not settings.is_sqlite_db():
        return
    with engine.begin() as conn:
        cols = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
        if not cols:
            return
        if column not in cols:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))


def _sqlite_ensure_ranking_history_nullable_tournament() -> None:
    """ranking_history.tournament_id must be nullable for community matches."""
    if not settings.is_sqlite_db():
        return
    with engine.begin() as conn:
        cols = list(conn.execute(text("PRAGMA table_info(ranking_history)")))
        if not cols:
            return
        by_name = {row[1]: row for row in cols}
        tourney = by_name.get("tournament_id")
        if not tourney:
            return
        notnull = tourney[3]
        if not notnull:
            return
        # Rebuild table with nullable tournament_id
        conn.execute(text("ALTER TABLE ranking_history RENAME TO ranking_history_old"))
        conn.execute(
            text(
                """
                CREATE TABLE ranking_history (
                    id CHAR(36) NOT NULL PRIMARY KEY,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    user_id CHAR(36) NOT NULL,
                    tournament_id CHAR(36),
                    community_match_id CHAR(36),
                    points_delta INTEGER NOT NULL,
                    points_after INTEGER NOT NULL,
                    placement VARCHAR(40),
                    FOREIGN KEY(user_id) REFERENCES users (id),
                    FOREIGN KEY(tournament_id) REFERENCES tournaments (id)
                )
                """
            )
        )
        old_cols = {row[1] for row in cols}
        has_community = "community_match_id" in old_cols
        if has_community:
            conn.execute(
                text(
                    """
                    INSERT INTO ranking_history
                    (id, created_at, updated_at, user_id, tournament_id, community_match_id,
                     points_delta, points_after, placement)
                    SELECT id, created_at, updated_at, user_id, tournament_id, community_match_id,
                           points_delta, points_after, placement
                    FROM ranking_history_old
                    """
                )
            )
        else:
            conn.execute(
                text(
                    """
                    INSERT INTO ranking_history
                    (id, created_at, updated_at, user_id, tournament_id, community_match_id,
                     points_delta, points_after, placement)
                    SELECT id, created_at, updated_at, user_id, tournament_id, NULL,
                           points_delta, points_after, placement
                    FROM ranking_history_old
                    """
                )
            )
        conn.execute(text("DROP TABLE ranking_history_old"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _sqlite_add_column_if_missing("matches", "ratings_applied", "BOOLEAN DEFAULT 0")
    _sqlite_add_column_if_missing("ranking_history", "community_match_id", "CHAR(36)")
    _sqlite_add_column_if_missing("community_matches", "confirmed_by_id", "CHAR(36)")
    _sqlite_add_column_if_missing("community_matches", "court_number", "INTEGER")
    _sqlite_add_column_if_missing("community_competitions", "number_of_courts", "INTEGER DEFAULT 2")
    _sqlite_add_column_if_missing("users", "bio", "VARCHAR(500)")
    _sqlite_add_column_if_missing("users", "avatar_url", "VARCHAR(500)")
    _sqlite_add_column_if_missing("users", "must_set_password", "BOOLEAN DEFAULT 0")
    _sqlite_ensure_ranking_history_nullable_tournament()
    # Migrate legacy zero/low “Ireland points” onto Elo baseline (Elo starts ~1500)
    with engine.begin() as conn:
        try:
            conn.execute(
                text(
                    "UPDATE rankings SET points = 1500 "
                    "WHERE points < 800"
                )
            )
        except Exception:
            pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
