import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.feed import FeedMarkRead
from app.services.auth import get_current_user
from app.services.feed import get_feed, get_unread_count, mark_feed_read

router = APIRouter(prefix="/api/feed", tags=["feed"])


@router.get("/")
async def list_feed(
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    events = await get_feed(db, current_user.id, limit, offset, unread_only)
    unread = await get_unread_count(db, current_user.id)
    return {"events": events, "unread_count": unread}


@router.post("/read")
async def mark_read(
    data: FeedMarkRead,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await mark_feed_read(
        db, current_user.id, data.event_ids or None, data.channel_id
    )
    return {"marked_read": count}


@router.get("/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await get_unread_count(db, current_user.id)
    return {"unread_count": count}
