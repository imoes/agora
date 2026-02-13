"""Tests fuer Channels-API (Erstellen, Auflisten, Mitglieder)."""
import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_create_channel(client: AsyncClient):
    auth = await register_user(client)
    headers = auth_headers(auth["access_token"])

    resp = await client.post(
        "/api/channels/",
        json={
            "name": "Test Chat",
            "channel_type": "group",
            "member_ids": [],
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Chat"
    assert data["channel_type"] == "group"
    assert data["member_count"] == 1


@pytest.mark.asyncio
async def test_create_channel_with_members(client: AsyncClient):
    auth1 = await register_user(client, username="cc1", email="cc1@agora.local")
    auth2 = await register_user(client, username="cc2", email="cc2@agora.local")
    auth3 = await register_user(client, username="cc3", email="cc3@agora.local")

    resp = await client.post(
        "/api/channels/",
        json={
            "name": "Gruppenchat",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"], auth3["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    assert resp.status_code == 201
    assert resp.json()["member_count"] == 3


@pytest.mark.asyncio
async def test_list_channels(client: AsyncClient):
    auth = await register_user(client, username="lc1", email="lc1@agora.local")
    headers = auth_headers(auth["access_token"])

    # Erstelle 2 Channels
    await client.post(
        "/api/channels/",
        json={"name": "Chat A", "channel_type": "group"},
        headers=headers,
    )
    await client.post(
        "/api/channels/",
        json={"name": "Chat B", "channel_type": "group"},
        headers=headers,
    )

    resp = await client.get("/api/channels/", headers=headers)
    assert resp.status_code == 200
    channels = resp.json()
    assert len(channels) == 2
    names = {ch["name"] for ch in channels}
    assert names == {"Chat A", "Chat B"}


@pytest.mark.asyncio
async def test_list_channels_only_mine(client: AsyncClient):
    auth1 = await register_user(client, username="my1", email="my1@agora.local")
    auth2 = await register_user(client, username="my2", email="my2@agora.local")

    await client.post(
        "/api/channels/",
        json={"name": "Privat 1", "channel_type": "group"},
        headers=auth_headers(auth1["access_token"]),
    )
    await client.post(
        "/api/channels/",
        json={"name": "Privat 2", "channel_type": "group"},
        headers=auth_headers(auth2["access_token"]),
    )

    resp = await client.get(
        "/api/channels/",
        headers=auth_headers(auth1["access_token"]),
    )
    channels = resp.json()
    assert len(channels) == 1
    assert channels[0]["name"] == "Privat 1"


@pytest.mark.asyncio
async def test_get_channel_as_member(client: AsyncClient):
    auth = await register_user(client, username="gc1", email="gc1@agora.local")
    headers = auth_headers(auth["access_token"])

    create_resp = await client.post(
        "/api/channels/",
        json={"name": "Detail Test", "channel_type": "group"},
        headers=headers,
    )
    channel_id = create_resp.json()["id"]

    resp = await client.get(f"/api/channels/{channel_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Detail Test"


@pytest.mark.asyncio
async def test_get_channel_as_non_member(client: AsyncClient):
    auth1 = await register_user(client, username="nm1", email="nm1@agora.local")
    auth2 = await register_user(client, username="nm2", email="nm2@agora.local")

    create_resp = await client.post(
        "/api/channels/",
        json={"name": "Geheim", "channel_type": "group"},
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/channels/{channel_id}",
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_channel_members(client: AsyncClient):
    auth1 = await register_user(client, username="cm1", email="cm1@agora.local")
    auth2 = await register_user(client, username="cm2", email="cm2@agora.local")

    create_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Member Test",
            "channel_type": "group",
            "member_ids": [auth2["user"]["id"]],
        },
        headers=auth_headers(auth1["access_token"]),
    )
    channel_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/channels/{channel_id}/members",
        headers=auth_headers(auth1["access_token"]),
    )
    assert resp.status_code == 200
    members = resp.json()
    assert len(members) == 2


@pytest.mark.asyncio
async def test_add_channel_member(client: AsyncClient):
    auth1 = await register_user(client, username="am1", email="am1@agora.local")
    auth2 = await register_user(client, username="am2", email="am2@agora.local")
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        "/api/channels/",
        json={"name": "Add Test", "channel_type": "group"},
        headers=headers,
    )
    channel_id = create_resp.json()["id"]

    resp = await client.post(
        f"/api/channels/{channel_id}/members/{auth2['user']['id']}",
        headers=headers,
    )
    assert resp.status_code == 201

    # Doppelt hinzufuegen
    resp = await client.post(
        f"/api/channels/{channel_id}/members/{auth2['user']['id']}",
        headers=headers,
    )
    assert resp.status_code == 409
