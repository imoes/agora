"""Tests fuer die Calendar-API (Events + Integration)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.fixture
def _dirs(tmp_chat_dir, tmp_upload_dir):
    """Ensure temp dirs exist for all tests."""
    pass


# ---------------------------------------------------------------------------
# Calendar Events CRUD
# ---------------------------------------------------------------------------


class TestCalendarEvents:
    """CRUD operations on /api/calendar/events."""

    @pytest.mark.asyncio
    async def test_create_event(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]

        now = datetime.now(timezone.utc)
        resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Standup",
                "description": "Daily standup",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
                "location": "Room A",
            },
            headers=auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Standup"
        assert data["description"] == "Daily standup"
        assert data["location"] == "Room A"
        assert data["all_day"] is False
        assert data["id"]

    @pytest.mark.asyncio
    async def test_create_event_invalid_time(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]

        now = datetime.now(timezone.utc)
        resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Bad event",
                "start_time": now.isoformat(),
                "end_time": (now - timedelta(hours=1)).isoformat(),
            },
            headers=auth_headers(token),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_list_events(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]
        headers = auth_headers(token)

        now = datetime.now(timezone.utc)
        # Create two events
        for title in ("Event A", "Event B"):
            await client.post(
                "/api/calendar/events",
                json={
                    "title": title,
                    "start_time": now.isoformat(),
                    "end_time": (now + timedelta(hours=1)).isoformat(),
                },
                headers=headers,
            )

        resp = await client.get(
            "/api/calendar/events",
            params={
                "start": (now - timedelta(days=1)).isoformat(),
                "end": (now + timedelta(days=1)).isoformat(),
            },
            headers=headers,
        )
        assert resp.status_code == 200
        events = resp.json()
        assert len(events) == 2
        titles = {e["title"] for e in events}
        assert titles == {"Event A", "Event B"}

    @pytest.mark.asyncio
    async def test_list_events_filters_by_date_range(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]
        headers = auth_headers(token)

        base = datetime(2026, 6, 15, 10, 0, tzinfo=timezone.utc)
        # Event inside range
        await client.post(
            "/api/calendar/events",
            json={
                "title": "In range",
                "start_time": base.isoformat(),
                "end_time": (base + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
        # Event outside range
        await client.post(
            "/api/calendar/events",
            json={
                "title": "Out of range",
                "start_time": (base + timedelta(days=60)).isoformat(),
                "end_time": (base + timedelta(days=60, hours=1)).isoformat(),
            },
            headers=headers,
        )

        resp = await client.get(
            "/api/calendar/events",
            params={
                "start": (base - timedelta(days=1)).isoformat(),
                "end": (base + timedelta(days=1)).isoformat(),
            },
            headers=headers,
        )
        assert resp.status_code == 200
        events = resp.json()
        assert len(events) == 1
        assert events[0]["title"] == "In range"

    @pytest.mark.asyncio
    async def test_get_event(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]
        headers = auth_headers(token)

        now = datetime.now(timezone.utc)
        create_resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Meeting",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
        event_id = create_resp.json()["id"]

        resp = await client.get(f"/api/calendar/events/{event_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["title"] == "Meeting"

    @pytest.mark.asyncio
    async def test_get_event_not_found(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]

        resp = await client.get(
            "/api/calendar/events/00000000-0000-0000-0000-000000000000",
            headers=auth_headers(token),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_update_event(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]
        headers = auth_headers(token)

        now = datetime.now(timezone.utc)
        create_resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Old title",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
        event_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/calendar/events/{event_id}",
            json={"title": "New title", "location": "Berlin"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "New title"
        assert resp.json()["location"] == "Berlin"

    @pytest.mark.asyncio
    async def test_delete_event(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]
        headers = auth_headers(token)

        now = datetime.now(timezone.utc)
        create_resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "To delete",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
        event_id = create_resp.json()["id"]

        resp = await client.delete(f"/api/calendar/events/{event_id}", headers=headers)
        assert resp.status_code == 204

        # Verify it's gone
        resp2 = await client.get(f"/api/calendar/events/{event_id}", headers=headers)
        assert resp2.status_code == 404

    @pytest.mark.asyncio
    async def test_events_are_user_scoped(self, client: AsyncClient, _dirs):
        """Users can only see their own events."""
        auth1 = await register_user(client, username="alice", email="alice@test.local")
        auth2 = await register_user(client, username="bob", email="bob@test.local")

        now = datetime.now(timezone.utc)
        # Alice creates an event
        await client.post(
            "/api/calendar/events",
            json={
                "title": "Alice meeting",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
            },
            headers=auth_headers(auth1["access_token"]),
        )

        # Bob should not see Alice's event
        resp = await client.get(
            "/api/calendar/events",
            params={
                "start": (now - timedelta(days=1)).isoformat(),
                "end": (now + timedelta(days=1)).isoformat(),
            },
            headers=auth_headers(auth2["access_token"]),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    @pytest.mark.asyncio
    async def test_create_all_day_event(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        token = auth["access_token"]

        day = datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc)
        resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Holiday",
                "start_time": day.isoformat(),
                "end_time": (day + timedelta(days=1)).isoformat(),
                "all_day": True,
            },
            headers=auth_headers(token),
        )
        assert resp.status_code == 201
        assert resp.json()["all_day"] is True


# ---------------------------------------------------------------------------
# Calendar Integration Settings
# ---------------------------------------------------------------------------


class TestCalendarIntegration:
    """CRUD operations on /api/calendar/integration."""

    @pytest.mark.asyncio
    async def test_no_integration_by_default(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        resp = await client.get(
            "/api/calendar/integration",
            headers=auth_headers(auth["access_token"]),
        )
        assert resp.status_code == 200
        assert resp.json() is None

    @pytest.mark.asyncio
    async def test_create_internal_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        resp = await client.put(
            "/api/calendar/integration",
            json={"provider": "internal"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["provider"] == "internal"

    @pytest.mark.asyncio
    async def test_create_webdav_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        resp = await client.put(
            "/api/calendar/integration",
            json={
                "provider": "webdav",
                "webdav_url": "https://cal.example.com/dav/",
                "webdav_username": "user1",
                "webdav_password": "secret",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "webdav"
        assert data["webdav_url"] == "https://cal.example.com/dav/"
        assert data["webdav_username"] == "user1"
        # Password should NOT be returned in the response
        assert "webdav_password" not in data

    @pytest.mark.asyncio
    async def test_update_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        # Create
        await client.put(
            "/api/calendar/integration",
            json={"provider": "internal"},
            headers=headers,
        )
        # Update to google
        resp = await client.put(
            "/api/calendar/integration",
            json={"provider": "google", "google_calendar_id": "primary"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["provider"] == "google"
        assert resp.json()["google_calendar_id"] == "primary"

    @pytest.mark.asyncio
    async def test_delete_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        await client.put(
            "/api/calendar/integration",
            json={"provider": "internal"},
            headers=headers,
        )

        resp = await client.delete("/api/calendar/integration", headers=headers)
        assert resp.status_code == 204

        resp2 = await client.get("/api/calendar/integration", headers=headers)
        assert resp2.json() is None

    @pytest.mark.asyncio
    async def test_invalid_provider(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        resp = await client.put(
            "/api/calendar/integration",
            json={"provider": "invalid_provider"},
            headers=auth_headers(auth["access_token"]),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_sync_without_integration_fails(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        resp = await client.post(
            "/api/calendar/sync",
            headers=auth_headers(auth["access_token"]),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_sync_internal_provider_fails(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        await client.put(
            "/api/calendar/integration",
            json={"provider": "internal"},
            headers=headers,
        )
        resp = await client.post("/api/calendar/sync", headers=headers)
        assert resp.status_code == 400
