import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, delete as sa_delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.channel import Channel, ChannelMember
from app.models.feed import FeedEvent
from app.models.team import Team
from app.models.user import User
from app.schemas.channel import ChannelCreate, ChannelOut, ChannelUpdate
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.chat_db import init_chat_db
from app.websocket.manager import manager

router = APIRouter(prefix="/api/channels", tags=["channels"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _build_channel_name(channel_id: uuid.UUID, db: AsyncSession) -> str:
    """Build a channel display name from its member list (comma-separated)."""
    result = await db.execute(
        select(User.display_name)
        .join(ChannelMember, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == channel_id)
        .order_by(User.display_name)
    )
    names = [row[0] for row in result.all()]
    return ", ".join(names)


async def _update_channel_name(channel: Channel, db: AsyncSession) -> None:
    """Recompute and persist the channel name unless it has a custom_name."""
    if channel.custom_name:
        return
    channel.name = await _build_channel_name(channel.id, db)
    await db.flush()


async def _find_channel_by_members(
    member_ids: set[uuid.UUID],
    channel_type: str,
    db: AsyncSession,
) -> Channel | None:
    """Find an existing channel whose member set matches *exactly*.

    Returns the channel or ``None``.
    """
    count = len(member_ids)

    # Subquery: channels that have exactly `count` members
    exact_count = (
        select(ChannelMember.channel_id)
        .group_by(ChannelMember.channel_id)
        .having(func.count(ChannelMember.id) == count)
    )

    # Start from channels of the right type with the right member count
    candidate_q = (
        select(Channel.id)
        .where(
            and_(
                Channel.channel_type == channel_type,
                Channel.id.in_(exact_count),
            )
        )
    )

    # Narrow down: every requested member must be present
    for uid in member_ids:
        member_sub = select(ChannelMember.channel_id).where(
            ChannelMember.user_id == uid
        )
        candidate_q = candidate_q.where(Channel.id.in_(member_sub))

    result = await db.execute(candidate_q.limit(1))
    channel_id = result.scalar_one_or_none()
    if channel_id is None:
        return None

    ch_result = await db.execute(select(Channel).where(Channel.id == channel_id))
    return ch_result.scalar_one_or_none()


async def _create_group_channel(
    member_ids: list[uuid.UUID],
    db: AsyncSession,
    name: str | None = None,
    custom_name: bool = False,
) -> Channel:
    """Create a new group channel with the given members."""
    channel = Channel(
        name=name or "",
        channel_type="group",
        sqlite_db_path="",
        custom_name=custom_name,
    )
    db.add(channel)
    await db.flush()
    channel.sqlite_db_path = f"{channel.id}.db"

    for uid in member_ids:
        db.add(ChannelMember(channel_id=channel.id, user_id=uid))
    await db.flush()

    # Compute name from members if not custom
    if not custom_name or not name:
        await _update_channel_name(channel, db)

    await init_chat_db(str(channel.id))
    await db.refresh(channel)
    return channel


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------

@router.post("/", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    data: ChannelCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    all_member_ids = list({current_user.id} | set(data.member_ids))
    has_custom_name = bool(data.name and data.name.strip())

    channel = Channel(
        name=data.name if has_custom_name else "",
        description=data.description,
        channel_type=data.channel_type,
        team_id=data.team_id,
        scheduled_at=data.scheduled_at,
        sqlite_db_path="",  # will be set after flush
        custom_name=has_custom_name,
    )
    db.add(channel)
    await db.flush()

    channel.sqlite_db_path = f"{channel.id}.db"

    for uid in all_member_ids:
        db.add(ChannelMember(channel_id=channel.id, user_id=uid))

    await db.flush()

    # Build dynamic name from members if no custom name was given
    if not has_custom_name:
        await _update_channel_name(channel, db)

    await init_chat_db(str(channel.id))
    await db.refresh(channel)

    return ChannelOut(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        channel_type=channel.channel_type,
        team_id=channel.team_id,
        created_at=channel.created_at,
        member_count=len(all_member_ids),
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
        .where(or_(Channel.is_hidden == False, Channel.is_hidden.is_(None)))
    )
    if team_id:
        query = query.where(Channel.team_id == team_id)

    query = query.group_by(Channel.id).order_by(Channel.name)
    result = await db.execute(query)
    rows = result.all()

    # Collect all team_ids to batch-fetch team names
    team_ids = {ch.team_id for ch, _ in rows if ch.team_id}
    team_names: dict = {}
    if team_ids:
        team_result = await db.execute(
            select(Team.id, Team.name).where(Team.id.in_(team_ids))
        )
        team_names = {tid: tname for tid, tname in team_result.all()}

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

        # Get last activity timestamp (latest feed event in this channel)
        activity_result = await db.execute(
            select(func.max(FeedEvent.created_at)).where(
                FeedEvent.channel_id == ch.id,
            )
        )
        last_activity = activity_result.scalar()

        channels.append(
            ChannelOut(
                id=ch.id,
                name=ch.name,
                description=ch.description,
                channel_type=ch.channel_type,
                team_id=ch.team_id,
                team_name=team_names.get(ch.team_id) if ch.team_id else None,
                created_at=ch.created_at,
                member_count=member_count,
                unread_count=unread or 0,
                invite_token=ch.invite_token,
                last_activity_at=last_activity or ch.created_at,
                scheduled_at=ch.scheduled_at,
            )
        )

    # Sort by last activity (most recent first)
    channels.sort(key=lambda c: c.last_activity_at or c.created_at, reverse=True)
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


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a channel. Only members can delete non-team channels."""
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

    # Don't allow deleting team channels (managed by team)
    if channel.channel_type == "team":
        raise HTTPException(status_code=403, detail="Team channels cannot be deleted directly")

    # Delete feed events for this channel
    await db.execute(
        sa_delete(FeedEvent).where(FeedEvent.channel_id == channel_id)
    )

    # Delete the channel (cascade deletes members, invitations)
    await db.delete(channel)
    await db.flush()


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
    # Load the channel
    ch_result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = ch_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # If this is a direct chat, we must NOT modify it.
    # Instead, create (or find) a group channel with all members + the new user.
    if channel.channel_type == "direct":
        # Collect current member ids
        members_result = await db.execute(
            select(ChannelMember.user_id).where(
                ChannelMember.channel_id == channel_id
            )
        )
        current_member_ids = {row[0] for row in members_result.all()}
        new_member_ids = current_member_ids | {user_id}

        # Check if a group channel with exactly these members already exists
        existing = await _find_channel_by_members(new_member_ids, "group", db)
        if existing:
            # Unhide if needed
            if existing.is_hidden:
                existing.is_hidden = False
                await db.flush()

            count_result = await db.execute(
                select(func.count()).where(ChannelMember.channel_id == existing.id)
            )
            count = count_result.scalar() or 0
            return {
                "status": "ok",
                "member_count": count,
                "channel_id": str(existing.id),
                "channel_type": "group",
            }

        # Create new group channel
        new_channel = await _create_group_channel(
            list(new_member_ids), db
        )

        return {
            "status": "ok",
            "member_count": len(new_member_ids),
            "channel_id": str(new_channel.id),
            "channel_type": "group",
        }

    # Normal case: add member to existing group/team/meeting channel
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

    # Update channel name dynamically
    await _update_channel_name(channel, db)

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
            "channel_name": channel.name,
        },
    )

    return {"status": "ok", "member_count": new_count}


# ---------------------------------------------------------------------------
# Leave channel
# ---------------------------------------------------------------------------

@router.delete("/{channel_id}/members/me", status_code=status.HTTP_200_OK)
async def leave_channel(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Leave a group channel. Direct and team channels cannot be left."""
    ch_result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = ch_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    if channel.channel_type in ("direct", "team"):
        raise HTTPException(
            status_code=400,
            detail="Dieser Kanal kann nicht verlassen werden",
        )

    membership = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    member = membership.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Nicht Mitglied dieses Kanals")

    await db.delete(member)
    await db.flush()

    # Update channel name
    await _update_channel_name(channel, db)

    # Get remaining member count
    count_result = await db.execute(
        select(func.count()).where(ChannelMember.channel_id == channel_id)
    )
    remaining = count_result.scalar() or 0

    # Broadcast member_left event
    await manager.send_to_channel(
        str(channel_id),
        {
            "type": "member_left",
            "user_id": str(current_user.id),
            "display_name": current_user.display_name,
            "member_count": remaining,
            "channel_name": channel.name,
        },
    )

    return {"status": "ok", "remaining_members": remaining}


# ---------------------------------------------------------------------------
# Direct chat (1:1)
# ---------------------------------------------------------------------------

from pydantic import BaseModel as _BaseModel


class DirectChatRequest(_BaseModel):
    user_id: uuid.UUID


@router.post("/direct", response_model=ChannelOut, status_code=status.HTTP_200_OK)
async def find_or_create_direct_chat(
    data: DirectChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Findet einen bestehenden Direktchat oder erstellt einen neuen.

    Only matches direct channels with *exactly* 2 members (the two users).
    """
    target_user = await db.execute(select(User).where(User.id == data.user_id))
    target = target_user.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User nicht gefunden")

    # Use set-based dedup: find a direct channel with exactly these 2 members
    existing = await _find_channel_by_members(
        {current_user.id, data.user_id}, "direct", db
    )

    if existing:
        # Unhide if it was hidden (e.g. from a video call)
        if existing.is_hidden:
            existing.is_hidden = False
            await db.flush()
        count_result = await db.execute(
            select(func.count()).where(ChannelMember.channel_id == existing.id)
        )
        count = count_result.scalar()
        return ChannelOut(
            id=existing.id,
            name=existing.name,
            description=existing.description,
            channel_type=existing.channel_type,
            team_id=existing.team_id,
            created_at=existing.created_at,
            member_count=count,
            invite_token=existing.invite_token,
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
