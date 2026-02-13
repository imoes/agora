"""Tests fuer Authentifizierung (Register, Login, JWT)."""
import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "alice",
            "email": "alice@agora.local",
            "password": "Secure123!",
            "display_name": "Alice Wonderland",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["access_token"]
    assert data["user"]["username"] == "alice"
    assert data["user"]["email"] == "alice@agora.local"
    assert data["user"]["display_name"] == "Alice Wonderland"
    assert "id" in data["user"]


@pytest.mark.asyncio
async def test_register_duplicate_username(client: AsyncClient):
    await register_user(client, username="bob", email="bob@agora.local")
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "bob",
            "email": "bob2@agora.local",
            "password": "Test1234!",
            "display_name": "Bob 2",
        },
    )
    assert resp.status_code == 409
    assert "already exists" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    await register_user(client, username="carol", email="carol@agora.local")
    resp = await client.post(
        "/api/auth/register",
        json={
            "username": "carol_other",
            "email": "carol@agora.local",
            "password": "Test1234!",
            "display_name": "Carol 2",
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await register_user(client, username="dave", email="dave@agora.local")
    resp = await client.post(
        "/api/auth/login",
        json={"username": "dave", "password": "Test1234!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["access_token"]
    assert data["user"]["username"] == "dave"
    assert data["user"]["status"] == "online"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await register_user(client, username="eve", email="eve@agora.local")
    resp = await client.post(
        "/api/auth/login",
        json={"username": "eve", "password": "falsch"},
    )
    assert resp.status_code == 401
    assert "Invalid credentials" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        json={"username": "nonexistent", "password": "Test1234!"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_authenticated(client: AsyncClient):
    auth = await register_user(client, username="frank", email="frank@agora.local")
    resp = await client.get("/api/auth/me", headers=auth_headers(auth["access_token"]))
    assert resp.status_code == 200
    assert resp.json()["username"] == "frank"


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_invalid_token(client: AsyncClient):
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_update_me(client: AsyncClient):
    auth = await register_user(client, username="grace", email="grace@agora.local")
    headers = auth_headers(auth["access_token"])

    resp = await client.patch(
        "/api/auth/me",
        json={"display_name": "Grace Updated", "status": "away"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["display_name"] == "Grace Updated"
    assert data["status"] == "away"
