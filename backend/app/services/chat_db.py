import os
import uuid
from datetime import datetime, timezone

import aiosqlite

from app.config import settings

CHAT_SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    file_reference_id TEXT,
    created_at TEXT NOT NULL,
    edited_at TEXT
);

CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    UNIQUE(message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
"""


def _db_path(channel_id: str) -> str:
    return os.path.join(settings.chat_db_dir, f"{channel_id}.db")


async def init_chat_db(channel_id: str) -> None:
    os.makedirs(settings.chat_db_dir, exist_ok=True)
    path = _db_path(channel_id)
    async with aiosqlite.connect(path) as db:
        await db.executescript(CHAT_SCHEMA)
        await db.commit()


async def add_message(
    channel_id: str,
    sender_id: str,
    content: str,
    message_type: str = "text",
    file_reference_id: str | None = None,
) -> dict:
    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    path = _db_path(channel_id)

    async with aiosqlite.connect(path) as db:
        await db.execute(
            """INSERT INTO messages (id, sender_id, content, message_type, file_reference_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (msg_id, sender_id, content, message_type, file_reference_id, now),
        )
        await db.commit()

    return {
        "id": msg_id,
        "sender_id": sender_id,
        "content": content,
        "message_type": message_type,
        "file_reference_id": file_reference_id,
        "created_at": now,
        "edited_at": None,
    }


async def get_messages(
    channel_id: str,
    limit: int = 50,
    before: str | None = None,
) -> list[dict]:
    path = _db_path(channel_id)
    if not os.path.exists(path):
        return []

    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        if before:
            cursor = await db.execute(
                """SELECT * FROM messages WHERE created_at < ?
                   ORDER BY created_at DESC LIMIT ?""",
                (before, limit),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM messages ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
        rows = await cursor.fetchall()
        return [dict(row) for row in reversed(rows)]


async def update_message(channel_id: str, message_id: str, content: str) -> dict | None:
    path = _db_path(channel_id)
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            "UPDATE messages SET content = ?, edited_at = ? WHERE id = ?",
            (content, now, message_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def delete_message(channel_id: str, message_id: str) -> bool:
    path = _db_path(channel_id)
    async with aiosqlite.connect(path) as db:
        cursor = await db.execute("DELETE FROM messages WHERE id = ?", (message_id,))
        await db.commit()
        return cursor.rowcount > 0


async def add_reaction(
    channel_id: str, message_id: str, user_id: str, emoji: str
) -> bool:
    path = _db_path(channel_id)
    async with aiosqlite.connect(path) as db:
        try:
            await db.execute(
                """INSERT INTO reactions (message_id, user_id, emoji)
                   VALUES (?, ?, ?)""",
                (message_id, user_id, emoji),
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False


async def remove_reaction(
    channel_id: str, message_id: str, user_id: str, emoji: str
) -> bool:
    path = _db_path(channel_id)
    async with aiosqlite.connect(path) as db:
        cursor = await db.execute(
            "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
            (message_id, user_id, emoji),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_reactions(channel_id: str, message_id: str) -> list[dict]:
    path = _db_path(channel_id)
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM reactions WHERE message_id = ?", (message_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]
