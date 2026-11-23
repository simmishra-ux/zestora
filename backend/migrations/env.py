"""Alembic environment: tells Alembic where our models and database are."""

from alembic import context
from sqlalchemy import create_engine, pool

from app import models  # noqa: F401  (importing registers every table on Base.metadata)
from app.database import DATABASE_URL, Base

config = context.config
target_metadata = Base.metadata
url = config.get_main_option("sqlalchemy.url") or DATABASE_URL


def run_migrations_online() -> None:
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite can't ALTER most things, so Alembic rebuilds the table ("batch mode")
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
