import uuid
from datetime import datetime

from pydantic import BaseModel


class FeedEventOut(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    sender_id: uuid.UUID
    sender_name: str | None = None
    channel_name: str | None = None
    event_type: str
    preview_text: str | None = None
    message_id: str | None = None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class FeedMarkRead(BaseModel):
    event_ids: list[uuid.UUID] = []
    channel_id: uuid.UUID | None = None
