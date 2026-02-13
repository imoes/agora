import json
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket


@dataclass
class ConnectionManager:
    active_connections: dict[str, dict[str, WebSocket]] = field(default_factory=dict)
    user_channels: dict[str, set[str]] = field(default_factory=dict)

    async def connect(self, websocket: WebSocket, user_id: str, channel_id: str):
        await websocket.accept()
        if channel_id not in self.active_connections:
            self.active_connections[channel_id] = {}
        self.active_connections[channel_id][user_id] = websocket

        if user_id not in self.user_channels:
            self.user_channels[user_id] = set()
        self.user_channels[user_id].add(channel_id)

    def disconnect(self, user_id: str, channel_id: str):
        if channel_id in self.active_connections:
            self.active_connections[channel_id].pop(user_id, None)
            if not self.active_connections[channel_id]:
                del self.active_connections[channel_id]
        if user_id in self.user_channels:
            self.user_channels[user_id].discard(channel_id)
            if not self.user_channels[user_id]:
                del self.user_channels[user_id]

    async def send_to_channel(self, channel_id: str, message: dict, exclude_user: str | None = None):
        if channel_id not in self.active_connections:
            return
        for uid, ws in self.active_connections[channel_id].items():
            if uid != exclude_user:
                try:
                    await ws.send_json(message)
                except Exception:
                    pass

    async def send_to_user(self, user_id: str, message: dict):
        for channel_id in self.user_channels.get(user_id, set()):
            if channel_id in self.active_connections:
                ws = self.active_connections[channel_id].get(user_id)
                if ws:
                    try:
                        await ws.send_json(message)
                    except Exception:
                        pass

    async def broadcast_to_user_channels(self, user_id: str, message: dict):
        for channel_id in self.user_channels.get(user_id, set()):
            await self.send_to_channel(channel_id, message)

    def get_online_users(self, channel_id: str) -> list[str]:
        if channel_id not in self.active_connections:
            return []
        return list(self.active_connections[channel_id].keys())


manager = ConnectionManager()
