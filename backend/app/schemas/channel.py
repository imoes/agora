import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.user import UserOut


class ChannelCreate(BaseModel):
    name: str
    description: str | None = None
    channel_type: str = "group"  # 'direct', 'group', 'team', 'meeting'
    team_id: uuid.UUID | None = None
    member_ids: list[uuid.UUID] = []
    scheduled_at: datetime | None = None  # For meeting channels


class ChannelUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ChannelMemberOut(BaseModel):
    user: UserOut
    last_read_at: datetime

    model_config = {"from_attributes": True}


class ChannelOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None = None
    channel_type: str
    team_id: uuid.UUID | None = None
    team_name: str | None = None
    created_at: datetime
    member_count: int = 0
    unread_count: int = 0
    invite_token: str | None = None
    last_activity_at: datetime | None = None
    scheduled_at: datetime | None = None

    model_config = {"from_attributes": True}


class ChannelDetail(ChannelOut):
    members: list[ChannelMemberOut] = []
