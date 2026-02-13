from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, channels, feed, files, invitations, messages, teams, users, video
from app.database import engine
from app.models.base import Base
from app.websocket.handlers import notification_ws_endpoint, websocket_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Agora",
    description="Microsoft Teams Clone API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST API routes
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(teams.router)
app.include_router(channels.router)
app.include_router(messages.router)
app.include_router(files.router)
app.include_router(feed.router)
app.include_router(video.router)
app.include_router(invitations.router)

# WebSocket
app.websocket("/ws/notifications")(notification_ws_endpoint)
app.websocket("/ws/{channel_id}")(websocket_endpoint)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "agora"}
