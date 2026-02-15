"""Calendar provider sync helpers.

Provides a thin abstraction over different calendar back-ends so the
API layer can create / read / update / delete events in a uniform way.

Supported providers:
  - WebDAV / CalDAV  (URL + username + password)
  - Google Calendar  (Google email + app password via CalDAV)
  - Outlook Exchange (EWS server URL + username + password)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from icalendar import Calendar, Event, vText

from app.models.calendar import CalendarIntegration

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    """Raised when an external calendar provider returns an error."""

    def __init__(self, provider: str, status_code: int, detail: str = ""):
        self.provider = provider
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"{provider} returned HTTP {status_code}: {detail}")


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def _ical_event(
    uid: str,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> bytes:
    """Build a minimal iCalendar VEVENT."""
    cal = Calendar()
    cal.add("prodid", "-//Agora//Calendar//DE")
    cal.add("version", "2.0")

    ev = Event()
    ev.add("uid", uid)
    ev.add("summary", title)
    ev.add("dtstart", start)
    ev.add("dtend", end)
    ev.add("dtstamp", datetime.now(timezone.utc))
    if description:
        ev.add("description", description)
    if location:
        ev["location"] = vText(location)
    cal.add_component(ev)
    return cal.to_ical()


# ---------------------------------------------------------------------------
# WebDAV / CalDAV
# ---------------------------------------------------------------------------


async def webdav_list_events(
    integration: CalendarIntegration,
    range_start: datetime,
    range_end: datetime,
) -> list[dict[str, Any]]:
    """Fetch events from a CalDAV server via REPORT."""
    if not integration.webdav_url:
        return []
    body = (
        '<?xml version="1.0" encoding="utf-8" ?>'
        '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        "  <D:prop><D:getetag/><C:calendar-data/></D:prop>"
        "  <C:filter>"
        '    <C:comp-filter name="VCALENDAR">'
        '      <C:comp-filter name="VEVENT">'
        f'        <C:time-range start="{range_start.strftime("%Y%m%dT%H%M%SZ")}"'
        f'                      end="{range_end.strftime("%Y%m%dT%H%M%SZ")}"/>'
        "      </C:comp-filter>"
        "    </C:comp-filter>"
        "  </C:filter>"
        "</C:calendar-query>"
    )
    auth = None
    if integration.webdav_username:
        auth = (integration.webdav_username, integration.webdav_password or "")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(
            "REPORT",
            integration.webdav_url,
            content=body,
            headers={"Content-Type": "application/xml; charset=utf-8", "Depth": "1"},
            auth=auth,
        )
    if resp.status_code >= 400:
        logger.warning("WebDAV REPORT failed: HTTP %d – %s", resp.status_code, resp.text[:200])
        raise ProviderError("webdav", resp.status_code, resp.text[:200])
    return _parse_caldav_response(resp.text)


def _parse_caldav_response(xml_text: str) -> list[dict[str, Any]]:
    """Best-effort parse of a CalDAV multi-status response."""
    events: list[dict[str, Any]] = []
    try:
        from icalendar import Calendar as iCal

        for match in re.finditer(r"<[^>]*calendar-data[^>]*>(.*?)</", xml_text, re.S):
            cal = iCal.from_ical(match.group(1))
            for comp in cal.walk():
                if comp.name == "VEVENT":
                    events.append(
                        {
                            "external_id": str(comp.get("uid", "")),
                            "title": str(comp.get("summary", "")),
                            "description": str(comp.get("description", "")),
                            "start_time": comp.decoded("dtstart") if comp.get("dtstart") else None,
                            "end_time": comp.decoded("dtend") if comp.get("dtend") else None,
                            "location": str(comp.get("location", "")) or None,
                        }
                    )
    except Exception:
        pass
    return events


async def webdav_put_event(
    integration: CalendarIntegration,
    uid: str,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> bool:
    """PUT a single VEVENT to a CalDAV server."""
    if not integration.webdav_url:
        return False
    ical_bytes = _ical_event(uid, title, start, end, description, location)
    url = integration.webdav_url.rstrip("/") + f"/{uid}.ics"
    auth = None
    if integration.webdav_username:
        auth = (integration.webdav_username, integration.webdav_password or "")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            url,
            content=ical_bytes,
            headers={"Content-Type": "text/calendar; charset=utf-8"},
            auth=auth,
        )
    return resp.status_code < 400


async def webdav_delete_event(integration: CalendarIntegration, uid: str) -> bool:
    """DELETE a VEVENT from a CalDAV server."""
    if not integration.webdav_url:
        return False
    url = integration.webdav_url.rstrip("/") + f"/{uid}.ics"
    auth = None
    if integration.webdav_username:
        auth = (integration.webdav_username, integration.webdav_password or "")
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(url, auth=auth)
    return resp.status_code < 400


# ---------------------------------------------------------------------------
# Google Calendar  (REST API v3 with OAuth 2.0)
# ---------------------------------------------------------------------------

GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


async def _google_ensure_token(integration: CalendarIntegration) -> str:
    """Return a valid access token, refreshing if expired.

    Raises ProviderError when refresh fails.
    """
    if not integration.google_refresh_token:
        raise ProviderError("google", 401, "Google account not connected – please reconnect via settings")

    from app.config import settings as app_settings

    # Check if access token is still valid (with 60s safety margin).
    # The expiry loaded from PostgreSQL may be a naive datetime (no tzinfo),
    # so normalise before comparing with an aware now().
    expiry = integration.google_token_expiry
    if expiry is not None and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if (
        integration.google_access_token
        and expiry
        and expiry > datetime.now(timezone.utc) + timedelta(seconds=60)
    ):
        return integration.google_access_token

    # Refresh
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(GOOGLE_TOKEN_URL, data={
                "client_id": app_settings.google_client_id,
                "client_secret": app_settings.google_client_secret,
                "refresh_token": integration.google_refresh_token,
                "grant_type": "refresh_token",
            })
    except httpx.HTTPError as exc:
        logger.warning("Google token refresh network error: %s", exc)
        raise ProviderError("google", 503, f"Could not reach Google servers: {exc}")

    if resp.status_code != 200:
        logger.warning("Google token refresh failed: %d – %s", resp.status_code, resp.text[:300])
        raise ProviderError("google", 401, "Google token refresh failed – please reconnect your account")

    data = resp.json()
    integration.google_access_token = data.get("access_token")
    if not integration.google_access_token:
        raise ProviderError("google", 401, "Google token refresh returned no access token")
    integration.google_token_expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    # Note: caller must flush the session to persist updated tokens
    return data["access_token"]


async def google_list_events(
    integration: CalendarIntegration,
    range_start: datetime,
    range_end: datetime,
) -> list[dict[str, Any]]:
    """List events from Google Calendar via REST API v3."""
    token = await _google_ensure_token(integration)
    params = {
        "timeMin": range_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timeMax": range_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": "250",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("Google Calendar API network error: %s", exc)
        raise ProviderError("google", 503, f"Could not reach Google Calendar API: {exc}")

    if resp.status_code >= 400:
        detail = resp.text[:200]
        if resp.status_code == 401:
            detail = "Authentication failed – please reconnect your Google account"
        elif resp.status_code == 403:
            detail = "Access denied – calendar permissions may have been revoked"
        logger.warning("Google Calendar API failed: HTTP %d – %s", resp.status_code, detail)
        raise ProviderError("google", resp.status_code, detail)

    events: list[dict[str, Any]] = []
    for item in resp.json().get("items", []):
        if item.get("status") == "cancelled":
            continue
        start = item.get("start", {})
        end = item.get("end", {})
        events.append({
            "external_id": item.get("id", ""),
            "title": item.get("summary", ""),
            "description": item.get("description"),
            "start_time": start.get("dateTime") or start.get("date"),
            "end_time": end.get("dateTime") or end.get("date"),
            "location": item.get("location"),
        })
    return events


async def google_create_event(
    integration: CalendarIntegration,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> str | None:
    """Create a Google Calendar event via REST API. Returns event ID."""
    token = await _google_ensure_token(integration)
    body: dict[str, Any] = {
        "summary": title,
        "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "UTC"},
        "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%SZ"), "timeZone": "UTC"},
    }
    if description:
        body["description"] = description
    if location:
        body["location"] = location

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
    if resp.status_code < 400:
        return resp.json().get("id")
    return None


async def google_delete_event(integration: CalendarIntegration, event_id: str) -> bool:
    """Delete a Google Calendar event via REST API."""
    token = await _google_ensure_token(integration)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(
            f"{GOOGLE_CALENDAR_API}/calendars/primary/events/{event_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
    return resp.status_code < 400


# ---------------------------------------------------------------------------
# Outlook / Exchange Web Services (EWS) with username + password
# ---------------------------------------------------------------------------


def _ews_soap(action_body: str) -> str:
    """Wrap an EWS action in a SOAP envelope."""
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'
        ' xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"'
        ' xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">'
        "<soap:Body>" + action_body + "</soap:Body>"
        "</soap:Envelope>"
    )


def _ews_date(dt: datetime) -> str:
    """Format datetime for EWS."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


