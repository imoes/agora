"""Unit-Tests fuer das Einladungssystem (Invitations API, ICS, E-Mail)."""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from tests.conftest import auth_headers, register_user


@pytest.mark.asyncio
async def test_create_invitation(client, tmp_chat_dir):
    """Einladung erstellen und per E-Mail senden."""
    user = await register_user(client)
    token = user["access_token"]

    # Channel erstellen
    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Einladungs-Chat", "channel_type": "group"},
        headers=auth_headers(token),
    )
    assert ch_resp.status_code == 201
    channel = ch_resp.json()
    channel_id = channel["id"]
    assert channel["invite_token"]  # Token wurde automatisch generiert

    # Einladung senden (E-Mail wird im Hintergrund gesendet, Mock verwenden)
    with patch("app.api.invitations.send_invitation_email", new_callable=AsyncMock, return_value=True):
        resp = await client.post(
            f"/api/invitations/channel/{channel_id}",
            json={"email": "gast@example.com", "message": "Komm rein!"},
            headers=auth_headers(token),
        )
    assert resp.status_code == 201
    inv = resp.json()
    assert inv["invited_email"] == "gast@example.com"
    assert inv["message"] == "Komm rein!"
    assert inv["status"] == "pending"
    assert inv["channel_name"] == "Einladungs-Chat"
    assert inv["expires_at"]


@pytest.mark.asyncio
async def test_duplicate_invitation_blocked(client, tmp_chat_dir):
    """Doppelte aktive Einladung wird abgelehnt."""
    user = await register_user(client)
    token = user["access_token"]

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Dup-Test", "channel_type": "group"},
        headers=auth_headers(token),
    )
    channel_id = ch_resp.json()["id"]

    with patch("app.api.invitations.send_invitation_email", new_callable=AsyncMock, return_value=True):
        resp1 = await client.post(
            f"/api/invitations/channel/{channel_id}",
            json={"email": "dup@example.com"},
            headers=auth_headers(token),
        )
        assert resp1.status_code == 201

        resp2 = await client.post(
            f"/api/invitations/channel/{channel_id}",
            json={"email": "dup@example.com"},
            headers=auth_headers(token),
        )
        assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_list_channel_invitations(client, tmp_chat_dir):
    """Einladungen fuer einen Channel auflisten."""
    user = await register_user(client)
    token = user["access_token"]

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "List-Test", "channel_type": "group"},
        headers=auth_headers(token),
    )
    channel_id = ch_resp.json()["id"]

    with patch("app.api.invitations.send_invitation_email", new_callable=AsyncMock, return_value=True):
        await client.post(
            f"/api/invitations/channel/{channel_id}",
            json={"email": "a@example.com"},
            headers=auth_headers(token),
        )
        await client.post(
            f"/api/invitations/channel/{channel_id}",
            json={"email": "b@example.com"},
            headers=auth_headers(token),
        )

    resp = await client.get(
        f"/api/invitations/channel/{channel_id}",
        headers=auth_headers(token),
    )
    assert resp.status_code == 200
    invitations = resp.json()
    assert len(invitations) == 2
    emails = {inv["invited_email"] for inv in invitations}
    assert emails == {"a@example.com", "b@example.com"}


@pytest.mark.asyncio
async def test_accept_invitation_by_token(client, tmp_chat_dir):
    """Einladung ueber Token annehmen."""
    # User 1 erstellt Channel
    user1 = await register_user(client, username="inviter", email="inviter@agora.local")
    token1 = user1["access_token"]

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Accept-Test", "channel_type": "group"},
        headers=auth_headers(token1),
    )
    channel = ch_resp.json()
    invite_token = channel["invite_token"]

    # User 2 nimmt Einladung an
    user2 = await register_user(client, username="joiner", email="joiner@agora.local")
    token2 = user2["access_token"]

    resp = await client.get(
        f"/api/invitations/accept/{invite_token}",
        headers=auth_headers(token2),
    )
    assert resp.status_code == 200
    result = resp.json()
    assert result["status"] == "joined"
    assert result["channel_name"] == "Accept-Test"

    # Zweites Mal: already_member
    resp2 = await client.get(
        f"/api/invitations/accept/{invite_token}",
        headers=auth_headers(token2),
    )
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "already_member"


@pytest.mark.asyncio
async def test_accept_invalid_token(client, tmp_chat_dir):
    """Ungueltiger Token wird abgelehnt."""
    user = await register_user(client)
    token = user["access_token"]

    resp = await client.get(
        "/api/invitations/accept/invalid-token-xyz",
        headers=auth_headers(token),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_regenerate_invite_token(client, tmp_chat_dir):
    """Einladungs-Token neu generieren."""
    user = await register_user(client)
    token = user["access_token"]

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Regen-Test", "channel_type": "group"},
        headers=auth_headers(token),
    )
    channel = ch_resp.json()
    old_token = channel["invite_token"]

    resp = await client.post(
        f"/api/invitations/channel/{channel['id']}/regenerate-token",
        headers=auth_headers(token),
    )
    assert resp.status_code == 200
    new_token = resp.json()["invite_token"]
    assert new_token != old_token
    assert len(new_token) > 10


