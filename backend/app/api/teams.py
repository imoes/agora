import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("agora.teams")
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.channel import Channel, ChannelMember
from app.models.team import Team, TeamMember
from app.models.user import User
from app.schemas.team import AddTeamMember, TeamCreate, TeamOut, TeamUpdate
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.chat_db import init_chat_db
from app.websocket.manager import manager

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
        sqlite_db_path="",  # will be set after flush
    )
    db.add(channel)
    await db.flush()

    # Set the sqlite_db_path to match what init_chat_db expects
    channel.sqlite_db_path = f"{channel.id}.db"

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
    logger.warning("[list_teams] user_id=%s", current_user.id)

    # Debug: check raw team memberships for this user
    debug_memberships = await db.execute(
        select(TeamMember.team_id, TeamMember.role).where(
            TeamMember.user_id == current_user.id
        )
    )
    debug_rows = debug_memberships.all()
    logger.warning("[list_teams] user %s has %d team memberships: %s",
                   current_user.id, len(debug_rows),
                   [(str(tid), role) for tid, role in debug_rows])

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
    logger.warning("[list_teams] returning %d teams for user %s: %s",
                   len(rows), current_user.id,
                   [(str(t.id), t.name, c) for t, c in rows])
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

    logger.warning("[add_member] Adding user %s to team %s with role %s",
                   data.user_id, team_id, data.role)

    member = TeamMember(team_id=team_id, user_id=data.user_id, role=data.role)
    db.add(member)

    # Add to all team channels (unsubscribed by default so they don't flood the feed)
    channels_result = await db.execute(
        select(Channel).where(Channel.team_id == team_id)
    )
    team_channels = channels_result.scalars().all()
    logger.warning("[add_member] Adding user to %d team channels", len(team_channels))
    for channel in team_channels:
        ch_member = ChannelMember(
            channel_id=channel.id,
            user_id=data.user_id,
            is_subscribed=False,
        )
        db.add(ch_member)

    await db.flush()
    logger.warning("[add_member] Flushed to DB")

    # Fetch team name for notification
    team_result = await db.execute(select(Team).where(Team.id == team_id))
    team = team_result.scalar_one_or_none()

    # Fetch added user's info
    added_user_result = await db.execute(select(User).where(User.id == data.user_id))
    added_user = added_user_result.scalar_one_or_none()

    # Commit BEFORE sending WebSocket notifications so that when clients
    # reload their team/channel lists the new data is already visible.
    await db.commit()
    logger.warning("[add_member] Committed to DB")

    # Check if user has notification connection
    user_id_str = str(data.user_id)
    has_notif = user_id_str in manager.notification_connections
    has_channels = user_id_str in manager.user_channels
    logger.warning("[add_member] User %s: has_notif_ws=%s, has_channel_ws=%s",
                   user_id_str, has_notif, has_channels)

    # Notify added user to refresh their team/channel list
    await manager.send_to_user(user_id_str, {
        "type": "team_member_added",
        "team_id": str(team_id),
        "team_name": team.name if team else "",
    })
    logger.warning("[add_member] Sent team_member_added notification to user %s", user_id_str)

    # Broadcast member_added to all team channels so existing members see updated counts
    for channel in team_channels:
        count_result = await db.execute(
            select(func.count(ChannelMember.id)).where(
                ChannelMember.channel_id == channel.id
            )
        )
        count = count_result.scalar() or 0
        await manager.send_to_channel(
            str(channel.id),
            {
                "type": "member_added",
                "user_id": str(data.user_id),
                "display_name": added_user.display_name if added_user else "",
                "member_count": count,
                "channel_name": channel.name,
            },
        )

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
    members = []
    for tm, user in rows:
        user_data = UserOut.model_validate(user).model_dump()
        # Override DB status with live in-memory status
        uid = str(user.id)
        user_data["status"] = manager.get_user_status(uid) if manager.is_user_connected(uid) else "offline"
        members.append({
            "user": user_data,
            "role": tm.role,
            "joined_at": tm.created_at.isoformat(),
        })
    return members


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


@router.post("/{team_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_team(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    if current_user.id == team.owner_id:
        raise HTTPException(status_code=400, detail="Team owner cannot leave. Transfer ownership or delete the team.")

    member = await db.execute(
        select(TeamMember).where(
            and_(TeamMember.team_id == team_id, TeamMember.user_id == current_user.id)
        )
    )
    tm = member.scalar_one_or_none()
    if not tm:
        raise HTTPException(status_code=404, detail="Not a member of this team")

    await db.delete(tm)

    # Remove from team channels
    ch_members = await db.execute(
        select(ChannelMember)
        .join(Channel, ChannelMember.channel_id == Channel.id)
        .where(and_(Channel.team_id == team_id, ChannelMember.user_id == current_user.id))
    )
    for cm in ch_members.scalars().all():
        await db.delete(cm)
    await db.flush()


@router.get("/debug/all-memberships")
async def debug_all_memberships(
    db: AsyncSession = Depends(get_db),
):
    """Temporary debug endpoint to inspect all team memberships."""
    result = await db.execute(
        select(TeamMember, Team.name, User.email, User.display_name)
        .join(Team, TeamMember.team_id == Team.id)
        .join(User, TeamMember.user_id == User.id)
    )
    rows = result.all()
    logger.warning("[debug] ALL team memberships (%d total):", len(rows))
    memberships = []
    for tm, team_name, email, display_name in rows:
        entry = {
            "team_id": str(tm.team_id),
            "team_name": team_name,
            "user_id": str(tm.user_id),
            "user_email": email,
            "display_name": display_name,
            "role": tm.role,
        }
        logger.warning("[debug]   %s", entry)
        memberships.append(entry)
    return memberships
