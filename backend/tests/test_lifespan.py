"""Tests fuer die Startup-Migration (_add_missing_columns) in app.main."""
import pytest
import pytest_asyncio
from sqlalchemy import inspect as sa_inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.main import _add_missing_columns
from app.models.base import Base


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    yield eng
    await eng.dispose()


# ---------------------------------------------------------------------------
# Helper: create "old" tables that lack the newer columns
# ---------------------------------------------------------------------------

_OLD_CHANNELS_DDL = """\
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL DEFAULT 'group',
    team_id TEXT,
    sqlite_db_path TEXT NOT NULL,
    invite_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""

_OLD_USERS_DDL = """\
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_path TEXT,
    status TEXT NOT NULL DEFAULT 'offline',
    status_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""


_OLD_CALENDAR_INTEGRATIONS_DDL = """\
CREATE TABLE calendar_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'internal',
    webdav_url TEXT,
    webdav_username TEXT,
    webdav_password TEXT,
    google_client_id TEXT,
    google_client_secret TEXT,
    google_refresh_token TEXT,
    google_calendar_id TEXT,
    outlook_server_url TEXT,
    outlook_username TEXT,
    outlook_password TEXT,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""


def _get_column_names(connection, table):
    inspector = sa_inspect(connection)
    return {c["name"] for c in inspector.get_columns(table)}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestAddMissingColumns:
    """_add_missing_columns adds columns to pre-existing tables."""

    @pytest.mark.asyncio
    async def test_adds_scheduled_at_to_channels(self, engine):
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(
                "INSERT INTO channels (id, name, sqlite_db_path, invite_token)"
                " VALUES ('c1', 'general', '/tmp/c1.db', 'tok1')"
            ))

            await conn.run_sync(_add_missing_columns)

            cols = await conn.run_sync(lambda c: _get_column_names(c, "channels"))
            assert "scheduled_at" in cols

            row = (await conn.execute(text(
                "SELECT scheduled_at FROM channels WHERE id = 'c1'"
            ))).fetchone()
            assert row[0] is None  # nullable, no default

    @pytest.mark.asyncio
    async def test_adds_is_hidden_to_channels(self, engine):
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(
                "INSERT INTO channels (id, name, sqlite_db_path, invite_token)"
                " VALUES ('c1', 'general', '/tmp/c1.db', 'tok1')"
            ))

            await conn.run_sync(_add_missing_columns)

            cols = await conn.run_sync(lambda c: _get_column_names(c, "channels"))
            assert "is_hidden" in cols

            row = (await conn.execute(text(
                "SELECT is_hidden FROM channels WHERE id = 'c1'"
            ))).fetchone()
            assert row[0] is not None
            assert not row[0]  # default is false / 0

    @pytest.mark.asyncio
    async def test_adds_is_admin_to_users(self, engine):
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(
                "INSERT INTO users (id, username, email, password_hash, display_name)"
                " VALUES ('u1', 'alice', 'a@b.c', 'hash', 'Alice')"
            ))

            await conn.run_sync(_add_missing_columns)

            cols = await conn.run_sync(lambda c: _get_column_names(c, "users"))
            assert "is_admin" in cols

            row = (await conn.execute(text(
                "SELECT is_admin FROM users WHERE id = 'u1'"
            ))).fetchone()
            assert row[0] is not None
            assert not row[0]

    @pytest.mark.asyncio
    async def test_adds_auth_source_to_users(self, engine):
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(
                "INSERT INTO users (id, username, email, password_hash, display_name)"
                " VALUES ('u1', 'alice', 'a@b.c', 'hash', 'Alice')"
            ))

            await conn.run_sync(_add_missing_columns)

            cols = await conn.run_sync(lambda c: _get_column_names(c, "users"))
            assert "auth_source" in cols

            row = (await conn.execute(text(
                "SELECT auth_source FROM users WHERE id = 'u1'"
            ))).fetchone()
            assert row[0] == "local"

    @pytest.mark.asyncio
    async def test_idempotent_when_columns_already_exist(self, engine):
        """Running on a fresh schema (all columns present) is a no-op."""
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.execute(text(
                "INSERT INTO channels (id, name, sqlite_db_path, invite_token, is_hidden)"
                " VALUES ('c1', 'general', '/tmp/c1.db', 'tok1', 0)"
            ))
            await conn.execute(text(
                "INSERT INTO users"
                " (id, username, email, password_hash, display_name, is_admin, auth_source)"
                " VALUES ('u1', 'alice', 'a@b.c', 'hash', 'Alice', 0, 'local')"
            ))

            # Should not raise
            await conn.run_sync(_add_missing_columns)

            row = (await conn.execute(text(
                "SELECT is_hidden FROM channels WHERE id = 'c1'"
            ))).fetchone()
            assert not row[0]

            row = (await conn.execute(text(
                "SELECT is_admin, auth_source FROM users WHERE id = 'u1'"
            ))).fetchone()
            assert not row[0]
            assert row[1] == "local"

    @pytest.mark.asyncio
    async def test_multiple_runs_are_safe(self, engine):
        """Calling _add_missing_columns twice does not raise."""
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_USERS_DDL))

            await conn.run_sync(_add_missing_columns)
            await conn.run_sync(_add_missing_columns)

            cols = await conn.run_sync(lambda c: _get_column_names(c, "channels"))
            assert "is_hidden" in cols

    @pytest.mark.asyncio
    async def test_adds_google_caldav_columns_to_calendar_integrations(self, engine):
        """Old calendar_integrations with OAuth2 fields gets new CalDAV columns."""
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(_OLD_CALENDAR_INTEGRATIONS_DDL))
            await conn.execute(text(
                "INSERT INTO calendar_integrations (id, user_id, provider)"
                " VALUES ('ci1', 'u1', 'google')"
            ))

            await conn.run_sync(_add_missing_columns)

            cols = await conn.run_sync(
                lambda c: _get_column_names(c, "calendar_integrations")
            )
            assert "google_email" in cols
            assert "google_app_password" in cols

            row = (await conn.execute(text(
                "SELECT google_email, google_app_password"
                " FROM calendar_integrations WHERE id = 'ci1'"
            ))).fetchone()
            assert row[0] is None
            assert row[1] is None
