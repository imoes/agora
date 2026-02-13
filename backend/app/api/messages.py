import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.channel import ChannelMember
from app.models.user import User
from app.schemas.message import MessageCreate, MessageOut, MessageUpdate, ReactionCreate
from app.services.auth import get_current_user
from app.services.chat_db import (
    add_message,
    add_reaction,
    delete_message,
    get_messages,
    get_reactions,
    remove_reaction,
    update_message,
)
from app.services.feed import create_feed_events
from app.services.mentions import extract_mentions, resolve_mentions

router = APIRouter(prefix="/api/channels/{channel_id}/messages", tags=["messages"])


async def _check_membership(db: AsyncSession, channel_id: uuid.UUID, user_id: uuid.UUID):
    result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == user_id,
            )
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a channel member")


@router.get("/", response_model=list[MessageOut])
async def list_messages(
    channel_id: uuid.UUID,
    limit: int = 50,
    before: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)
    messages = await get_messages(str(channel_id), limit=limit, before=before)

    # Enrich with sender names
    sender_ids = {m["sender_id"] for m in messages}
    sender_names = {}
    for sid in sender_ids:
        try:
            result = await db.execute(select(User).where(User.id == uuid.UUID(sid)))
            user = result.scalar_one_or_none()
            if user:
                sender_names[sid] = user.display_name
        except ValueError:
            pass

    return [
        MessageOut(
            id=m["id"],
            sender_id=m["sender_id"],
            sender_name=sender_names.get(m["sender_id"]),
            content=m["content"],
            message_type=m["message_type"],
            file_reference_id=m["file_reference_id"],
            created_at=m["created_at"],
            edited_at=m["edited_at"],
        )
        for m in messages
    ]


@router.post("/", response_model=MessageOut, status_code=201)
async def create_message(
    channel_id: uuid.UUID,
    data: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)

    msg = await add_message(
        str(channel_id),
        str(current_user.id),
        data.content,
        data.message_type,
        data.file_reference_id,
    )

    # Mentions parsen und aufloesen
    mention_texts = extract_mentions(data.content)
    mentioned_user_ids = await resolve_mentions(db, mention_texts, channel_id)

    # Create feed events for other channel members
    await create_feed_events(
        db,
        channel_id,
        current_user.id,
        event_type="message",
        preview_text=data.content,
        message_id=msg["id"],
    )

    # Zusaetzliche Mention-Feed-Events fuer erwaehnte User
    for uid in mentioned_user_ids:
        if uid != current_user.id:
            await create_feed_events(
                db,
                channel_id,
                current_user.id,
                event_type="mention",
                preview_text=f"@Erwaehnung: {data.content[:150]}",
                message_id=msg["id"],
                target_user_id=uid,
            )

    return MessageOut(
        id=msg["id"],
        sender_id=msg["sender_id"],
        sender_name=current_user.display_name,
        content=msg["content"],
        message_type=msg["message_type"],
        file_reference_id=msg["file_reference_id"],
        mentions=[str(uid) for uid in mentioned_user_ids],
        created_at=msg["created_at"],
        edited_at=msg["edited_at"],
    )


@router.patch("/{message_id}", response_model=MessageOut)
async def edit_message(
    channel_id: uuid.UUID,
    message_id: str,
    data: MessageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)
    msg = await update_message(str(channel_id), message_id, data.content)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return MessageOut(
        id=msg["id"],
        sender_id=msg["sender_id"],
        sender_name=current_user.display_name,
        content=msg["content"],
        message_type=msg["message_type"],
        file_reference_id=msg["file_reference_id"],
        created_at=msg["created_at"],
        edited_at=msg["edited_at"],
    )


@router.delete("/{message_id}", status_code=204)
async def remove_message(
    channel_id: uuid.UUID,
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)
    deleted = await delete_message(str(channel_id), message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")


@router.post("/{message_id}/reactions")
async def create_reaction(
    channel_id: uuid.UUID,
    message_id: str,
    data: ReactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)
    await add_reaction(str(channel_id), message_id, str(current_user.id), data.emoji)
    return {"status": "ok"}


@router.delete("/{message_id}/reactions/{emoji}")
async def delete_reaction(
    channel_id: uuid.UUID,
    message_id: str,
    emoji: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)
    await remove_reaction(str(channel_id), message_id, str(current_user.id), emoji)
    return {"status": "ok"}


@router.get("/{message_id}/reactions")
async def list_reactions(
    channel_id: uuid.UUID,
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _check_membership(db, channel_id, current_user.id)
    return await get_reactions(str(channel_id), message_id)
