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
from app.websocket.manager import manager

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
        invite_token=channel.invite_token,
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
                invite_token=ch.invite_token,
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
        invite_token=channel.invite_token,
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

    # Get updated member count
    count_result = await db.execute(
        select(func.count(ChannelMember.id)).where(
            ChannelMember.channel_id == channel_id
        )
    )
    new_count = count_result.scalar() or 0

    # Get the added user's info
    added_user = await db.execute(select(User).where(User.id == user_id))
    added = added_user.scalar_one_or_none()

    # Broadcast member_added event via WebSocket
    await manager.send_to_channel(
        str(channel_id),
        {
            "type": "member_added",
            "user_id": str(user_id),
            "display_name": added.display_name if added else "",
            "username": added.username if added else "",
            "member_count": new_count,
        },
    )

    return {"status": "ok", "member_count": new_count}


from pydantic import BaseModel as _BaseModel


class DirectChatRequest(_BaseModel):
    user_id: uuid.UUID


@router.post("/direct", response_model=ChannelOut, status_code=status.HTTP_200_OK)
async def find_or_create_direct_chat(
    data: DirectChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Findet einen bestehenden Direktchat oder erstellt einen neuen."""
    target_user = await db.execute(select(User).where(User.id == data.user_id))
    target = target_user.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User nicht gefunden")

    # Suche nach einem bestehenden direct-Channel zwischen den beiden Usern
    my_directs = (
        select(ChannelMember.channel_id)
        .join(Channel, ChannelMember.channel_id == Channel.id)
        .where(
            and_(
                ChannelMember.user_id == current_user.id,
                Channel.channel_type == "direct",
            )
        )
    )
    target_directs = (
        select(ChannelMember.channel_id)
        .where(ChannelMember.user_id == data.user_id)
    )

    # Gemeinsame direct-Channels
    result = await db.execute(
        select(Channel)
        .where(
            and_(
                Channel.id.in_(my_directs),
                Channel.id.in_(target_directs),
                Channel.channel_type == "direct",
            )
        )
    )
    existing_channel = result.scalar_one_or_none()

    if existing_channel:
        count_result = await db.execute(
            select(func.count()).where(ChannelMember.channel_id == existing_channel.id)
        )
        count = count_result.scalar()
        return ChannelOut(
            id=existing_channel.id,
            name=existing_channel.name,
            description=existing_channel.description,
            channel_type=existing_channel.channel_type,
            team_id=existing_channel.team_id,
            created_at=existing_channel.created_at,
            member_count=count,
            invite_token=existing_channel.invite_token,
        )

    # Neuen direct-Channel erstellen
    channel = Channel(
        name=f"{current_user.display_name}, {target.display_name}",
        channel_type="direct",
        sqlite_db_path="",
    )
    db.add(channel)
    await db.flush()
    channel.sqlite_db_path = f"{channel.id}.db"

    db.add(ChannelMember(channel_id=channel.id, user_id=current_user.id))
    db.add(ChannelMember(channel_id=channel.id, user_id=data.user_id))
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
        member_count=2,
        invite_token=channel.invite_token,
    )
