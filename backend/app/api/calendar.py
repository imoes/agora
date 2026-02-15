import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.calendar import CalendarEvent, CalendarIntegration, EventAttendee
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


def _google_redirect_uri() -> str:
    """Build the Google OAuth redirect URI.

    Google rejects https://localhost as a redirect URI.  For localhost
    the redirect must use http://.  When GOOGLE_OAUTH_REDIRECT_URI is set
    (e.g. http://localhost:8000/api/calendar/google/callback) we use it
    directly so the callback goes straight to the backend, bypassing any
    port-80 issues.
    """
    if settings.google_oauth_redirect_uri:
        return settings.google_oauth_redirect_uri
    base = settings.frontend_url
    parsed = urllib.parse.urlparse(base)
    if parsed.hostname == "localhost" and parsed.scheme == "https":
        base = base.replace("https://", "http://", 1)
    return f"{base}/api/calendar/google/callback"

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
    """List calendar events for the current user within an optional date range.

    Includes events the user owns AND events where the user is an attendee
    (accepted or pending).
    """
    if start is None:
        start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if end is None:
        # Default: to end of next month
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = (next_month.replace(day=28) + timedelta(days=4)).replace(day=1)

    from sqlalchemy import or_

    # Own events OR events where user is an attendee (accepted or pending)
    query = (
        select(CalendarEvent)
        .outerjoin(
            EventAttendee,
            and_(
                EventAttendee.event_id == CalendarEvent.id,
                EventAttendee.user_id == current_user.id,
                EventAttendee.status.in_(["accepted", "pending"]),
            ),
        )
        .options(selectinload(CalendarEvent.attendees))
        .where(
            and_(
                or_(
                    CalendarEvent.user_id == current_user.id,
                    EventAttendee.id.isnot(None),
                ),
                CalendarEvent.start_time < end,
                CalendarEvent.end_time > start,
            )
        )
        .order_by(CalendarEvent.start_time)
    )
    result = await db.execute(query)
    return result.scalars().unique().all()


