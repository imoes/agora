import uuid
from datetime import datetime

from pydantic import BaseModel


class CalendarEventCreate(BaseModel):
    title: str
    description: str | None = None
    start_time: datetime
    end_time: datetime
    all_day: bool = False
    location: str | None = None
    channel_id: uuid.UUID | None = None
    create_video_call: bool = False


class CalendarEventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    all_day: bool | None = None
    location: str | None = None
    channel_id: uuid.UUID | None = None


class CalendarEventOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    description: str | None = None
    start_time: datetime
    end_time: datetime
    all_day: bool = False
    location: str | None = None
    channel_id: uuid.UUID | None = None
    external_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CalendarIntegrationCreate(BaseModel):
    provider: str  # 'internal', 'webdav', 'google', 'outlook'
    webdav_url: str | None = None
    webdav_username: str | None = None
    webdav_password: str | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_refresh_token: str | None = None
    google_calendar_id: str | None = None
    outlook_server_url: str | None = None
    outlook_username: str | None = None
    outlook_password: str | None = None


class CalendarIntegrationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    provider: str
    webdav_url: str | None = None
    webdav_username: str | None = None
    google_client_id: str | None = None
    google_calendar_id: str | None = None
    outlook_server_url: str | None = None
    outlook_username: str | None = None
    last_sync_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
