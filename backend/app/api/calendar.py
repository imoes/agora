import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.calendar import CalendarEvent, CalendarIntegration
from app.models.channel import Channel, ChannelMember
from app.models.user import User
from app.schemas.calendar import (
    CalendarEventCreate,
    CalendarEventOut,
    CalendarEventUpdate,
    CalendarIntegrationCreate,
    CalendarIntegrationOut,
)
from app.services.auth import get_current_user
from app.services import calendar_sync
from app.services.calendar_sync import ProviderError, GOOGLE_AUTH_URL, GOOGLE_SCOPES, GOOGLE_TOKEN_URL
from app.config import settings

import os
import urllib.parse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

# ---------------------------------------------------------------------------
# Calendar Events
# ---------------------------------------------------------------------------

VALID_PROVIDERS = {"internal", "webdav", "google", "outlook"}


@router.get("/events", response_model=list[CalendarEventOut])
async def list_events(
    start: datetime | None = Query(None, description="Range start (ISO 8601)"),
    end: datetime | None = Query(None, description="Range end (ISO 8601)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List calendar events for the current user within an optional date range."""
    if start is None:
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if end is None:
        # Default: to end of next month
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = (next_month.replace(day=28) + timedelta(days=4)).replace(day=1)

    query = (
        select(CalendarEvent)
        .where(
            and_(
                CalendarEvent.user_id == current_user.id,
                CalendarEvent.start_time < end,
                CalendarEvent.end_time > start,
            )
        )
        .order_by(CalendarEvent.start_time)
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/events", response_model=CalendarEventOut, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: CalendarEventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new calendar event."""
    if data.end_time <= data.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    location = data.location
    channel_id = data.channel_id

    # Create a video call meeting channel and put the link in location
    if data.create_video_call:
        from app.models.channel import _generate_invite_token

        meeting_channel = Channel(
            name=data.title,
            channel_type="meeting",
            sqlite_db_path=os.path.join(settings.chat_db_dir, f"meeting_{uuid.uuid4().hex}.db"),
            invite_token=_generate_invite_token(),
            scheduled_at=data.start_time,
        )
        db.add(meeting_channel)
        await db.flush()
        # Add the creator as member
        db.add(ChannelMember(channel_id=meeting_channel.id, user_id=current_user.id))
        await db.flush()
        channel_id = meeting_channel.id
        video_link = f"/video/{meeting_channel.id}"
        location = video_link if not location else f"{location} | {video_link}"

    event = CalendarEvent(
        user_id=current_user.id,
        title=data.title,
        description=data.description,
        start_time=data.start_time,
        end_time=data.end_time,
        all_day=data.all_day,
        location=location,
        channel_id=channel_id,
    )
    db.add(event)
    await db.flush()

    # Push to external provider if configured
    integration = await _get_integration(db, current_user.id)
    if integration and integration.provider != "internal":
        external_id = await _push_event_to_provider(integration, event)
        if external_id:
            event.external_id = external_id
            await db.flush()

    await db.refresh(event)
    return event


@router.get("/events/{event_id}", response_model=CalendarEventOut)
async def get_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = await _get_own_event(db, event_id, current_user.id)
    return event


@router.patch("/events/{event_id}", response_model=CalendarEventOut)
async def update_event(
    event_id: uuid.UUID,
    data: CalendarEventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = await _get_own_event(db, event_id, current_user.id)

    update_fields = data.model_dump(exclude_unset=True)
    for key, value in update_fields.items():
        setattr(event, key, value)

    if event.end_time <= event.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    await db.flush()

    # Update in external provider
    integration = await _get_integration(db, current_user.id)
    if integration and integration.provider != "internal" and event.external_id:
        await _push_event_to_provider(integration, event)

    await db.refresh(event)
    return event


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = await _get_own_event(db, event_id, current_user.id)

    # Delete from external provider
    integration = await _get_integration(db, current_user.id)
    if integration and integration.provider != "internal" and event.external_id:
        await _delete_from_provider(integration, event.external_id)

    await db.delete(event)
    await db.flush()


# ---------------------------------------------------------------------------
# Calendar Integration / Provider Settings
# ---------------------------------------------------------------------------


@router.get("/integration")
async def get_integration(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalendarIntegrationOut | None:
    """Get the current user's calendar integration settings."""
    integration = await _get_integration(db, current_user.id)
    if integration is None:
        return None
    return _integration_to_out(integration)


@router.put("/integration")
async def upsert_integration(
    data: CalendarIntegrationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update calendar integration settings."""
    if data.provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Invalid provider. Must be one of: {', '.join(VALID_PROVIDERS)}")

    integration = await _get_integration(db, current_user.id)
    if integration is None:
        integration = CalendarIntegration(user_id=current_user.id)
        db.add(integration)

    integration.provider = data.provider
    integration.webdav_url = data.webdav_url
    integration.webdav_username = data.webdav_username
    if data.webdav_password is not None:
        integration.webdav_password = data.webdav_password
    # Only clear Google OAuth tokens when switching away from google provider
    if data.provider != "google":
        integration.google_access_token = None
        integration.google_refresh_token = None
        integration.google_token_expiry = None
        integration.google_email = None
    # Allow frontend to pass google_email for display, but don't overwrite OAuth email
    elif data.google_email is not None and not integration.google_refresh_token:
        integration.google_email = data.google_email
    integration.outlook_server_url = data.outlook_server_url
    integration.outlook_username = data.outlook_username
    if data.outlook_password is not None:
        integration.outlook_password = data.outlook_password

    await db.flush()
    await db.refresh(integration)
    return _integration_to_out(integration)


@router.delete("/integration", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integration = await _get_integration(db, current_user.id)
    if integration:
        await db.delete(integration)
        await db.flush()


@router.post("/sync", response_model=list[CalendarEventOut])
async def sync_events(
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync events from the configured external calendar provider."""
    integration = await _get_integration(db, current_user.id)
    if not integration or integration.provider == "internal":
        raise HTTPException(status_code=400, detail="No external calendar configured")

    now = datetime.now(timezone.utc)
    if start is None:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if end is None:
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = (next_month.replace(day=28) + timedelta(days=4)).replace(day=1)

    try:
        external_events = await _fetch_from_provider(integration, start, end)
    except ProviderError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Calendar provider '{integration.provider}' error (HTTP {exc.status_code}): {exc.detail}",
        )
    except Exception as exc:
        logger.exception("Unexpected error syncing calendar provider '%s'", integration.provider)
        raise HTTPException(
            status_code=502,
            detail=f"Calendar provider '{integration.provider}' error: {exc}",
        )

    imported: list[CalendarEvent] = []
    for ext in external_events:
        ext_id = ext.get("external_id")
        if not ext_id:
            continue
        # Check if already imported
        existing = await db.execute(
            select(CalendarEvent).where(
                and_(
                    CalendarEvent.user_id == current_user.id,
                    CalendarEvent.external_id == ext_id,
                )
            )
        )
        ev = existing.scalar_one_or_none()
        start_time = _parse_dt(ext.get("start_time"))
        end_time = _parse_dt(ext.get("end_time"))
        if not start_time or not end_time:
            continue

        if ev:
            ev.title = ext.get("title", ev.title)
            ev.description = ext.get("description")
            ev.start_time = start_time
            ev.end_time = end_time
            ev.location = ext.get("location")
        else:
            ev = CalendarEvent(
                user_id=current_user.id,
                title=ext.get("title", ""),
                description=ext.get("description"),
                start_time=start_time,
                end_time=end_time,
                location=ext.get("location"),
                external_id=ext_id,
            )
            db.add(ev)
        imported.append(ev)

    integration.last_sync_at = now
    await db.flush()

    for ev in imported:
        await db.refresh(ev)
    return imported


# ---------------------------------------------------------------------------
# Google OAuth 2.0 flow
# ---------------------------------------------------------------------------


@router.get("/google/auth")
async def google_auth_redirect(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the Google OAuth2 authorization URL for the frontend to redirect to."""
    if not settings.google_client_id:
        raise HTTPException(status_code=400, detail="Google OAuth not configured on this server")

    # Encode user id in state so callback can match
    import secrets
    state = f"{current_user.id}:{secrets.token_urlsafe(16)}"

    # Persist state in integration for verification
    integration = await _get_integration(db, current_user.id)
    if integration is None:
        integration = CalendarIntegration(user_id=current_user.id, provider="google")
        db.add(integration)
        await db.flush()

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": f"{settings.frontend_url}/calendar/google/callback",
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return {"auth_url": url}


@router.post("/google/callback")
async def google_callback(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Exchange the OAuth2 authorization code for tokens."""
    import httpx as _httpx

    async with _httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": f"{settings.frontend_url}/calendar/google/callback",
            "grant_type": "authorization_code",
        })
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {resp.text[:200]}")

    data = resp.json()
    access_token = data["access_token"]
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in", 3600)

    # Fetch user email from Google
    async with _httpx.AsyncClient(timeout=10) as client:
        me = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    google_email = me.json().get("email") if me.status_code == 200 else None

    integration = await _get_integration(db, current_user.id)
    if integration is None:
        integration = CalendarIntegration(user_id=current_user.id)
        db.add(integration)

    integration.provider = "google"
    integration.google_email = google_email
    integration.google_access_token = access_token
    if refresh_token:
        integration.google_refresh_token = refresh_token
    from datetime import timedelta
    integration.google_token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    await db.flush()
    await db.refresh(integration)
    return {"ok": True, "google_email": google_email}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _integration_to_out(integration: CalendarIntegration) -> CalendarIntegrationOut:
    """Convert ORM object to response schema with computed google_connected."""
    return CalendarIntegrationOut(
        id=integration.id,
        user_id=integration.user_id,
        provider=integration.provider,
        webdav_url=integration.webdav_url,
        webdav_username=integration.webdav_username,
        google_email=integration.google_email,
        google_connected=bool(integration.google_refresh_token),
        outlook_server_url=integration.outlook_server_url,
        outlook_username=integration.outlook_username,
        last_sync_at=integration.last_sync_at,
        created_at=integration.created_at,
    )


async def _get_integration(
    db: AsyncSession, user_id: uuid.UUID
) -> CalendarIntegration | None:
    result = await db.execute(
        select(CalendarIntegration).where(CalendarIntegration.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _get_own_event(
    db: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID
) -> CalendarEvent:
    result = await db.execute(
        select(CalendarEvent).where(
            and_(CalendarEvent.id == event_id, CalendarEvent.user_id == user_id)
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


async def _push_event_to_provider(
    integration: CalendarIntegration, event: CalendarEvent
) -> str | None:
    """Push event to external provider. Returns external_id if created."""
    if integration.provider == "webdav":
        uid = event.external_id or str(event.id)
        ok = await calendar_sync.webdav_put_event(
            integration, uid, event.title, event.start_time, event.end_time,
            event.description, event.location,
        )
        return uid if ok else None
    elif integration.provider == "google":
        return await calendar_sync.google_create_event(
            integration, event.title, event.start_time, event.end_time,
            event.description, event.location,
        )
    elif integration.provider == "outlook":
        return await calendar_sync.outlook_create_event(
            integration, event.title, event.start_time, event.end_time,
            event.description, event.location,
        )
    return None


async def _delete_from_provider(
    integration: CalendarIntegration, external_id: str
) -> None:
    if integration.provider == "webdav":
        await calendar_sync.webdav_delete_event(integration, external_id)
    elif integration.provider == "google":
        await calendar_sync.google_delete_event(integration, external_id)
    elif integration.provider == "outlook":
        await calendar_sync.outlook_delete_event(integration, external_id)


async def _fetch_from_provider(
    integration: CalendarIntegration,
    start: datetime,
    end: datetime,
) -> list[dict]:
    if integration.provider == "webdav":
        return await calendar_sync.webdav_list_events(integration, start, end)
    elif integration.provider == "google":
        return await calendar_sync.google_list_events(integration, start, end)
    elif integration.provider == "outlook":
        return await calendar_sync.outlook_list_events(integration, start, end)
    return []


def _parse_dt(value: str | datetime | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None
