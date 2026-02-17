"""Tests fuer Team-Channel-Nachrichten und init_chat_db-Absicherung.

Testet, dass Nachrichten in Team-Channels zuverlaessig erstellt werden,
inklusive Reply-Felder und defensivem init_chat_db-Aufruf.
"""
import os
import pytest

from app.services.chat_db import (
    add_message,
    get_messages,
    init_chat_db,
)


@pytest.mark.asyncio
async def test_send_message_after_init(tmp_chat_dir):
    """Nachricht kann nach init_chat_db gesendet werden."""
    channel_id = "team-ch-1"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Hallo Team!")
    assert msg["content"] == "Hallo Team!"
    assert msg["sender_id"] == "user-1"
    assert msg["message_type"] == "text"

    messages = await get_messages(channel_id)
    assert len(messages) == 1
    assert messages[0]["content"] == "Hallo Team!"


@pytest.mark.asyncio
async def test_init_chat_db_idempotent(tmp_chat_dir):
    """Mehrfaches Aufrufen von init_chat_db ist sicher (idempotent)."""
    channel_id = "team-ch-idempotent"

    await init_chat_db(channel_id)
    msg1 = await add_message(channel_id, "user-1", "Erste Nachricht")

    # Nochmal init aufrufen (wie bei HTTP-Endpoint defensiv)
    await init_chat_db(channel_id)
    msg2 = await add_message(channel_id, "user-1", "Zweite Nachricht")

    messages = await get_messages(channel_id)
    assert len(messages) == 2
    assert messages[0]["content"] == "Erste Nachricht"
    assert messages[1]["content"] == "Zweite Nachricht"


@pytest.mark.asyncio
async def test_defensive_init_before_send(tmp_chat_dir):
    """Defensiver init_chat_db-Aufruf vor add_message erstellt fehlende DB."""
    channel_id = "team-ch-defensive"

    # Erst defensiv init aufrufen, dann senden
    await init_chat_db(channel_id)
    msg = await add_message(channel_id, "user-1", "Defensive Nachricht")
    assert msg["content"] == "Defensive Nachricht"

    messages = await get_messages(channel_id)
    assert len(messages) == 1


@pytest.mark.asyncio
async def test_message_without_init_fails(tmp_chat_dir):
    """Nachricht ohne init_chat_db schlaegt fehl (kein Table)."""
    channel_id = "team-ch-no-init"

    with pytest.raises(Exception):
        await add_message(channel_id, "user-1", "Sollte fehlschlagen")


@pytest.mark.asyncio
async def test_send_message_with_reply_fields(tmp_chat_dir):
    """Nachrichten mit Reply-Feldern werden korrekt gespeichert."""
    channel_id = "team-ch-reply"
    await init_chat_db(channel_id)

    # Originalnachricht
    original = await add_message(channel_id, "user-1", "Originaltext")

    # Antwort mit Reply-Feldern
    reply = await add_message(
        channel_id,
        "user-2",
        "Das ist eine Antwort",
        reply_to_id=original["id"],
        reply_to_content="Originaltext",
        reply_to_sender="User Eins",
    )
    assert reply["reply_to_id"] == original["id"]
    assert reply["reply_to_content"] == "Originaltext"
    assert reply["reply_to_sender"] == "User Eins"

    # Pruefen, dass Reply-Felder beim Abruf vorhanden sind
    messages = await get_messages(channel_id)
    assert len(messages) == 2
    reply_msg = messages[1]
    assert reply_msg["reply_to_id"] == original["id"]
    assert reply_msg["reply_to_content"] == "Originaltext"
    assert reply_msg["reply_to_sender"] == "User Eins"


@pytest.mark.asyncio
async def test_send_rich_text_message(tmp_chat_dir):
    """Rich-Text Nachrichten werden korrekt gespeichert."""
    channel_id = "team-ch-rich"
    await init_chat_db(channel_id)

    msg = await add_message(
        channel_id,
        "user-1",
        "<p><b>Fett</b> und <i>kursiv</i></p>",
        message_type="rich",
    )
    assert msg["message_type"] == "rich"
    assert "<b>Fett</b>" in msg["content"]


@pytest.mark.asyncio
async def test_multiple_users_can_send(tmp_chat_dir):
    """Mehrere Benutzer koennen in denselben Channel senden."""
    channel_id = "team-ch-multi"
    await init_chat_db(channel_id)

    await add_message(channel_id, "user-1", "Von User 1")
    await add_message(channel_id, "user-2", "Von User 2")
    await add_message(channel_id, "user-3", "Von User 3")

    messages = await get_messages(channel_id)
    assert len(messages) == 3
    assert messages[0]["sender_id"] == "user-1"
    assert messages[1]["sender_id"] == "user-2"
    assert messages[2]["sender_id"] == "user-3"


@pytest.mark.asyncio
async def test_init_creates_db_file(tmp_chat_dir):
    """init_chat_db erstellt die SQLite-Datei im chat_db_dir."""
    channel_id = "team-ch-file"
    await init_chat_db(channel_id)

    db_path = os.path.join(tmp_chat_dir, f"{channel_id}.db")
    assert os.path.exists(db_path)