async def _ews_request(
    integration: CalendarIntegration, soap_body: str
) -> httpx.Response | None:
    """Send an EWS SOAP request with basic auth."""
    if not (integration.outlook_server_url and integration.outlook_username and integration.outlook_password):
        return None
    url = integration.outlook_server_url.rstrip("/") + "/EWS/Exchange.asmx"
    auth = (integration.outlook_username, integration.outlook_password)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            content=_ews_soap(soap_body),
            headers={"Content-Type": "text/xml; charset=utf-8"},
            auth=auth,
        )
    return resp


async def outlook_list_events(
    integration: CalendarIntegration,
    range_start: datetime,
    range_end: datetime,
) -> list[dict[str, Any]]:
    """List events from Exchange via EWS FindItem."""
    body = (
        '<m:FindItem Traversal="Shallow">'
        "  <m:ItemShape>"
        "    <t:BaseShape>Default</t:BaseShape>"
        "    <t:AdditionalProperties>"
        '      <t:FieldURI FieldURI="item:Subject"/>'
        '      <t:FieldURI FieldURI="item:Body"/>'
        '      <t:FieldURI FieldURI="calendar:Start"/>'
        '      <t:FieldURI FieldURI="calendar:End"/>'
        '      <t:FieldURI FieldURI="calendar:Location"/>'
        "    </t:AdditionalProperties>"
        "  </m:ItemShape>"
        "  <m:CalendarView"
        f'    StartDate="{_ews_date(range_start)}"'
        f'    EndDate="{_ews_date(range_end)}"/>'
        "  <m:ParentFolderIds>"
        '    <t:DistinguishedFolderId Id="calendar"/>'
        "  </m:ParentFolderIds>"
        "</m:FindItem>"
    )
    resp = await _ews_request(integration, body)
    if resp is None:
        return []
    if resp.status_code >= 400:
        logger.warning("Outlook EWS FindItem failed: HTTP %d – %s", resp.status_code, resp.text[:200])
        raise ProviderError("outlook", resp.status_code, resp.text[:200])
    return _parse_ews_find_response(resp.text)


