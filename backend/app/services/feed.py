import uuid

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel, ChannelMember
from app.models.feed import FeedEvent
from app.models.user import User


async def create_feed_events(
    db: AsyncSession,
    channel_id: uuid.UUID,
    sender_id: uuid.UUID,
    event_type: str,
    preview_text: str | None,
    message_id: str | None = None,
) -> list[FeedEvent]:
    result = await db.execute(
        select(ChannelMember.user_id).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id != sender_id,
            )
        )
    )
    member_ids = [row[0] for row in result.all()]

    events = []
    for uid in member_ids:
        event = FeedEvent(
            user_id=uid,
            channel_id=channel_id,
            sender_id=sender_id,
            event_type=event_type,
            preview_text=(preview_text[:200] if preview_text else None),
            message_id=message_id,
        )
        db.add(event)
        events.append(event)

    await db.flush()
    return events


async def get_feed(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
) -> list[dict]:
    query = (
        select(FeedEvent, User.display_name, Channel.name)
        .join(User, FeedEvent.sender_id == User.id)
        .join(Channel, FeedEvent.channel_id == Channel.id)
        .where(FeedEvent.user_id == user_id)
    )
    if unread_only:
        query = query.where(FeedEvent.is_read == False)

    query = query.order_by(FeedEvent.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    return [
        {
            "id": str(event.id),
            "channel_id": str(event.channel_id),
            "sender_id": str(event.sender_id),
            "sender_name": sender_name,
            "channel_name": channel_name,
            "event_type": event.event_type,
            "preview_text": event.preview_text,
            "message_id": event.message_id,
            "is_read": event.is_read,
            "created_at": event.created_at.isoformat(),
        }
        for event, sender_name, channel_name in rows
    ]


async def mark_feed_read(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_ids: list[uuid.UUID] | None = None,
    channel_id: uuid.UUID | None = None,
) -> int:
    stmt = update(FeedEvent).where(
        and_(FeedEvent.user_id == user_id, FeedEvent.is_read == False)
    )
    if event_ids:
        stmt = stmt.where(FeedEvent.id.in_(event_ids))
    if channel_id:
        stmt = stmt.where(FeedEvent.channel_id == channel_id)

    stmt = stmt.values(is_read=True)
    result = await db.execute(stmt)
    return result.rowcount


async def get_unread_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    result = await db.execute(
        select(FeedEvent)
        .where(and_(FeedEvent.user_id == user_id, FeedEvent.is_read == False))
    )
    return len(result.all())
