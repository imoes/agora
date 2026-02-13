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

    # Notify others
    await manager.send_to_channel(
        channel_id,
        {
            "type": "user_joined",
            "user_id": user_id,
            "display_name": user.display_name,
            "online_users": manager.get_online_users(channel_id),
        },
        exclude_user=user_id,
    )

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

                # Create feed events
                async with async_session() as db:
                    await create_feed_events(
                        db,
                        uuid.UUID(channel_id),
                        user.id,
                        event_type="message",
                        preview_text=data.get("content", "")[:200],
                        message_id=msg["id"],
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
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "video_call_start",
                        "user_id": user_id,
                        "display_name": user.display_name,
                    },
                    exclude_user=user_id,
                )

            elif msg_type == "video_call_end":
                await manager.send_to_channel(
                    channel_id,
                    {
                        "type": "video_call_end",
                        "user_id": user_id,
                    },
                )

    except WebSocketDisconnect:
        manager.disconnect(user_id, channel_id)
        await manager.send_to_channel(
            channel_id,
            {
                "type": "user_left",
                "user_id": user_id,
                "online_users": manager.get_online_users(channel_id),
            },
        )
    except Exception:
        manager.disconnect(user_id, channel_id)
