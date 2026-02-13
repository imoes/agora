import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.user import UserOut


class TeamCreate(BaseModel):
    name: str
    description: str | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class TeamMemberOut(BaseModel):
    user: UserOut
    role: str
    joined_at: datetime

    model_config = {"from_attributes": True}


class TeamOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None = None
    avatar_path: str | None = None
    owner_id: uuid.UUID
    created_at: datetime
    member_count: int = 0

    model_config = {"from_attributes": True}


class TeamDetail(TeamOut):
    members: list[TeamMemberOut] = []


class AddTeamMember(BaseModel):
    user_id: uuid.UUID
    role: str = "member"
