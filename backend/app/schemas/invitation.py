import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class InvitationCreate(BaseModel):
    email: EmailStr
    message: str | None = None


class InvitationOut(BaseModel):
    id: uuid.UUID
    channel_id: uuid.UUID
    channel_name: str | None = None
    invited_by: uuid.UUID
    inviter_name: str | None = None
    invited_email: str
    message: str | None = None
    status: str
    expires_at: datetime
    created_at: datetime
    email_sent: bool

    model_config = {"from_attributes": True}


class InviteAcceptResponse(BaseModel):
    channel_id: uuid.UUID
    channel_name: str
    status: str