@router.post("/events", response_model=CalendarEventOut, status_code=status.HTTP_201_CREATED)
async def create_event(
    data: CalendarEventCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new calendar event, optionally inviting attendees."""
    if data.end_time <= data.start_time:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    try:
        return await _create_event_impl(data, background_tasks, db, current_user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to create calendar event")
        raise HTTPException(status_code=500, detail=f"Event creation failed: {exc}")


async def _create_event_impl(
    data: CalendarEventCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession,
    current_user: User,
) -> CalendarEvent:

    location = data.location
    channel_id = data.channel_id

    # If attendees are given, always create a video call
    create_video = data.create_video_call or bool(data.attendees)

    # Create a video call meeting channel and put the link in location
    if create_video:
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
        video_link = f"{settings.frontend_url}/video/{meeting_channel.id}"
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

    # Process attendees
    if data.attendees and channel_id:
        import secrets as _secrets
        for att in data.attendees:
            email = att.email.strip().lower()
            if not email:
                continue
            # Look up internal user by email
            result = await db.execute(
                select(User).where(User.email == email)
            )
            internal_user = result.scalar_one_or_none()

            if internal_user:
                attendee = EventAttendee(
                    event_id=event.id,
                    user_id=internal_user.id,
                    email=email,
                    display_name=internal_user.display_name,
                    is_external=False,
                )
                db.add(attendee)
                # NOTE: internal users are NOT added to the meeting channel
                # until they accept the invitation via the RSVP endpoint.
            else:
                guest_token = _secrets.token_urlsafe(32)
                attendee = EventAttendee(
                    event_id=event.id,
                    email=email,
                    is_external=True,
                    guest_token=guest_token,
                )
                db.add(attendee)
        await db.flush()

        # Send invitation emails in background
        result = await db.execute(
            select(CalendarEvent)
            .options(selectinload(CalendarEvent.attendees))
            .where(CalendarEvent.id == event.id)
        )
        event = result.scalar_one()
        _schedule_invitation_emails(
            background_tasks,
            event_title=event.title,
            event_start=event.start_time,
            event_end=event.end_time,
            inviter_name=current_user.display_name,
            inviter_email=current_user.email,
            channel_id=channel_id,
            attendees=event.attendees,
        )

    # Push to external provider if configured
    integration = await _get_integration(db, current_user.id)
    if integration and integration.provider != "internal":
        try:
            external_id = await _push_event_to_provider(integration, event)
            if external_id:
                event.external_id = external_id
                await db.flush()
        except (ProviderError, Exception) as exc:
            logger.warning("Failed to push event to provider: %s", exc)

    result = await db.execute(
        select(CalendarEvent)
        .options(selectinload(CalendarEvent.attendees))
        .where(CalendarEvent.id == event.id)
    )
    return result.scalar_one()


@router.get("/events/{event_id}", response_model=CalendarEventOut)
async def get_event(
    event_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = await _get_own_event(db, event_id, current_user.id)
    return event


@router.get("/invitations", response_model=list[CalendarEventOut])
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List calendar events where the current user has a pending invitation."""
    result = await db.execute(
        select(CalendarEvent)
        .join(EventAttendee, EventAttendee.event_id == CalendarEvent.id)
        .options(selectinload(CalendarEvent.attendees))
        .where(
            and_(
                EventAttendee.user_id == current_user.id,
                EventAttendee.is_external == False,  # noqa: E712
                EventAttendee.status == "pending",
                CalendarEvent.user_id != current_user.id,
                CalendarEvent.start_time >= datetime.now(timezone.utc),
            )
        )
        .order_by(CalendarEvent.start_time)
    )
    return result.scalars().unique().all()


@router.get("/invitations/count")
async def invitation_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the number of pending calendar invitations for the current user."""
    from sqlalchemy import func

    result = await db.execute(
        select(func.count())
        .select_from(EventAttendee)
        .join(CalendarEvent, CalendarEvent.id == EventAttendee.event_id)
        .where(
            and_(
                EventAttendee.user_id == current_user.id,
                EventAttendee.is_external == False,  # noqa: E712
                EventAttendee.status == "pending",
                CalendarEvent.user_id != current_user.id,
                CalendarEvent.start_time >= datetime.now(timezone.utc),
            )
        )
    )
    return {"count": result.scalar()}


@router.post("/events/{event_id}/rsvp")
async def rsvp_event(
    event_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Accept or decline an event invitation. Body: {"status": "accepted"|"declined"}."""
    rsvp_status = body.get("status", "").lower()
    if rsvp_status not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="status must be 'accepted' or 'declined'")

    result = await db.execute(
        select(EventAttendee).where(
            and_(
                EventAttendee.event_id == event_id,
                EventAttendee.user_id == current_user.id,
            )
        )
    )
    attendee = result.scalar_one_or_none()
    if attendee is None:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")

    attendee.status = rsvp_status

    # When accepting, add the user to the meeting channel (if any)
    if rsvp_status == "accepted":
        event = await db.get(CalendarEvent, event_id)
        if event and event.channel_id:
            existing = await db.execute(
                select(ChannelMember).where(
                    and_(
                        ChannelMember.channel_id == event.channel_id,
                        ChannelMember.user_id == current_user.id,
                    )
                )
            )
            if not existing.scalar_one_or_none():
                db.add(ChannelMember(channel_id=event.channel_id, user_id=current_user.id))

    await db.flush()
    return {"status": rsvp_status}


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
        try:
            await _push_event_to_provider(integration, event)
        except (ProviderError, Exception) as exc:
            logger.warning("Failed to update event in provider: %s", exc)

    result = await db.execute(
        select(CalendarEvent)
        .options(selectinload(CalendarEvent.attendees))
        .where(CalendarEvent.id == event.id)
    )
    return result.scalar_one()


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
        try:
            await _delete_from_provider(integration, event.external_id)
        except (ProviderError, Exception) as exc:
            logger.warning("Failed to delete event from provider: %s", exc)

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

    # Remove local events that no longer exist in the external provider
    synced_ext_ids = {ext.get("external_id") for ext in external_events if ext.get("external_id")}
    local_external = await db.execute(
        select(CalendarEvent).where(
            and_(
                CalendarEvent.user_id == current_user.id,
                CalendarEvent.external_id.isnot(None),
                CalendarEvent.start_time < end,
                CalendarEvent.end_time > start,
            )
        )
    )
    for local_ev in local_external.scalars().all():
        if local_ev.external_id not in synced_ext_ids:
            await db.delete(local_ev)

    integration.last_sync_at = now
    await db.flush()

    # Re-query imported events with all attributes and attendees loaded
    if imported:
        result = await db.execute(
            select(CalendarEvent)
            .options(selectinload(CalendarEvent.attendees))
            .where(CalendarEvent.id.in_([ev.id for ev in imported]))
            .order_by(CalendarEvent.start_time)
        )
        return result.scalars().all()
    return []


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
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return {"auth_url": url}


