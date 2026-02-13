import uuid
from datetime import datetime

from pydantic import BaseModel


class MessageCreate(BaseModel):
    content: str
    message_type: str = "text"  # 'text', 'file', 'system'
    file_reference_id: str | None = None


class MessageOut(BaseModel):
    id: str
    sender_id: str
    sender_name: str | None = None
    content: str
    message_type: str = "text"
    file_reference_id: str | None = None
    created_at: str
    edited_at: str | None = None


class MessageUpdate(BaseModel):
    content: str


class ReactionCreate(BaseModel):
    emoji: str


class ReactionOut(BaseModel):
    message_id: str
    user_id: str
    emoji: str


class WebSocketMessage(BaseModel):
    type: str  # 'message', 'typing', 'read', 'reaction', 'join', 'leave'
    channel_id: str | None = None
    data: dict = {}
