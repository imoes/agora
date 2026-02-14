"""Integration test: calendar API with a pre-existing (old-schema) database.

This test simulates the production scenario where the calendar_integrations
table was created with the old Google OAuth2 columns (google_client_id, etc.)
and the migration adds the new CalDAV columns (google_email, google_app_password).
The API must work correctly after migration.
"""

import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import get_db
from app.main import _add_missing_columns, app
from app.models.base import Base

# ---------------------------------------------------------------------------
# Old DDLs: tables as they existed BEFORE the CalDAV migration.
# We create them manually so that create_all (new model) is NOT used.
# ---------------------------------------------------------------------------

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
    is_admin BOOLEAN DEFAULT false,
    auth_source TEXT DEFAULT 'local',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""

_OLD_CHANNELS_DDL = """\
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_type TEXT NOT NULL DEFAULT 'group',
    team_id TEXT,
    sqlite_db_path TEXT NOT NULL,
    invite_token TEXT NOT NULL UNIQUE,
    is_hidden BOOLEAN DEFAULT false,
    scheduled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""

_OLD_CHANNEL_MEMBERS_DDL = """\
CREATE TABLE channel_members (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""

_OLD_CALENDAR_INTEGRATIONS_DDL = """\
CREATE TABLE calendar_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
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

_OLD_CALENDAR_EVENTS_DDL = """\
CREATE TABLE calendar_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    all_day BOOLEAN DEFAULT false,
    location TEXT,
    channel_id TEXT,
    external_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)"""


# ---------------------------------------------------------------------------
# Fixtures: build an "old" database, run migration, then spin up the API
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def old_schema_engine():
    """Create an in-memory DB with the OLD schema, then run migration."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        # Create tables with the OLD schema (before CalDAV migration)
        await conn.execute(text(_OLD_USERS_DDL))
        await conn.execute(text(_OLD_CHANNELS_DDL))
        await conn.execute(text(_OLD_CHANNEL_MEMBERS_DDL))
        await conn.execute(text(_OLD_CALENDAR_INTEGRATIONS_DDL))
        await conn.execute(text(_OLD_CALENDAR_EVENTS_DDL))

        # Insert a pre-existing Google integration with OLD fields
        user_id = str(uuid.uuid4())
        await conn.execute(text(
            "INSERT INTO users (id, username, email, password_hash, display_name)"
            f" VALUES ('{user_id}', 'olduser', 'old@test.local', 'hash', 'Old User')"
        ))
        await conn.execute(text(
            "INSERT INTO calendar_integrations"
            " (id, user_id, provider, google_client_id, google_client_secret,"
            "  google_refresh_token, google_calendar_id)"
            f" VALUES ('{uuid.uuid4()}', '{user_id}', 'google',"
            "  'old-client-id', 'old-secret', 'old-token', 'primary')"
        ))

        # Now run the migration (as happens on startup)
        await conn.run_sync(_add_missing_columns)

    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def migrated_client(old_schema_engine, tmp_path, monkeypatch):
    """AsyncClient using the migrated old-schema DB."""
    chat_dir = str(tmp_path / "chats")
    upload_dir = str(tmp_path / "uploads")
    os.makedirs(chat_dir, exist_ok=True)
    os.makedirs(upload_dir, exist_ok=True)
    monkeypatch.setattr("app.config.settings.chat_db_dir", chat_dir)
    monkeypatch.setattr("app.config.settings.upload_dir", upload_dir)

    session_maker = async_sessionmaker(
        old_schema_engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        async with session_maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def _register_and_headers(client: AsyncClient) -> dict:
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "newuser",
            "email": "new@test.local",
            "password": "Test1234!",
            "display_name": "New User",
        },
    )
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCalendarMigration:
    """Test API endpoints work correctly after migrating from old schema."""

    @pytest.mark.asyncio
    async def test_api_fails_without_migration(self):
        """Without migration, SQLAlchemy raises OperationalError because
        google_email column does not exist.  This proves migration is required."""
        from sqlalchemy.exc import OperationalError

        user_id = str(uuid.uuid4())
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        async with engine.begin() as conn:
            # Old-schema tables WITHOUT running migration
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(_OLD_CALENDAR_INTEGRATIONS_DDL))

            await conn.execute(text(
                "INSERT INTO users (id, username, email, password_hash, display_name)"
                f" VALUES ('{user_id}', 'test', 'test@x.com', 'hash', 'Test')"
            ))

        session_maker = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )

        from app.models.calendar import CalendarIntegration
        from sqlalchemy import select

        async with session_maker() as session:
            with pytest.raises(OperationalError, match="google_email"):
                await session.execute(
                    select(CalendarIntegration).where(
                        CalendarIntegration.user_id == uuid.UUID(user_id)
                    )
                )

        await engine.dispose()

    @pytest.mark.asyncio
    async def test_api_works_after_migration(self):
        """After migration, the same query succeeds."""
        user_id = str(uuid.uuid4())
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
        async with engine.begin() as conn:
            await conn.execute(text(_OLD_USERS_DDL))
            await conn.execute(text(_OLD_CHANNELS_DDL))
            await conn.execute(text(_OLD_CALENDAR_INTEGRATIONS_DDL))

            await conn.execute(text(
                "INSERT INTO users (id, username, email, password_hash, display_name)"
                f" VALUES ('{user_id}', 'test', 'test@x.com', 'hash', 'Test')"
            ))

            # Run migration
            await conn.run_sync(_add_missing_columns)

        session_maker = async_sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )

        from app.models.calendar import CalendarIntegration
        from sqlalchemy import select

        async with session_maker() as session:
            result = await session.execute(
                select(CalendarIntegration).where(
                    CalendarIntegration.user_id == uuid.UUID(user_id)
                )
            )
            assert result.scalar_one_or_none() is None

    @pytest.mark.asyncio
    async def test_create_google_caldav_integration_after_migration(
        self, migrated_client: AsyncClient
    ):
        """PUT /api/calendar/integration with google CalDAV credentials
        must succeed on a DB that was migrated from the old OAuth2 schema."""
        headers = await _register_and_headers(migrated_client)

        resp = await migrated_client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "user@gmail.com",
                "google_app_password": "abcd efgh ijkl mnop",
            },
            headers=headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["provider"] == "google"
        assert data["google_email"] == "user@gmail.com"
        assert "google_app_password" not in data

    @pytest.mark.asyncio
    async def test_get_integration_after_migration(
        self, migrated_client: AsyncClient
    ):
        """GET /api/calendar/integration works after migration."""
        headers = await _register_and_headers(migrated_client)

        # Create one first
        await migrated_client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "user@gmail.com",
                "google_app_password": "pw",
            },
            headers=headers,
        )

        resp = await migrated_client.get(
            "/api/calendar/integration",
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "google"
        assert data["google_email"] == "user@gmail.com"

    @pytest.mark.asyncio
    async def test_update_from_outlook_to_google_caldav(
        self, migrated_client: AsyncClient
    ):
        """Switching from outlook to google CalDAV must work on migrated DB."""
        headers = await _register_and_headers(migrated_client)

        # First save as Outlook
        resp1 = await migrated_client.put(
            "/api/calendar/integration",
            json={
                "provider": "outlook",
                "outlook_server_url": "https://mail.example.com",
                "outlook_username": "user",
                "outlook_password": "pass",
            },
            headers=headers,
        )
        assert resp1.status_code == 200

        # Now switch to Google CalDAV
        resp2 = await migrated_client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "me@gmail.com",
                "google_app_password": "xxxx yyyy zzzz wwww",
            },
            headers=headers,
        )
        assert resp2.status_code == 200, f"Expected 200, got {resp2.status_code}: {resp2.text}"
        data = resp2.json()
        assert data["provider"] == "google"
        assert data["google_email"] == "me@gmail.com"

    @pytest.mark.asyncio
    async def test_create_event_on_migrated_db(
        self, migrated_client: AsyncClient
    ):
        """Creating events must work on the migrated database."""
        headers = await _register_and_headers(migrated_client)

        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        resp = await migrated_client.post(
            "/api/calendar/events",
            json={
                "title": "Test Event",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
        assert resp.json()["title"] == "Test Event"
