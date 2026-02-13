import random
import uuid

import httpx

from app.config import settings


class JanusClient:
    def __init__(self):
        self.base_url = settings.janus_url
        self.api_secret = settings.janus_api_secret
        self._session_id: int | None = None
        self._handle_id: int | None = None

    async def _request(self, data: dict) -> dict:
        data["transaction"] = str(uuid.uuid4())[:12]
        if self.api_secret:
            data["apisecret"] = self.api_secret

        async with httpx.AsyncClient() as client:
            url = self.base_url
            if self._session_id:
                url += f"/{self._session_id}"
                if self._handle_id:
                    url += f"/{self._handle_id}"
            resp = await client.post(url, json=data, timeout=10.0)
            return resp.json()

    async def create_session(self) -> int:
        result = await self._request({"janus": "create"})
        self._session_id = result["data"]["id"]
        return self._session_id

    async def attach_plugin(self, plugin: str = "janus.plugin.videoroom") -> int:
        result = await self._request({"janus": "attach", "plugin": plugin})
        self._handle_id = result["data"]["id"]
        return self._handle_id

    async def create_room(self, room_id: int | None = None, description: str = "") -> dict:
        if room_id is None:
            room_id = random.randint(100000, 999999)

        result = await self._request({
            "janus": "message",
            "body": {
                "request": "create",
                "room": room_id,
                "description": description,
                "publishers": 20,
                "bitrate": 512000,
                "fir_freq": 10,
                "audiocodec": "opus",
                "videocodec": "vp8",
                "record": False,
            },
        })
        return {"room_id": room_id, "result": result}

    async def destroy_room(self, room_id: int) -> dict:
        return await self._request({
            "janus": "message",
            "body": {
                "request": "destroy",
                "room": room_id,
            },
        })

    async def list_rooms(self) -> dict:
        return await self._request({
            "janus": "message",
            "body": {"request": "list"},
        })


janus_client = JanusClient()