def _parse_ews_find_response(xml_text: str) -> list[dict[str, Any]]:
    """Best-effort parse of EWS FindItem CalendarView response."""
    events: list[dict[str, Any]] = []
    try:
        # Extract CalendarItem blocks
        for match in re.finditer(
            r"<t:CalendarItem>(.*?)</t:CalendarItem>", xml_text, re.S
        ):
            block = match.group(1)
            item_id = ""
            id_match = re.search(r'<t:ItemId Id="([^"]*)"', block)
            if id_match:
                item_id = id_match.group(1)
            subject = _ews_extract(block, "t:Subject")
            start = _ews_extract(block, "t:Start")
            end = _ews_extract(block, "t:End")
            location = _ews_extract(block, "t:Location")
            events.append(
                {
                    "external_id": item_id,
                    "title": subject or "",
                    "description": None,
                    "start_time": start,
                    "end_time": end,
                    "location": location or None,
                }
            )
    except Exception:
        pass
    return events


def _ews_extract(xml: str, tag: str) -> str:
    """Extract text content of an XML tag."""
    m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", xml, re.S)
    return m.group(1).strip() if m else ""


async def outlook_create_event(
    integration: CalendarIntegration,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> str | None:
    """Create a calendar item via EWS CreateItem. Returns ItemId."""
    body_elem = ""
    if description:
        body_elem = (
            f"<t:Body BodyType='Text'>{description}</t:Body>"
        )
    location_elem = ""
    if location:
        location_elem = f"<t:Location>{location}</t:Location>"
    body = (
        '<m:CreateItem SendMeetingInvitations="SendToNone">'
        "  <m:Items>"
        "    <t:CalendarItem>"
        f"      <t:Subject>{title}</t:Subject>"
        f"      {body_elem}"
        f"      <t:Start>{_ews_date(start)}</t:Start>"
        f"      <t:End>{_ews_date(end)}</t:End>"
        f"      {location_elem}"
        "    </t:CalendarItem>"
        "  </m:Items>"
        "</m:CreateItem>"
    )
    resp = await _ews_request(integration, body)
    if resp is None or resp.status_code >= 400:
        return None
    # Extract ItemId from response
    m = re.search(r'<t:ItemId Id="([^"]*)"', resp.text)
    return m.group(1) if m else None


async def outlook_delete_event(integration: CalendarIntegration, item_id: str) -> bool:
    """Delete a calendar item via EWS DeleteItem."""
    body = (
        '<m:DeleteItem DeleteType="MoveToDeletedItems">'
        "  <m:ItemIds>"
        f'    <t:ItemId Id="{item_id}"/>'
        "  </m:ItemIds>"
        "</m:DeleteItem>"
    )
    resp = await _ews_request(integration, body)
    return resp is not None and resp.status_code < 400
