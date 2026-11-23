"""Runs database migrations at startup (replaces `Base.metadata.create_all`).

Why migrations? create_all only creates MISSING TABLES; it never adds a column to an existing table.
A migration is a small versioned script ("add these columns") that upgrades any database, old or new.
Daily commands (run inside backend/):
    .venv/bin/alembic revision --autogenerate -m "describe the change"   # after editing models.py
    .venv/bin/alembic upgrade head                                       # apply (the server also does this at startup)
    .venv/bin/alembic downgrade -1                                       # undo the last migration
"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from .database import DATABASE_URL

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "0001"  # the schema as it was before Alembic was introduced


def make_config(url: str) -> Config:
    cfg = Config()  # no .ini needed when driving Alembic from Python
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


def run_migrations(url: str = DATABASE_URL) -> None:
    cfg = make_config(url)
    engine = create_engine(url)
    tables = set(inspect(engine).get_table_names())
    engine.dispose()
    if "users" in tables and "alembic_version" not in tables:
        # A database created BEFORE Alembic existed already has the baseline tables.
        # "Stamping" records "you are at 0001" without re-creating them; then upgrade applies what's newer.
        command.stamp(cfg, BASELINE)
    command.upgrade(cfg, "head")
