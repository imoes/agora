"""Tests fuer Messages-API (CRUD, Reactions) und Chat-DB Service."""
import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


async def _create_channel_with_members(
    client: AsyncClient, auth1: dict, auth2: dict
) -> str:
    """Hilfsfunktion: Erstellt einen Channel mit 2 Mitgliedern."""
    resp = await client.post(
        "/api/channels/",
        json={
            "name": "Msg Test Chat",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_send_message(client: AsyncClient):
    auth1 = await register_user(client, username="msg1", email="msg1@agora.local")
    auth2 = await register_user(client, username="msg2", email="msg2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)

    resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Hallo Welt!", "message_type": "text"},
        headers=auth_headers(auth1["access_token"]),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == "Hallo Welt!"
    assert data["message_type"] == "text"
    assert data["sender_id"] == auth1["user"]["id"]
    assert data["sender_name"] == auth1["user"]["display_name"]
    assert data["id"]
    assert data["created_at"]


@pytest.mark.asyncio
async def test_send_message_non_member(client: AsyncClient):
    auth1 = await register_user(client, username="nms1", email="nms1@agora.local")
    auth2 = await register_user(client, username="nms2", email="nms2@agora.local")
    auth3 = await register_user(client, username="nms3", email="nms3@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)

    resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Hallo!"},
        headers=auth_headers(auth3["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_messages(client: AsyncClient):
    auth1 = await register_user(client, username="lm1", email="lm1@agora.local")
    auth2 = await register_user(client, username="lm2", email="lm2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)

    # Mehrere Nachrichten senden
    for i in range(5):
        await client.post(
            f"/api/channels/{channel_id}/messages/",
            json={"content": f"Nachricht {i + 1}"},
            headers=auth_headers(auth1["access_token"]),
        )

    resp = await client.get(
        f"/api/channels/{channel_id}/messages/",
        headers=auth_headers(auth1["access_token"]),
    )
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 5
    # Chronologische Reihenfolge
    assert messages[0]["content"] == "Nachricht 1"
    assert messages[4]["content"] == "Nachricht 5"


@pytest.mark.asyncio
async def test_list_messages_with_limit(client: AsyncClient):
    auth1 = await register_user(client, username="ll1", email="ll1@agora.local")
    auth2 = await register_user(client, username="ll2", email="ll2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)
    headers = auth_headers(auth1["access_token"])

    for i in range(10):
        await client.post(
            f"/api/channels/{channel_id}/messages/",
            json={"content": f"Msg {i}"},
            headers=headers,
        )

    resp = await client.get(
        f"/api/channels/{channel_id}/messages/?limit=3",
        headers=headers,
    )
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_edit_message(client: AsyncClient):
    auth1 = await register_user(client, username="em1", email="em1@agora.local")
    auth2 = await register_user(client, username="em2", email="em2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Original"},
        headers=headers,
    )
    msg_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/channels/{channel_id}/messages/{msg_id}",
        json={"content": "Bearbeitet"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == "Bearbeitet"
    assert resp.json()["edited_at"] is not None


@pytest.mark.asyncio
async def test_delete_message(client: AsyncClient):
    auth1 = await register_user(client, username="dm1", email="dm1@agora.local")
    auth2 = await register_user(client, username="dm2", email="dm2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Zu loeschen"},
        headers=headers,
    )
    msg_id = create_resp.json()["id"]

    resp = await client.delete(
        f"/api/channels/{channel_id}/messages/{msg_id}",
        headers=headers,
    )
    assert resp.status_code == 204

    # Pruefen dass die Nachricht weg ist
    resp = await client.get(
        f"/api/channels/{channel_id}/messages/",
        headers=headers,
    )
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_delete_nonexistent_message(client: AsyncClient):
    auth1 = await register_user(client, username="dn1", email="dn1@agora.local")
    auth2 = await register_user(client, username="dn2", email="dn2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)

    resp = await client.delete(
        f"/api/channels/{channel_id}/messages/nonexistent-id",
        headers=auth_headers(auth1["access_token"]),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_add_reaction(client: AsyncClient):
    auth1 = await register_user(client, username="re1", email="re1@agora.local")
    auth2 = await register_user(client, username="re2", email="re2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Reagier mal!"},
        headers=headers,
    )
    msg_id = create_resp.json()["id"]

    resp = await client.post(
        f"/api/channels/{channel_id}/messages/{msg_id}/reactions",
        json={"emoji": "thumbsup"},
        headers=headers,
    )
    assert resp.status_code == 200

    # Reactions auflisten
    resp = await client.get(
        f"/api/channels/{channel_id}/messages/{msg_id}/reactions",
        headers=headers,
    )
    assert resp.status_code == 200
    reactions = resp.json()
    assert len(reactions) == 1
    assert reactions[0]["emoji"] == "thumbsup"


@pytest.mark.asyncio
async def test_remove_reaction(client: AsyncClient):
    auth1 = await register_user(client, username="rr1", email="rr1@agora.local")
    auth2 = await register_user(client, username="rr2", email="rr2@agora.local")
    channel_id = await _create_channel_with_members(client, auth1, auth2)
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Test"},
        headers=headers,
    )
    msg_id = create_resp.json()["id"]

    await client.post(
        f"/api/channels/{channel_id}/messages/{msg_id}/reactions",
        json={"emoji": "heart"},
        headers=headers,
    )

    resp = await client.delete(
        f"/api/channels/{channel_id}/messages/{msg_id}/reactions/heart",
        headers=headers,
    )
    assert resp.status_code == 200

    # Pruefen, dass keine Reactions mehr da sind
    resp = await client.get(
        f"/api/channels/{channel_id}/messages/{msg_id}/reactions",
        headers=headers,
    )
    assert len(resp.json()) == 0
