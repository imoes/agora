import uuid
from datetime import datetime

from pydantic import BaseModel


class AttendeeInput(BaseModel):
    email: str


class EventAttendeeOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str | None = None
    status: str = "pending"
    is_external: bool = False

    model_config = {"from_attributes": True}


class CalendarEventCreate(BaseModel):
    title: str
    description: str | None = None
    start_time: datetime
    end_time: datetime
    all_day: bool = False
    location: str | None = None
    channel_id: uuid.UUID | None = None
    create_video_call: bool = False
    attendees: list[AttendeeInput] = []


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
    attendees: list[EventAttendeeOut] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CalendarIntegrationCreate(BaseModel):
    provider: str  # 'internal', 'webdav', 'google', 'outlook'
    webdav_url: str | None = None
    webdav_username: str | None = None
    webdav_password: str | None = None
    google_email: str | None = None
    google_app_password: str | None = None
    outlook_server_url: str | None = None
    outlook_username: str | None = None
    outlook_password: str | None = None


class CalendarIntegrationOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    provider: str
    webdav_url: str | None = None
    webdav_username: str | None = None
    google_email: str | None = None
    google_connected: bool = False
    outlook_server_url: str | None = None
    outlook_username: str | None = None
    last_sync_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_integration(cls, obj: "CalendarIntegrationOut") -> "CalendarIntegrationOut":
        """Build from ORM object, computing google_connected."""
        data = {c: getattr(obj, c) for c in cls.model_fields if hasattr(obj, c)}
        data["google_connected"] = bool(getattr(obj, "google_refresh_token", None))
        return cls(**data)