@pytest.mark.asyncio
async def test_revoke_invitation(client, tmp_chat_dir):
    """Einladung widerrufen."""
    user = await register_user(client)
    token = user["access_token"]

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Revoke-Test", "channel_type": "group"},
        headers=auth_headers(token),
    )
    channel_id = ch_resp.json()["id"]

    with patch("app.api.invitations.send_invitation_email", new_callable=AsyncMock, return_value=True):
        inv_resp = await client.post(
            f"/api/invitations/channel/{channel_id}",
            json={"email": "revoke@example.com"},
            headers=auth_headers(token),
        )
    inv_id = inv_resp.json()["id"]

    resp = await client.delete(
        f"/api/invitations/{inv_id}",
        headers=auth_headers(token),
    )
    assert resp.status_code == 204

    # Pruefen: Status ist declined
    list_resp = await client.get(
        f"/api/invitations/channel/{channel_id}",
        headers=auth_headers(token),
    )
    invitations = list_resp.json()
    assert invitations[0]["status"] == "declined"


@pytest.mark.asyncio
async def test_non_member_cannot_invite(client, tmp_chat_dir):
    """Nicht-Mitglieder koennen keine Einladungen erstellen."""
    user1 = await register_user(client, username="owner", email="owner@agora.local")
    user2 = await register_user(client, username="outsider", email="outsider@agora.local")

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Private-Chat", "channel_type": "group"},
        headers=auth_headers(user1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    resp = await client.post(
        f"/api/invitations/channel/{channel_id}",
        json={"email": "someone@example.com"},
        headers=auth_headers(user2["access_token"]),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_channel_has_invite_token(client, tmp_chat_dir):
    """Channel erhaelt automatisch einen invite_token bei Erstellung."""
    user = await register_user(client)
    token = user["access_token"]

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Token-Test", "channel_type": "group"},
        headers=auth_headers(token),
    )
    assert ch_resp.status_code == 201
    channel = ch_resp.json()
    assert "invite_token" in channel
    assert len(channel["invite_token"]) > 20


@pytest.mark.asyncio
async def test_invite_token_unique_per_channel(client, tmp_chat_dir):
    """Jeder Channel hat einen eindeutigen Token."""
    user = await register_user(client)
    token = user["access_token"]

    tokens = set()
    for i in range(5):
        ch_resp = await client.post(
            "/api/channels/",
            json={"name": f"Unique-{i}", "channel_type": "group"},
            headers=auth_headers(token),
        )
        tokens.add(ch_resp.json()["invite_token"])

    assert len(tokens) == 5


def test_ics_generation():
    """ICS-Datei wird korrekt generiert."""
    from app.services.ics import generate_invitation_ics

    ics_bytes = generate_invitation_ics(
        channel_name="Test-Chat",
        inviter_name="Max Mustermann",
        inviter_email="max@agora.local",
        invited_email="gast@example.com",
        invite_link="http://localhost:4200/invite/abc123",
        message="Bitte beitreten!",
    )

    assert isinstance(ics_bytes, bytes)
    ics_text = ics_bytes.decode("utf-8")
    assert "BEGIN:VCALENDAR" in ics_text
    assert "BEGIN:VEVENT" in ics_text
    assert "Test-Chat" in ics_text
    assert "Max Mustermann" in ics_text
    assert "http://localhost:4200/invite/abc123" in ics_text
    assert "Bitte beitreten!" in ics_text
    assert "END:VCALENDAR" in ics_text


def test_ics_without_message():
    """ICS-Datei ohne optionale Nachricht."""
    from app.services.ics import generate_invitation_ics

    ics_bytes = generate_invitation_ics(
        channel_name="Ohne-Msg",
        inviter_name="Anna",
        inviter_email="anna@agora.local",
        invited_email="bob@example.com",
        invite_link="http://localhost:4200/invite/xyz",
    )

    ics_text = ics_bytes.decode("utf-8")
    assert "Ohne-Msg" in ics_text
    assert "BEGIN:VEVENT" in ics_text


def test_ics_with_custom_start_time():
    """ICS-Datei mit benutzerdefinierter Startzeit."""
    from app.services.ics import generate_invitation_ics

    start = datetime(2026, 3, 15, 14, 0, tzinfo=timezone.utc)
    ics_bytes = generate_invitation_ics(
        channel_name="Zeitplan",
        inviter_name="Admin",
        inviter_email="admin@agora.local",
        invited_email="user@example.com",
        invite_link="http://localhost:4200/invite/time",
        start_time=start,
    )

    ics_text = ics_bytes.decode("utf-8")
    assert "20260315T140000Z" in ics_text
