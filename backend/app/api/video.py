import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.channel import ChannelMember
from app.models.user import User
from app.schemas.user import UserOut
from app.services.auth import get_current_user
from app.services.janus import janus_client

router = APIRouter(prefix="/api/video", tags=["video"])

# In-memory room tracking (in production, use Redis)
active_rooms: dict[str, dict] = {}


@router.post("/rooms")
async def create_room(
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

    channel_str = str(channel_id)

    if channel_str in active_rooms:
        return active_rooms[channel_str]

    try:
        await janus_client.create_session()
        await janus_client.attach_plugin()
        result = await janus_client.create_room(description=f"Room for {channel_str}")
        room_info = {
            "room_id": result["room_id"],
            "channel_id": channel_str,
            "janus_url": "ws://localhost:7088",
            "created_by": str(current_user.id),
            "participants": [],
        }
        active_rooms[channel_str] = room_info
        return room_info
    except Exception as e:
        # Janus might not be available, return a fallback for P2P
        room_id = abs(hash(channel_str)) % 1000000
        room_info = {
            "room_id": room_id,
            "channel_id": channel_str,
            "janus_url": None,
            "signaling": "websocket",
            "created_by": str(current_user.id),
            "participants": [],
            "note": "Janus unavailable, using P2P WebRTC signaling",
        }
        active_rooms[channel_str] = room_info
        return room_info


@router.get("/rooms/{channel_id}")
async def get_room(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
):
    channel_str = str(channel_id)
    if channel_str not in active_rooms:
        raise HTTPException(status_code=404, detail="No active room for this channel")
    return active_rooms[channel_str]


@router.delete("/rooms/{channel_id}")
async def close_room(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
):
    channel_str = str(channel_id)
    if channel_str in active_rooms:
        room = active_rooms.pop(channel_str)
        try:
            await janus_client.destroy_room(room["room_id"])
        except Exception:
            pass
        return {"status": "closed"}
    raise HTTPException(status_code=404, detail="No active room")


@router.post("/rooms/{channel_id}/join")
async def join_room(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
):
    channel_str = str(channel_id)
    if channel_str not in active_rooms:
        raise HTTPException(status_code=404, detail="No active room")

    user_id = str(current_user.id)
    if user_id not in active_rooms[channel_str]["participants"]:
        active_rooms[channel_str]["participants"].append(user_id)

    return active_rooms[channel_str]


@router.post("/rooms/{channel_id}/leave")
async def leave_room(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
):
    channel_str = str(channel_id)
    if channel_str not in active_rooms:
        raise HTTPException(status_code=404, detail="No active room")

    user_id = str(current_user.id)
    participants = active_rooms[channel_str]["participants"]
    if user_id in participants:
        participants.remove(user_id)

    # Close room if empty
    if not participants:
        active_rooms.pop(channel_str, None)
        return {"status": "room_closed"}

    return active_rooms[channel_str]
