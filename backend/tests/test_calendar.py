"""Tests fuer die Calendar-API (Events + Integration + Video-Call)."""

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
        await client.post(
            "/api/calendar/events",
            json={
                "title": "In range",
                "start_time": base.isoformat(),
                "end_time": (base + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
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

        resp2 = await client.get(f"/api/calendar/events/{event_id}", headers=headers)
        assert resp2.status_code == 404

    @pytest.mark.asyncio
    async def test_events_are_user_scoped(self, client: AsyncClient, _dirs):
        """Users can only see their own events."""
        auth1 = await register_user(client, username="alice", email="alice@test.local")
        auth2 = await register_user(client, username="bob", email="bob@test.local")

        now = datetime.now(timezone.utc)
        await client.post(
            "/api/calendar/events",
            json={
                "title": "Alice meeting",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
            },
            headers=auth_headers(auth1["access_token"]),
        )

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

    @pytest.mark.asyncio
    async def test_create_event_with_video_call(self, client: AsyncClient, _dirs):
        """create_video_call=True should create a meeting channel and put a
        /video/<uuid> link in the location field."""
        auth = await register_user(client)
        token = auth["access_token"]

        now = datetime.now(timezone.utc)
        resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Team Sync",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
                "create_video_call": True,
            },
            headers=auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "/video/" in data["location"]
        assert data["channel_id"] is not None

    @pytest.mark.asyncio
    async def test_create_event_with_video_call_preserves_existing_location(
        self, client: AsyncClient, _dirs
    ):
        auth = await register_user(client)
        token = auth["access_token"]

        now = datetime.now(timezone.utc)
        resp = await client.post(
            "/api/calendar/events",
            json={
                "title": "Offsite",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(hours=1)).isoformat(),
                "location": "Berlin HQ",
                "create_video_call": True,
            },
            headers=auth_headers(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "Berlin HQ" in data["location"]
        assert "/video/" in data["location"]


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
        assert "webdav_password" not in data

    @pytest.mark.asyncio
    async def test_create_google_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        resp = await client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "user@gmail.com",
                "google_app_password": "abcd efgh ijkl mnop",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "google"
        assert data["google_email"] == "user@gmail.com"
        # App password should NOT be returned
        assert "google_app_password" not in data

    @pytest.mark.asyncio
    async def test_create_outlook_exchange_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        resp = await client.put(
            "/api/calendar/integration",
            json={
                "provider": "outlook",
                "outlook_server_url": "https://mail.contoso.com",
                "outlook_username": "CONTOSO\\jdoe",
                "outlook_password": "s3cret",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["provider"] == "outlook"
        assert data["outlook_server_url"] == "https://mail.contoso.com"
        assert data["outlook_username"] == "CONTOSO\\jdoe"
        # Password should NOT be returned
        assert "outlook_password" not in data

    @pytest.mark.asyncio
    async def test_update_integration(self, client: AsyncClient, _dirs):
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        await client.put(
            "/api/calendar/integration",
            json={"provider": "internal"},
            headers=headers,
        )
        resp = await client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "user@gmail.com",
            },
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["provider"] == "google"
        assert resp.json()["google_email"] == "user@gmail.com"

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

    @pytest.mark.asyncio
    async def test_sync_google_auth_failure_returns_502(self, client: AsyncClient, _dirs):
        """When Google CalDAV returns 401, the sync endpoint should return 502
        with a meaningful error message instead of an empty list."""
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        await client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "user@gmail.com",
                "google_app_password": "wrong-password",
            },
            headers=headers,
        )

        # Mock httpx to return 401 from Google
        mock_response = AsyncMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"

        with patch("app.services.calendar_sync.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            resp = await client.post("/api/calendar/sync", headers=headers)

        assert resp.status_code == 502
        assert "google" in resp.json()["detail"].lower()
        assert "401" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_sync_google_success_imports_events(self, client: AsyncClient, _dirs):
        """When Google CalDAV returns valid iCal data, events are imported."""
        auth = await register_user(client)
        headers = auth_headers(auth["access_token"])

        await client.put(
            "/api/calendar/integration",
            json={
                "provider": "google",
                "google_email": "user@gmail.com",
                "google_app_password": "valid-password",
            },
            headers=headers,
        )

        ical_data = (
            "BEGIN:VCALENDAR\r\n"
            "BEGIN:VEVENT\r\n"
            "UID:test-event-123\r\n"
            "SUMMARY:Team Meeting\r\n"
            "DTSTART:20260214T100000Z\r\n"
            "DTEND:20260214T110000Z\r\n"
            "LOCATION:Room 42\r\n"
            "END:VEVENT\r\n"
            "END:VCALENDAR"
        )
        caldav_xml = (
            '<?xml version="1.0" encoding="utf-8"?>'
            "<multistatus><response><propstat><prop>"
            f"<calendar-data>{ical_data}</calendar-data>"
            "</prop></propstat></response></multistatus>"
        )

        mock_response = AsyncMock()
        mock_response.status_code = 207
        mock_response.text = caldav_xml

        with patch("app.services.calendar_sync.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            resp = await client.post(
                "/api/calendar/sync",
                params={
                    "start": "2026-02-01T00:00:00Z",
                    "end": "2026-03-01T00:00:00Z",
                },
                headers=headers,
            )

        assert resp.status_code == 200
        events = resp.json()
        assert len(events) == 1
        assert events[0]["title"] == "Team Meeting"
        assert events[0]["external_id"] == "test-event-123"
