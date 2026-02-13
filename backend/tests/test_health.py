"""Tests fuer Health-Endpoint und allgemeine API-Checks."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "agora"


@pytest.mark.asyncio
async def test_unauthenticated_endpoints_return_401(client: AsyncClient):
    endpoints = [
        ("GET", "/api/auth/me"),
        ("GET", "/api/teams/"),
        ("GET", "/api/channels/"),
        ("GET", "/api/feed/"),
        ("GET", "/api/feed/unread-count"),
        ("GET", "/api/users/"),
    ]
    for method, path in endpoints:
        if method == "GET":
            resp = await client.get(path)
        assert resp.status_code == 401, f"{method} {path} should return 401"
