import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_video_notes_shared_and_persisted_for_room(client: AsyncClient):
    owner = await register_user(client, username="vn-owner", email="vn-owner@agora.local")
    member = await register_user(client, username="vn-member", email="vn-member@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={
            "name": "Video Notes",
            "channel_type": "group",
            "member_ids": [member["user"]["id"]],
        },
        headers=auth_headers(owner["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    # Ensure room exists
    await client.post(
        "/api/video/rooms",
        params={"channel_id": channel_id},
        headers=auth_headers(owner["access_token"]),
    )

    put_resp = await client.put(
        f"/api/video/rooms/{channel_id}/notes",
        json={"notes": "Agenda\n- Architektur\n- Nächste Schritte"},
        headers=auth_headers(owner["access_token"]),
    )
    assert put_resp.status_code == 200

    get_resp = await client.get(
        f"/api/video/rooms/{channel_id}/notes",
        headers=auth_headers(member["access_token"]),
    )
    assert get_resp.status_code == 200
    assert "Architektur" in get_resp.json()["notes"]


@pytest.mark.asyncio
async def test_video_notes_require_membership(client: AsyncClient):
    owner = await register_user(client, username="vn2-owner", email="vn2-owner@agora.local")
    outsider = await register_user(client, username="vn2-outsider", email="vn2-outsider@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Video Notes Private", "channel_type": "group", "member_ids": []},
        headers=auth_headers(owner["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    resp = await client.get(
        f"/api/video/rooms/{channel_id}/notes",
        headers=auth_headers(outsider["access_token"]),
    )
    assert resp.status_code == 403
