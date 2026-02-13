import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.channel import Channel, ChannelMember
from app.models.feed import FeedEvent
from app.models.user import User
from app.schemas.channel import ChannelCreate, ChannelOut, ChannelUpdate
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.chat_db import init_chat_db

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.post("/", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    data: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    channel = Channel(
        name=data.name,
        description=data.description,
        channel_type=data.channel_type,
        team_id=data.team_id,
        sqlite_db_path="",  # will be set after flush
    )
    db.add(channel)
    await db.flush()

    channel.sqlite_db_path = f"{channel.id}.db"

    # Add creator as member
    member = ChannelMember(channel_id=channel.id, user_id=current_user.id)
    db.add(member)

    # Add other members
    for uid in data.member_ids:
        if uid != current_user.id:
            m = ChannelMember(channel_id=channel.id, user_id=uid)
            db.add(m)

    await db.flush()
    await init_chat_db(str(channel.id))
    await db.refresh(channel)

    return ChannelOut(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        channel_type=channel.channel_type,
        team_id=channel.team_id,
        created_at=channel.created_at,
        member_count=1 + len(data.member_ids),
    )


@router.get("/", response_model=list[ChannelOut])
async def list_channels(
    team_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_channels = select(ChannelMember.channel_id).where(
        ChannelMember.user_id == current_user.id
    )

    query = (
        select(Channel, func.count(ChannelMember.id).label("cnt"))
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(Channel.id.in_(my_channels))
    )
    if team_id:
        query = query.where(Channel.team_id == team_id)

    query = query.group_by(Channel.id).order_by(Channel.name)
    result = await db.execute(query)
    rows = result.all()

    channels = []
    for ch, member_count in rows:
        # Calculate unread count
        unread_result = await db.execute(
            select(func.count()).where(
                and_(
                    FeedEvent.user_id == current_user.id,
                    FeedEvent.channel_id == ch.id,
                    FeedEvent.is_read == False,
                )
            )
        )
        unread = unread_result.scalar()

        channels.append(
            ChannelOut(
                id=ch.id,
                name=ch.name,
                description=ch.description,
                channel_type=ch.channel_type,
                team_id=ch.team_id,
                created_at=ch.created_at,
                member_count=member_count,
                unread_count=unread or 0,
            )
        )

    return channels


@router.get("/{channel_id}", response_model=ChannelOut)
async def get_channel(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    membership = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a channel member")

    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    count_result = await db.execute(
        select(func.count()).where(ChannelMember.channel_id == channel_id)
    )
    count = count_result.scalar()

    return ChannelOut(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        channel_type=channel.channel_type,
        team_id=channel.team_id,
        created_at=channel.created_at,
        member_count=count,
    )


@router.get("/{channel_id}/members")
async def list_channel_members(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ChannelMember, User)
        .join(User, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == channel_id)
    )
    rows = result.all()
    return [
        {
            "user": UserOut.model_validate(user).model_dump(),
            "last_read_at": cm.last_read_at.isoformat(),
        }
        for cm, user in rows
    ]


@router.post("/{channel_id}/members/{user_id}", status_code=status.HTTP_201_CREATED)
async def add_channel_member(
    channel_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == user_id,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already a member")

    member = ChannelMember(channel_id=channel_id, user_id=user_id)
    db.add(member)
    await db.flush()
    return {"status": "ok"}
