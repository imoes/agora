"""
Pytest-Konfiguration mit In-Memory SQLite fuer PostgreSQL-Models
und temporaerem Verzeichnis fuer Chat-SQLite-Dateien.
"""
import os
import tempfile
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.base import Base
from app.database import get_db
from app.main import app

# In-memory SQLite fuer PostgreSQL-Ersatz im Test
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    session_maker = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with session_maker() as session:
        yield session


@pytest.fixture
def tmp_chat_dir(tmp_path, monkeypatch):
    chat_dir = str(tmp_path / "chats")
    os.makedirs(chat_dir, exist_ok=True)
    monkeypatch.setattr("app.config.settings.chat_db_dir", chat_dir)
    return chat_dir


@pytest.fixture
def tmp_upload_dir(tmp_path, monkeypatch):
    upload_dir = str(tmp_path / "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    monkeypatch.setattr("app.config.settings.upload_dir", upload_dir)
    return upload_dir


@pytest_asyncio.fixture
async def client(db_engine):
    """AsyncClient der FastAPI-App mit ueberschriebener DB-Dependency."""
    session_maker = async_sessionmaker(
        db_engine, class_=AsyncSession, expire_on_commit=False
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


async def register_user(
    client: AsyncClient,
    username: str = "testuser",
    email: str = "test@agora.local",
    password: str = "Test1234!",
    display_name: str = "Test User",
) -> dict:
    """Hilfsfunktion: Registriert einen Benutzer und gibt das Auth-Dict zurueck."""
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
            "display_name": display_name,
        },
    )
    assert resp.status_code == 201, f"Register fehlgeschlagen: {resp.text}"
    return resp.json()


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
