"""Tests fuer Teams-API (CRUD, Mitglieder)."""
import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_create_team(client: AsyncClient):
    auth = await register_user(client)
    headers = auth_headers(auth["access_token"])

    resp = await client.post(
        "/api/teams/",
        json={"name": "Dev Team", "description": "Entwicklerteam"},
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Dev Team"
    assert data["description"] == "Entwicklerteam"
    assert data["member_count"] == 1
    assert data["owner_id"] == auth["user"]["id"]


@pytest.mark.asyncio
async def test_list_teams_only_mine(client: AsyncClient):
    auth1 = await register_user(client, username="u1", email="u1@agora.local")
    auth2 = await register_user(client, username="u2", email="u2@agora.local")

    # User 1 erstellt ein Team
    await client.post(
        "/api/teams/",
        json={"name": "Team von U1"},
        headers=auth_headers(auth1["access_token"]),
    )
    # User 2 erstellt ein Team
    await client.post(
        "/api/teams/",
        json={"name": "Team von U2"},
        headers=auth_headers(auth2["access_token"]),
    )

    # User 1 sieht nur sein Team
    resp = await client.get("/api/teams/", headers=auth_headers(auth1["access_token"]))
    assert resp.status_code == 200
    teams = resp.json()
    assert len(teams) == 1
    assert teams[0]["name"] == "Team von U1"


@pytest.mark.asyncio
async def test_get_team_as_member(client: AsyncClient):
    auth = await register_user(client, username="tm1", email="tm1@agora.local")
    headers = auth_headers(auth["access_token"])

    create_resp = await client.post(
        "/api/teams/", json={"name": "Test Team"}, headers=headers
    )
    team_id = create_resp.json()["id"]

    resp = await client.get(f"/api/teams/{team_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test Team"


@pytest.mark.asyncio
async def test_get_team_as_non_member(client: AsyncClient):
    auth1 = await register_user(client, username="t1", email="t1@agora.local")
    auth2 = await register_user(client, username="t2", email="t2@agora.local")

    create_resp = await client.post(
        "/api/teams/",
        json={"name": "Privates Team"},
        headers=auth_headers(auth1["access_token"]),
    )
    team_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/teams/{team_id}",
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_team_as_owner(client: AsyncClient):
    auth = await register_user(client, username="owner1", email="owner1@agora.local")
    headers = auth_headers(auth["access_token"])

    create_resp = await client.post(
        "/api/teams/", json={"name": "Old Name"}, headers=headers
    )
    team_id = create_resp.json()["id"]

    resp = await client.patch(
        f"/api/teams/{team_id}",
        json={"name": "New Name", "description": "Aktualisiert"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
    assert resp.json()["description"] == "Aktualisiert"


@pytest.mark.asyncio
async def test_update_team_as_non_owner(client: AsyncClient):
    auth1 = await register_user(client, username="own", email="own@agora.local")
    auth2 = await register_user(client, username="notown", email="notown@agora.local")

    create_resp = await client.post(
        "/api/teams/",
        json={"name": "Team"},
        headers=auth_headers(auth1["access_token"]),
    )
    team_id = create_resp.json()["id"]

    # User 2 zum Team hinzufuegen
    await client.post(
        f"/api/teams/{team_id}/members",
        json={"user_id": auth2["user"]["id"], "role": "member"},
        headers=auth_headers(auth1["access_token"]),
    )

    resp = await client.patch(
        f"/api/teams/{team_id}",
        json={"name": "Geaendert"},
        headers=auth_headers(auth2["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_add_and_list_members(client: AsyncClient):
    auth1 = await register_user(client, username="admin1", email="admin1@agora.local")
    auth2 = await register_user(client, username="member1", email="member1@agora.local")
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        "/api/teams/", json={"name": "Team mit Mitgliedern"}, headers=headers
    )
    team_id = create_resp.json()["id"]

    # Mitglied hinzufuegen
    resp = await client.post(
        f"/api/teams/{team_id}/members",
        json={"user_id": auth2["user"]["id"], "role": "member"},
        headers=headers,
    )
    assert resp.status_code == 201

    # Mitglieder auflisten
    resp = await client.get(f"/api/teams/{team_id}/members", headers=headers)
    assert resp.status_code == 200
    members = resp.json()
    assert len(members) == 2
    usernames = {m["user"]["username"] for m in members}
    assert usernames == {"admin1", "member1"}


@pytest.mark.asyncio
async def test_add_duplicate_member(client: AsyncClient):
    auth1 = await register_user(client, username="a1", email="a1@agora.local")
    auth2 = await register_user(client, username="a2", email="a2@agora.local")
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        "/api/teams/", json={"name": "Dup Test"}, headers=headers
    )
    team_id = create_resp.json()["id"]

    await client.post(
        f"/api/teams/{team_id}/members",
        json={"user_id": auth2["user"]["id"]},
        headers=headers,
    )
    resp = await client.post(
        f"/api/teams/{team_id}/members",
        json={"user_id": auth2["user"]["id"]},
        headers=headers,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_remove_member(client: AsyncClient):
    auth1 = await register_user(client, username="rm1", email="rm1@agora.local")
    auth2 = await register_user(client, username="rm2", email="rm2@agora.local")
    headers = auth_headers(auth1["access_token"])

    create_resp = await client.post(
        "/api/teams/", json={"name": "Remove Test"}, headers=headers
    )
    team_id = create_resp.json()["id"]

    await client.post(
        f"/api/teams/{team_id}/members",
        json={"user_id": auth2["user"]["id"]},
        headers=headers,
    )

    resp = await client.delete(
        f"/api/teams/{team_id}/members/{auth2['user']['id']}",
        headers=headers,
    )
    assert resp.status_code == 204

    # Pruefen dass Mitglied entfernt wurde
    resp = await client.get(f"/api/teams/{team_id}/members", headers=headers)
    members = resp.json()
    assert len(members) == 1


@pytest.mark.asyncio
async def test_create_team_creates_general_channel(client: AsyncClient):
    auth = await register_user(client, username="chk", email="chk@agora.local")
    headers = auth_headers(auth["access_token"])

    create_resp = await client.post(
        "/api/teams/", json={"name": "Chan Test"}, headers=headers
    )
    team_id = create_resp.json()["id"]

    resp = await client.get(
        f"/api/channels/?team_id={team_id}", headers=headers
    )
    assert resp.status_code == 200
    channels = resp.json()
    assert len(channels) == 1
    assert channels[0]["name"] == "General"
    assert channels[0]["channel_type"] == "team"
