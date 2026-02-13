import json
import uuid

from fastapi import WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from sqlalchemy import and_, select

from app.config import settings
from app.database import async_session
from app.models.channel import ChannelMember
from app.models.user import User
from app.services.chat_db import add_message
from app.services.feed import create_feed_events
from app.services.mentions import extract_mentions, resolve_mentions
from app.websocket.manager import manager


async def authenticate_ws(websocket: WebSocket) -> User | None:
    token = websocket.query_params.get("token")
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        if not user_id:
            return None

        async with async_session() as db:
            result = await db.execute(
                select(User).where(User.id == uuid.UUID(user_id))
            )
            return result.scalar_one_or_none()
    except (JWTError, ValueError):
        return None


async def websocket_endpoint(websocket: WebSocket, channel_id: str):
    user = await authenticate_ws(websocket)
    if not user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    user_id = str(user.id)

    # Check channel membership
    async with async_session() as db:
        result = await db.execute(
            select(ChannelMember).where(
                and_(
                    ChannelMember.channel_id == uuid.UUID(channel_id),
                    ChannelMember.user_id == user.id,
                )
            )
        )
        if not result.scalar_one_or_none():
            await websocket.close(code=4003, reason="Not a channel member")
            return

    await manager.connect(websocket, user_id, channel_id)

    # Notify others including user statuses
    await manager.send_to_channel(
        channel_id,
        {
            "type": "user_joined",
            "user_id": user_id,
            "display_name": user.display_name,
            "status": manager.get_user_status(user_id),
            "online_users": manager.get_online_users(channel_id),
            "user_statuses": manager.get_channel_user_statuses(channel_id),
        },
        exclude_user=user_id,
    )

    # Send current statuses to the joining user
    await websocket.send_json({
        "type": "user_statuses",
        "user_statuses": manager.get_channel_user_statuses(channel_id),
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "message":
                msg = await add_message(
                    channel_id,
                    user_id,
                    data.get("content", ""),
                    data.get("message_type", "text"),
                    data.get("file_reference_id"),
                )
                msg["sender_name"] = user.display_name

                await manager.send_to_channel(
                    channel_id,
                    {"type": "new_message", "message": msg},
                )

                # Create feed events and handle mentions
                content = data.get("content", "")
                async with async_session() as db:
                    await create_feed_events(
                        db,
                        uuid.UUID(channel_id),
                        user.id,
                        event_type="message",
                        preview_text=content[:200],
                        message_id=msg["id"],
                    )

                    # Mentions verarbeiten
                    mention_texts = extract_mentions(content)
                    if mention_texts:
                        mentioned_ids = await resolve_mentions(
                            db, mention_texts, uuid.UUID(channel_id)
                        )
                        for uid in mentioned_ids:
                            if uid != user.id:
                                await create_feed_events(
                                    db,
                                    uuid.UUID(channel_id),
                                    user.id,
                                    event_type="mention",
                                    preview_text=f"@Erwaehnung: {content[:150]}",
                                    message_id=msg["id"],
                                    target_user_id=uid,
                                )

                    await db.commit()

            elif msg_type == "typing":
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "typing",
                        "user_id": user_id,
                        "display_name": user.display_name,
                    },
                    exclude_user=user_id,
                )

            elif msg_type == "read":
                await manager.send_to_channel(
                    channel_id,
                    {"type": "read", "user_id": user_id},
                    exclude_user=user_id,
                )

            elif msg_type == "status_change":
                new_status = data.get("status", "online")
                await manager.set_user_status(user_id, new_status)
                # Persist to DB
                async with async_session() as db:
                    result = await db.execute(
                        select(User).where(User.id == user.id)
                    )
                    db_user = result.scalar_one_or_none()
                    if db_user:
                        db_user.status = new_status
                        await db.commit()

            # WebRTC signaling
            elif msg_type in ("offer", "answer", "ice-candidate"):
                target_user = data.get("target_user_id")
                if target_user and target_user in manager.active_connections.get(channel_id, {}):
                    ws = manager.active_connections[channel_id][target_user]
                    try:
                        await ws.send_json({
                            "type": msg_type,
                            "from_user_id": user_id,
                            "display_name": user.display_name,
                            **{k: v for k, v in data.items() if k not in ("type", "target_user_id")},
                        })
                    except Exception:
                        pass

            elif msg_type == "video_call_start":
                await manager.set_user_status(user_id, "busy")
                is_first = manager.join_call(channel_id, user_id)
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "video_call_start",
                        "user_id": user_id,
                        "display_name": user.display_name,
                    },
                    exclude_user=user_id,
                )
                # Create a system chat message when a call starts
                if is_first:
                    audio_only = data.get("audio_only", False)
                    call_label = "Audioanruf" if audio_only else "Videoanruf"
                    sys_msg = await add_message(
                        channel_id,
                        user_id,
                        f"{user.display_name} hat einen {call_label} gestartet",
                        "system",
                    )
                    sys_msg["sender_name"] = user.display_name
                    await manager.send_to_channel(
                        channel_id,
                        {"type": "new_message", "message": sys_msg},
                    )

            elif msg_type == "video_call_invite":
                target_user = data.get("target_user_id")
                if target_user:
                    # Send to ALL active connections of the target user
                    # so they receive the invite regardless of which channel they are viewing
                    await manager.send_to_user(target_user, {
                        "type": "video_call_invite",
                        "from_user_id": user_id,
                        "display_name": user.display_name,
                        "channel_id": channel_id,
                        "audio_only": data.get("audio_only", False),
                    })

            elif msg_type == "video_call_cancel":
                target_user = data.get("target_user_id")
                if target_user:
                    await manager.send_to_user(target_user, {
                        "type": "video_call_cancel",
                        "from_user_id": user_id,
                    })

            elif msg_type == "video_call_end":
                await manager.set_user_status(user_id, "online")
                duration_secs = manager.leave_call(channel_id, user_id)
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "video_call_end",
                        "user_id": user_id,
                    },
                )
                # If the call is now empty, create a system message with duration
                if duration_secs is not None:
                    mins = duration_secs // 60
                    secs = duration_secs % 60
                    if mins > 0:
                        duration_str = f"{mins} Min. {secs} Sek."
                    else:
                        duration_str = f"{secs} Sek."
                    sys_msg = await add_message(
                        channel_id,
                        user_id,
                        f"Anruf beendet – Dauer: {duration_str}",
                        "system",
                    )
                    sys_msg["sender_name"] = ""
                    await manager.send_to_channel(
                        channel_id,
                        {"type": "new_message", "message": sys_msg},
                    )

            elif msg_type == "screen_share_start":
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "screen_share_start",
                        "user_id": user_id,
                        "display_name": user.display_name,
                    },
                )

            elif msg_type == "screen_share_stop":
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "screen_share_stop",
                        "user_id": user_id,
                    },
                )

    except WebSocketDisconnect:
        # Clean up any active call participation
        duration_secs = manager.leave_call(channel_id, user_id)
        if duration_secs is not None:
            mins = duration_secs // 60
            secs = duration_secs % 60
            if mins > 0:
                duration_str = f"{mins} Min. {secs} Sek."
            else:
                duration_str = f"{secs} Sek."
            sys_msg = await add_message(
                channel_id,
                user_id,
                f"Anruf beendet – Dauer: {duration_str}",
                "system",
            )
            sys_msg["sender_name"] = ""
            await manager.send_to_channel(
                channel_id,
                {"type": "new_message", "message": sys_msg},
            )
        manager.disconnect(user_id, channel_id)
        # Broadcast offline if no more connections
        if user_id not in manager.user_channels:
            async with async_session() as db:
                result = await db.execute(
                    select(User).where(User.id == user.id)
                )
                db_user = result.scalar_one_or_none()
                if db_user:
                    db_user.status = "offline"
                    await db.commit()
        await manager.send_to_channel(
            channel_id,
            {
                "type": "user_left",
                "user_id": user_id,
                "status": manager.get_user_status(user_id),
                "online_users": manager.get_online_users(channel_id),
            },
        )
    except Exception:
        manager.disconnect(user_id, channel_id)
