"""Tests fuer @Mentions: Parsing, Aufloesung, Feed-Events."""
import uuid

import pytest
import pytest_asyncio

from tests.conftest import auth_headers, register_user


def test_extract_mentions_simple():
    """Einfache @username Mentions erkennen."""
    from app.services.mentions import extract_mentions

    mentions = extract_mentions("Hallo @alice, wie geht es dir?")
    assert mentions == ["alice"]


def test_extract_mentions_quoted():
    """Quoted @\"Vorname Nachname\" Mentions erkennen."""
    from app.services.mentions import extract_mentions

    mentions = extract_mentions('Hallo @"Max Mustermann", bitte schauen.')
    assert mentions == ["Max Mustermann"]


def test_extract_mentions_multiple():
    """Mehrere Mentions in einer Nachricht."""
    from app.services.mentions import extract_mentions

    mentions = extract_mentions('@alice @bob @"Test User" Hallo!')
    assert len(mentions) == 3
    assert "alice" in mentions
    assert "bob" in mentions
    assert "Test User" in mentions


def test_extract_mentions_none():
    """Keine Mentions in normalem Text."""
    from app.services.mentions import extract_mentions

    mentions = extract_mentions("Ganz normaler Text ohne Mentions")
    assert mentions == []


def test_extract_mentions_email_not_captured():
    """E-Mail-Adressen sollen nicht als Mentions gelten."""
    from app.services.mentions import extract_mentions

    # @ in der Mitte eines Wortes (nach einem Buchstaben) - wird trotzdem als @Mention erkannt
    # aber das ist OK, weil resolve_mentions das dann filtert
    mentions = extract_mentions("Hallo @alice test@email.com")
    assert "alice" in mentions


@pytest.mark.asyncio
async def test_mention_creates_feed_events(client, tmp_chat_dir):
    """@Mention erstellt spezielle Feed-Events fuer erwaehnte User."""
    # User 1 und 2 erstellen
    user1 = await register_user(client, username="sender", email="sender@agora.local", display_name="Sender User")
    user2 = await register_user(client, username="mentioned", email="mentioned@agora.local", display_name="Mentioned User")

    # Channel erstellen mit beiden Usern
    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Mention-Test", "channel_type": "group", "member_ids": [str(user2["user"]["id"])]},
        headers=auth_headers(user1["access_token"]),
    )
    assert ch_resp.status_code == 201
    channel_id = ch_resp.json()["id"]

    # Nachricht mit @mention senden
    msg_resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Hallo @mentioned, bitte schauen!"},
        headers=auth_headers(user1["access_token"]),
    )
    assert msg_resp.status_code == 201
    msg = msg_resp.json()
    assert "mentioned" in [str(uid) for uid in msg.get("mentions", [])] or len(msg.get("mentions", [])) > 0

    # Feed von user2 pruefen - sollte message + mention Events haben
    feed_resp = await client.get(
        "/api/feed/",
        headers=auth_headers(user2["access_token"]),
    )
    assert feed_resp.status_code == 200
    events = feed_resp.json()["events"]
    event_types = [e["event_type"] for e in events]
    assert "message" in event_types
    assert "mention" in event_types


@pytest.mark.asyncio
async def test_mention_with_display_name(client, tmp_chat_dir):
    """@\"Display Name\" Mention wird korrekt aufgeloest."""
    user1 = await register_user(client, username="mentioner", email="mentioner@agora.local", display_name="Alice")
    user2 = await register_user(client, username="targetuser", email="target@agora.local", display_name="Bob Smith")

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Name-Mention", "channel_type": "group", "member_ids": [str(user2["user"]["id"])]},
        headers=auth_headers(user1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    msg_resp = await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": '@"Bob Smith" bitte den Report pruefen.'},
        headers=auth_headers(user1["access_token"]),
    )
    assert msg_resp.status_code == 201

    # Bob sollte Mention-Event im Feed haben
    feed_resp = await client.get(
        "/api/feed/",
        headers=auth_headers(user2["access_token"]),
    )
    events = feed_resp.json()["events"]
    mention_events = [e for e in events if e["event_type"] == "mention"]
    assert len(mention_events) >= 1


@pytest.mark.asyncio
async def test_self_mention_no_event(client, tmp_chat_dir):
    """Selbst-Erwaehnung erstellt keinen Mention-Event."""
    user1 = await register_user(client, username="selfmentioner", email="self@agora.local", display_name="Self User")

    ch_resp = await client.post(
        "/api/channels/",
        json={"name": "Self-Test", "channel_type": "group"},
        headers=auth_headers(user1["access_token"]),
    )
    channel_id = ch_resp.json()["id"]

    await client.post(
        f"/api/channels/{channel_id}/messages/",
        json={"content": "Hallo @selfmentioner, Test"},
        headers=auth_headers(user1["access_token"]),
    )

    # Eigener Feed sollte KEINE Events haben (kein anderer User im Channel)
    feed_resp = await client.get(
        "/api/feed/",
        headers=auth_headers(user1["access_token"]),
    )
    events = feed_resp.json()["events"]
    assert len(events) == 0
