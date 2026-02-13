"""Unit-Tests fuer den chat_db Service (SQLite-Operationen)."""
import pytest

from app.services.chat_db import (
    add_message,
    add_reaction,
    delete_message,
    get_messages,
    get_reactions,
    init_chat_db,
    remove_reaction,
    update_message,
)


@pytest.mark.asyncio
async def test_init_chat_db(tmp_chat_dir):
    await init_chat_db("test-channel-1")
    import os
    assert os.path.exists(os.path.join(tmp_chat_dir, "test-channel-1.db"))


@pytest.mark.asyncio
async def test_add_and_get_message(tmp_chat_dir):
    channel_id = "ch-add-get"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Hallo Welt!")
    assert msg["content"] == "Hallo Welt!"
    assert msg["sender_id"] == "user-1"
    assert msg["message_type"] == "text"
    assert msg["id"]
    assert msg["created_at"]

    messages = await get_messages(channel_id)
    assert len(messages) == 1
    assert messages[0]["content"] == "Hallo Welt!"


@pytest.mark.asyncio
async def test_get_messages_ordering(tmp_chat_dir):
    channel_id = "ch-order"
    await init_chat_db(channel_id)

    for i in range(5):
        await add_message(channel_id, "user-1", f"Msg {i}")

    messages = await get_messages(channel_id)
    assert len(messages) == 5
    # Aelteste zuerst
    assert messages[0]["content"] == "Msg 0"
    assert messages[4]["content"] == "Msg 4"


@pytest.mark.asyncio
async def test_get_messages_with_limit(tmp_chat_dir):
    channel_id = "ch-limit"
    await init_chat_db(channel_id)

    for i in range(10):
        await add_message(channel_id, "user-1", f"Msg {i}")

    messages = await get_messages(channel_id, limit=3)
    assert len(messages) == 3
    # Die letzten 3 Nachrichten
    assert messages[0]["content"] == "Msg 7"
    assert messages[2]["content"] == "Msg 9"


@pytest.mark.asyncio
async def test_get_messages_with_before(tmp_chat_dir):
    channel_id = "ch-before"
    await init_chat_db(channel_id)

    msgs = []
    for i in range(5):
        m = await add_message(channel_id, "user-1", f"Msg {i}")
        msgs.append(m)

    # Nachrichten vor der letzten Nachricht
    before = msgs[4]["created_at"]
    messages = await get_messages(channel_id, before=before)
    assert len(messages) == 4
    assert messages[-1]["content"] == "Msg 3"


@pytest.mark.asyncio
async def test_get_messages_empty_channel(tmp_chat_dir):
    messages = await get_messages("nonexistent")
    assert messages == []


@pytest.mark.asyncio
async def test_update_message(tmp_chat_dir):
    channel_id = "ch-update"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Original")
    updated = await update_message(channel_id, msg["id"], "Bearbeitet")

    assert updated is not None
    assert updated["content"] == "Bearbeitet"
    assert updated["edited_at"] is not None


@pytest.mark.asyncio
async def test_update_nonexistent_message(tmp_chat_dir):
    channel_id = "ch-upd-none"
    await init_chat_db(channel_id)

    result = await update_message(channel_id, "fake-id", "Nichts")
    assert result is None


@pytest.mark.asyncio
async def test_delete_message(tmp_chat_dir):
    channel_id = "ch-delete"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Weg damit")
    assert await delete_message(channel_id, msg["id"]) is True

    messages = await get_messages(channel_id)
    assert len(messages) == 0


@pytest.mark.asyncio
async def test_delete_nonexistent_message(tmp_chat_dir):
    channel_id = "ch-del-none"
    await init_chat_db(channel_id)

    assert await delete_message(channel_id, "fake-id") is False


@pytest.mark.asyncio
async def test_add_reaction(tmp_chat_dir):
    channel_id = "ch-react"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Reagier!")
    result = await add_reaction(channel_id, msg["id"], "user-2", "thumbsup")
    assert result is True

    reactions = await get_reactions(channel_id, msg["id"])
    assert len(reactions) == 1
    assert reactions[0]["emoji"] == "thumbsup"
    assert reactions[0]["user_id"] == "user-2"


@pytest.mark.asyncio
async def test_add_duplicate_reaction(tmp_chat_dir):
    channel_id = "ch-dup-react"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Doppelt")
    await add_reaction(channel_id, msg["id"], "user-2", "heart")
    result = await add_reaction(channel_id, msg["id"], "user-2", "heart")
    assert result is False

    reactions = await get_reactions(channel_id, msg["id"])
    assert len(reactions) == 1


@pytest.mark.asyncio
async def test_multiple_reactions_same_message(tmp_chat_dir):
    channel_id = "ch-multi-react"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Viele Reactions")
    await add_reaction(channel_id, msg["id"], "user-2", "thumbsup")
    await add_reaction(channel_id, msg["id"], "user-3", "heart")
    await add_reaction(channel_id, msg["id"], "user-2", "fire")

    reactions = await get_reactions(channel_id, msg["id"])
    assert len(reactions) == 3


@pytest.mark.asyncio
async def test_remove_reaction(tmp_chat_dir):
    channel_id = "ch-rm-react"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Entferne")
    await add_reaction(channel_id, msg["id"], "user-2", "thumbsup")

    result = await remove_reaction(channel_id, msg["id"], "user-2", "thumbsup")
    assert result is True

    reactions = await get_reactions(channel_id, msg["id"])
    assert len(reactions) == 0


@pytest.mark.asyncio
async def test_remove_nonexistent_reaction(tmp_chat_dir):
    channel_id = "ch-rm-none"
    await init_chat_db(channel_id)

    msg = await add_message(channel_id, "user-1", "Nichts da")
    result = await remove_reaction(channel_id, msg["id"], "user-2", "ghost")
    assert result is False


@pytest.mark.asyncio
async def test_message_with_file_reference(tmp_chat_dir):
    channel_id = "ch-file-ref"
    await init_chat_db(channel_id)

    msg = await add_message(
        channel_id, "user-1", "Datei angehaengt",
        message_type="file", file_reference_id="ref-123"
    )
    assert msg["message_type"] == "file"
    assert msg["file_reference_id"] == "ref-123"

    messages = await get_messages(channel_id)
    assert messages[0]["file_reference_id"] == "ref-123"