@router.get("/google/callback")
async def google_callback_get(
    code: str = Query(...),
    state: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """Handle Google OAuth2 redirect (GET from Google).

    Google redirects here with code + state.  We extract the user_id from
    the state parameter, exchange the code for tokens, store them, and
    redirect the browser back to the HTTPS frontend.
    """
    from starlette.responses import RedirectResponse

    # Extract user_id from state  (format: "<uuid>:<random>")
    user_id_str = state.split(":")[0] if state else ""
    try:
        user_id = uuid.UUID(user_id_str)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    # Verify user exists
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    google_email, _ = await _exchange_google_code(db, code, user_id)

    # Commit NOW so tokens are persisted before the browser follows the
    # redirect and triggers a sync call.
    await db.commit()

    # Redirect back to the HTTPS frontend.
    frontend = settings.frontend_url
    parsed = urllib.parse.urlparse(frontend)
    if parsed.hostname == "localhost" and parsed.scheme == "http":
        frontend = frontend.replace("http://", "https://", 1)
    redirect_url = f"{frontend}/calendar?google_connected=true"
    return RedirectResponse(url=redirect_url, status_code=302)


@router.post("/google/callback")
async def google_callback_post(
    code: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Exchange the OAuth2 authorization code for tokens (called by frontend)."""
    google_email, _ = await _exchange_google_code(db, code, current_user.id)
    return {"ok": True, "google_email": google_email}


async def _exchange_google_code(
    db: AsyncSession, code: str, user_id: uuid.UUID
) -> tuple[str | None, CalendarIntegration]:
    """Exchange a Google authorization code for tokens and persist them."""
    import httpx as _httpx

    async with _httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": _google_redirect_uri(),
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

    integration = await _get_integration(db, user_id)
    if integration is None:
        integration = CalendarIntegration(user_id=user_id)
        db.add(integration)

    integration.provider = "google"
    integration.google_email = google_email
    integration.google_access_token = access_token
    if refresh_token:
        integration.google_refresh_token = refresh_token
    integration.google_token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    await db.flush()
    await db.refresh(integration)
    return google_email, integration


# ---------------------------------------------------------------------------
# Google Calendar diagnostics
# ---------------------------------------------------------------------------


@router.get("/google/status")
async def google_calendar_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Diagnostic endpoint: check if Google Calendar integration is working.

    Returns details about the OAuth state and tries a minimal API call
    so the user sees the *actual* Google error (e.g. API not enabled).
    """
    import httpx as _httpx

    if not settings.google_client_id:
        return {"ok": False, "error": "Google OAuth not configured (GOOGLE_CLIENT_ID missing)"}

    integration = await _get_integration(db, current_user.id)
    if not integration or integration.provider != "google":
        return {"ok": False, "error": "No Google Calendar integration configured for this user"}

    if not integration.google_refresh_token:
        return {"ok": False, "error": "Google account not connected – no refresh token. Please reconnect via Settings."}

    # Try refreshing the token
    try:
        token = await calendar_sync._google_ensure_token(integration)
        await db.flush()
    except calendar_sync.ProviderError as exc:
        return {"ok": False, "error": f"Token refresh failed: {exc.detail}"}

    # Try a minimal Calendar API call
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{calendar_sync.GOOGLE_CALENDAR_API}/calendars/primary",
                headers={"Authorization": f"Bearer {token}"},
            )
    except _httpx.HTTPError as exc:
        return {"ok": False, "error": f"Network error reaching Google: {exc}"}

    if resp.status_code == 200:
        cal = resp.json()
        return {
            "ok": True,
            "google_email": integration.google_email,
            "calendar_summary": cal.get("summary"),
            "calendar_timezone": cal.get("timeZone"),
        }

    # Return the actual Google error for diagnosis
    try:
        err = resp.json()
        google_msg = err.get("error", {}).get("message", resp.text[:500])
    except Exception:
        google_msg = resp.text[:500]
    return {
        "ok": False,
        "http_status": resp.status_code,
        "google_error": google_msg,
    }


# ---------------------------------------------------------------------------
# Guest meeting access (no auth required)
# ---------------------------------------------------------------------------


@router.get("/guest/{guest_token}")
async def guest_meeting_info(
    guest_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Return meeting info for an external guest (no auth)."""
    result = await db.execute(
        select(EventAttendee).where(EventAttendee.guest_token == guest_token)
    )
    attendee = result.scalar_one_or_none()
    if attendee is None:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")

    event = await db.get(CalendarEvent, attendee.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")

    return {
        "event_title": event.title,
        "event_start": event.start_time.isoformat(),
        "event_end": event.end_time.isoformat(),
        "channel_id": str(event.channel_id) if event.channel_id else None,
    }


@router.post("/guest/{guest_token}/join")
async def guest_join_meeting(
    guest_token: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """External guest joins a meeting by entering their name.

    Creates a temporary guest user, adds them to the meeting channel,
    and returns a JWT so they can access the video room.
    """
    from app.services.auth import create_access_token, hash_password

    display_name = (body.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Name ist erforderlich")

    result = await db.execute(
        select(EventAttendee).where(EventAttendee.guest_token == guest_token)
    )
    attendee = result.scalar_one_or_none()
    if attendee is None:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")

    event = await db.get(CalendarEvent, attendee.event_id)
    if event is None or event.channel_id is None:
        raise HTTPException(status_code=404, detail="Termin nicht gefunden")

    import secrets as _secrets

    # Create a temporary guest user
    guest_username = f"guest_{_secrets.token_hex(8)}"
    guest_user = User(
        username=guest_username,
        email=f"{guest_username}@guest.local",
        password_hash=hash_password(_secrets.token_urlsafe(16)),
        display_name=display_name,
        is_guest=True,
    )
    db.add(guest_user)
    await db.flush()

    # Add guest to the meeting channel
    db.add(ChannelMember(channel_id=event.channel_id, user_id=guest_user.id))

    # Update attendee record
    attendee.user_id = guest_user.id
    attendee.display_name = display_name
    attendee.status = "accepted"
    await db.flush()

    token = create_access_token(guest_user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "channel_id": str(event.channel_id),
        "display_name": display_name,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _schedule_invitation_emails(
    background_tasks: BackgroundTasks,
    *,
    event_title: str,
    event_start: datetime,
    event_end: datetime,
    inviter_name: str,
    inviter_email: str,
    channel_id: uuid.UUID,
    attendees: list[EventAttendee],
) -> None:
    """Queue invitation emails for all attendees."""
    from app.services.email import send_invitation_email
    from app.services.ics import generate_invitation_ics

    frontend = settings.frontend_url

    for att in attendees:
        if att.is_external and att.guest_token:
            join_link = f"{frontend}/meeting/guest/{att.guest_token}"
        else:
            join_link = f"{frontend}/video/{channel_id}"

        ics_content = generate_invitation_ics(
            channel_name=event_title,
            inviter_name=inviter_name,
            inviter_email=inviter_email,
            invited_email=att.email,
            invite_link=join_link,
            start_time=event_start,
            end_time=event_end,
        )

        background_tasks.add_task(
            send_invitation_email,
            to_email=att.email,
            channel_name=event_title,
            inviter_name=inviter_name,
            invite_link=join_link,
            ics_content=ics_content,
            message=f"Termin: {event_title}\nZeit: {event_start.strftime('%d.%m.%Y %H:%M')} - {event_end.strftime('%H:%M')}",
        )


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
        select(CalendarEvent)
        .options(selectinload(CalendarEvent.attendees))
        .where(
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
