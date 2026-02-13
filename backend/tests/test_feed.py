"""Tests fuer Feed-API (Aggregation, Ungelesen, Markierung)."""
import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_feed_empty_initially(client: AsyncClient):
    auth = await register_user(client)
    resp = await client.get(
        "/api/feed/",
        headers=auth_headers(auth["access_token"]),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["events"] == []
    assert data["unread_count"] == 0


@pytest.mark.asyncio
async def test_feed_receives_messages(client: AsyncClient):
    auth1 = await register_user(client, username="f1", email="f1@agora.local")
    auth2 = await register_user(client, username="f2", email="f2@agora.local")

    # Channel erstellen mit beiden Usern
    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Feed Test",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    # User 1 sendet 3 Nachrichten
    for i in range(3):
        await client.post(
            f"/api/channels/{channel_id}/messages/",
            json={"content": f"Feed Nachricht {i + 1}"},
            headers=auth_headers(auth1["access_token"]),
        )

    # User 2 sieht die Nachrichten im Feed
    resp = await client.get(
        "/api/feed/",
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["events"]) == 3
    assert data["unread_count"] == 3

    # Pruefen dass der Sender die richtige Vorschau hat (Feed sortiert DESC)
    previews = {e["preview_text"] for e in data["events"]}
    assert "Feed Nachricht 1" in previews
    assert "Feed Nachricht 3" in previews
    assert data["events"][0]["sender_name"] is not None
    assert data["events"][0]["channel_name"] == "Feed Test"


@pytest.mark.asyncio
async def test_feed_sender_does_not_see_own(client: AsyncClient):
    auth1 = await register_user(client, username="fs1", email="fs1@agora.local")
    auth2 = await register_user(client, username="fs2", email="fs2@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Self Test",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Eigene Nachricht"},
        headers=auth_headers(auth1["access_token"]),
    )

    # Sender sieht eigene Nachricht NICHT im Feed
    resp = await client.get(
        "/api/feed/",
        headers=auth_headers(auth1["access_token"]),
    )
    assert resp.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_feed_unread_only(client: AsyncClient):
    auth1 = await register_user(client, username="fu1", email="fu1@agora.local")
    auth2 = await register_user(client, username="fu2", email="fu2@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Unread Test",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    for i in range(3):
        await client.post(
            f"/api/channels/{channel_id}/messages/",
            json={"content": f"Msg {i}"},
            headers=auth_headers(auth1["access_token"]),
        )

    # Ungelesen-Filter
    resp = await client.get(
        "/api/feed/?unread_only=true",
        headers=auth_headers(auth2["access_token"]),
    )
    assert len(resp.json()["events"]) == 3


@pytest.mark.asyncio
async def test_mark_feed_read_by_ids(client: AsyncClient):
    auth1 = await register_user(client, username="mr1", email="mr1@agora.local")
    auth2 = await register_user(client, username="mr2", email="mr2@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Read Test",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Lies mich"},
        headers=auth_headers(auth1["access_token"]),
    )

    # Feed abrufen
    feed_resp = await client.get(
        "/api/feed/",
        headers=auth_headers(auth2["access_token"]),
    )
    events = feed_resp.json()["events"]
    assert len(events) == 1
    event_id = events[0]["id"]

    # Als gelesen markieren
    resp = await client.post(
        "/api/feed/read",
        json={"event_ids": [event_id]},
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["marked_read"] == 1

    # Unread Count pruefen
    resp = await client.get(
        "/api/feed/unread-count",
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_mark_feed_read_by_channel(client: AsyncClient):
    auth1 = await register_user(client, username="mc1", email="mc1@agora.local")
    auth2 = await register_user(client, username="mc2", email="mc2@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Chan Read",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    for i in range(5):
        await client.post(
            f"/api/channels/{channel_id}/messages/",
            json={"content": f"Msg {i}"},
            headers=auth_headers(auth1["access_token"]),
        )

    # Alle Nachrichten des Channels als gelesen markieren
    resp = await client.post(
        "/api/feed/read",
        json={"channel_id": channel_id},
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.json()["marked_read"] == 5


@pytest.mark.asyncio
async def test_unread_count_endpoint(client: AsyncClient):
    auth1 = await register_user(client, username="uc1", email="uc1@agora.local")
    auth2 = await register_user(client, username="uc2", email="uc2@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Count Test",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    for i in range(7):
        await client.post(
            f"/api/channels/{channel_id}/messages/",
            json={"content": f"N {i}"},
            headers=auth_headers(auth1["access_token"]),
        )

    resp = await client.get(
        "/api/feed/unread-count",
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.json()["unread_count"] == 7
