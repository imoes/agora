import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.channel import Channel, ChannelMember
from app.models.team import Team, TeamMember
from app.models.user import User
from app.schemas.team import AddTeamMember, TeamCreate, TeamOut, TeamUpdate
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.chat_db import init_chat_db

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.post("/", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
async def create_team(
    data: TeamCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    team = Team(
        name=data.name,
        description=data.description,
        owner_id=current_user.id,
    )
    db.add(team)
    await db.flush()

    member = TeamMember(team_id=team.id, user_id=current_user.id, role="admin")
    db.add(member)

    # Create default "General" channel
    channel = Channel(
        name="General",
        channel_type="team",
        team_id=team.id,
        sqlite_db_path=f"{team.id}_general.db",
    )
    db.add(channel)
    await db.flush()

    ch_member = ChannelMember(channel_id=channel.id, user_id=current_user.id)
    db.add(ch_member)
    await db.flush()

    await init_chat_db(str(channel.id))
    await db.refresh(team)

    return TeamOut(
        id=team.id,
        name=team.name,
        description=team.description,
        avatar_path=team.avatar_path,
        owner_id=team.owner_id,
        created_at=team.created_at,
        member_count=1,
    )


@router.get("/", response_model=list[TeamOut])
async def list_teams(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Team, func.count(TeamMember.id).label("member_count"))
        .join(TeamMember, Team.id == TeamMember.team_id)
        .where(
            Team.id.in_(
                select(TeamMember.team_id).where(TeamMember.user_id == current_user.id)
            )
        )
        .group_by(Team.id)
        .order_by(Team.name)
    )
    rows = result.all()
    return [
        TeamOut(
            id=team.id,
            name=team.name,
            description=team.description,
            avatar_path=team.avatar_path,
            owner_id=team.owner_id,
            created_at=team.created_at,
            member_count=count,
        )
        for team, count in rows
    ]


@router.get("/{team_id}", response_model=TeamOut)
async def get_team(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await db.execute(
        select(TeamMember).where(
            and_(TeamMember.team_id == team_id, TeamMember.user_id == current_user.id)
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this team")

    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    count_result = await db.execute(
        select(func.count()).where(TeamMember.team_id == team_id)
    )
    count = count_result.scalar()

    return TeamOut(
        id=team.id,
        name=team.name,
        description=team.description,
        avatar_path=team.avatar_path,
        owner_id=team.owner_id,
        created_at=team.created_at,
        member_count=count,
    )


@router.patch("/{team_id}", response_model=TeamOut)
async def update_team(
    team_id: uuid.UUID,
    data: TeamUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    if team.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can update the team")

    if data.name is not None:
        team.name = data.name
    if data.description is not None:
        team.description = data.description
    await db.flush()
    await db.refresh(team)

    count_result = await db.execute(
        select(func.count()).where(TeamMember.team_id == team_id)
    )
    count = count_result.scalar()

    return TeamOut(
        id=team.id,
        name=team.name,
        description=team.description,
        avatar_path=team.avatar_path,
        owner_id=team.owner_id,
        created_at=team.created_at,
        member_count=count,
    )


@router.post("/{team_id}/members", status_code=status.HTTP_201_CREATED)
async def add_member(
    team_id: uuid.UUID,
    data: AddTeamMember,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    admin_check = await db.execute(
        select(TeamMember).where(
            and_(
                TeamMember.team_id == team_id,
                TeamMember.user_id == current_user.id,
                TeamMember.role == "admin",
            )
        )
    )
    if not admin_check.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Admin access required")

    existing = await db.execute(
        select(TeamMember).where(
            and_(TeamMember.team_id == team_id, TeamMember.user_id == data.user_id)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User is already a member")

    member = TeamMember(team_id=team_id, user_id=data.user_id, role=data.role)
    db.add(member)

    # Add to all team channels
    channels = await db.execute(
        select(Channel).where(Channel.team_id == team_id)
    )
    for channel in channels.scalars().all():
        ch_member = ChannelMember(channel_id=channel.id, user_id=data.user_id)
        db.add(ch_member)

    await db.flush()
    return {"status": "ok"}


@router.get("/{team_id}/members")
async def list_members(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TeamMember, User)
        .join(User, TeamMember.user_id == User.id)
        .where(TeamMember.team_id == team_id)
    )
    rows = result.all()
    return [
        {
            "user": UserOut.model_validate(user).model_dump(),
            "role": tm.role,
            "joined_at": tm.created_at.isoformat(),
        }
        for tm, user in rows
    ]


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    team_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if current_user.id != team.owner_id and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if user_id == team.owner_id:
        raise HTTPException(status_code=400, detail="Cannot remove the team owner")

    member = await db.execute(
        select(TeamMember).where(
            and_(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
        )
    )
    tm = member.scalar_one_or_none()
    if tm:
        await db.delete(tm)
        # Remove from team channels
        ch_members = await db.execute(
            select(ChannelMember)
            .join(Channel, ChannelMember.channel_id == Channel.id)
            .where(and_(Channel.team_id == team_id, ChannelMember.user_id == user_id))
        )
        for cm in ch_members.scalars().all():
            await db.delete(cm)
        await db.flush()
