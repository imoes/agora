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
    get_reactions_for_messages,
    remove_reaction,
    update_message,
)
from app.services.feed import create_feed_events
from app.services.mentions import extract_mentions, resolve_mentions
from app.websocket.manager import manager

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

    # Enrich with sender info (name, avatar, status)
    sender_ids = {m["sender_id"] for m in messages}
    sender_info: dict[str, dict] = {}
    for sid in sender_ids:
        try:
            result = await db.execute(select(User).where(User.id == uuid.UUID(sid)))
            user = result.scalar_one_or_none()
            if user:
                sender_info[sid] = {
                    "name": user.display_name,
                    "avatar_path": user.avatar_path,
                    "status": user.status or "offline",
                }
        except ValueError:
            pass

    # Load reactions for all messages
    msg_ids = [m["id"] for m in messages]
    reactions_map = await get_reactions_for_messages(str(channel_id), msg_ids)

    # Enrich reactions with display names
    reaction_user_ids = set()
    for rlist in reactions_map.values():
        for r in rlist:
            reaction_user_ids.add(r.get("user_id"))
    reaction_user_ids -= set(sender_info.keys())
    for rid in reaction_user_ids:
        try:
            result = await db.execute(select(User).where(User.id == uuid.UUID(rid)))
            user = result.scalar_one_or_none()
            if user:
                sender_info[rid] = {
                    "name": user.display_name,
                    "avatar_path": user.avatar_path,
                    "status": user.status or "offline",
                }
        except ValueError:
            pass
    enriched_reactions: dict[str, list[dict]] = {}
    for mid, rlist in reactions_map.items():
        enriched_reactions[mid] = [
            {**r, "display_name": (sender_info.get(r.get("user_id")) or {}).get("name", "")}
            for r in rlist
        ]

    return [
        MessageOut(
            id=m["id"],
            sender_id=m["sender_id"],
            sender_name=(sender_info.get(m["sender_id"]) or {}).get("name"),
            sender_avatar_path=(sender_info.get(m["sender_id"]) or {}).get("avatar_path"),
            sender_status=(sender_info.get(m["sender_id"]) or {}).get("status", "offline"),
            content=m["content"],
            message_type=m["message_type"],
            file_reference_id=m["file_reference_id"],
            reactions=enriched_reactions.get(m["id"], []),
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

    # Broadcast via WebSocket so all channel members see the message in real-time
    msg["sender_name"] = current_user.display_name
    msg["sender_avatar_path"] = current_user.avatar_path
    msg["sender_status"] = current_user.status or "offline"
    await manager.send_to_channel(
        str(channel_id),
        {"type": "new_message", "message": msg},
    )

    return MessageOut(
        id=msg["id"],
        sender_id=msg["sender_id"],
        sender_name=current_user.display_name,
        sender_avatar_path=current_user.avatar_path,
        sender_status=current_user.status or "offline",
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
        sender_avatar_path=current_user.avatar_path,
        sender_status=current_user.status or "offline",
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
    added = await add_reaction(str(channel_id), message_id, str(current_user.id), data.emoji)

    if added:
        # Create feed event for reaction
        await create_feed_events(
            db,
            channel_id,
            current_user.id,
            event_type="reaction",
            preview_text=f"{data.emoji} Reaktion",
            message_id=message_id,
        )
        await db.commit()

        # Broadcast to channel via WebSocket
        await manager.send_to_channel(
            str(channel_id),
            {
                "type": "reaction_update",
                "message_id": message_id,
                "user_id": str(current_user.id),
                "display_name": current_user.display_name,
                "emoji": data.emoji,
                "action": "add",
            },
        )

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
    removed = await remove_reaction(str(channel_id), message_id, str(current_user.id), emoji)

    if removed:
        await manager.send_to_channel(
            str(channel_id),
            {
                "type": "reaction_update",
                "message_id": message_id,
                "user_id": str(current_user.id),
                "emoji": emoji,
                "action": "remove",
            },
        )

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
