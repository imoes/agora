"""Calendar provider sync helpers.

Provides a thin abstraction over different calendar back-ends so the
API layer can create / read / update / delete events in a uniform way.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from icalendar import Calendar, Event, vText

from app.models.calendar import CalendarIntegration

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
        return []
    return _parse_caldav_response(resp.text)


def _parse_caldav_response(xml_text: str) -> list[dict[str, Any]]:
    """Best-effort parse of a CalDAV multi-status response."""
    events: list[dict[str, Any]] = []
    try:
        from icalendar import Calendar as iCal

        # Extract calendar-data CDATA blocks (simplified parser)
        import re

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
# Google Calendar (via REST API)
# ---------------------------------------------------------------------------

GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"


async def google_list_events(
    integration: CalendarIntegration,
    range_start: datetime,
    range_end: datetime,
) -> list[dict[str, Any]]:
    """List events from Google Calendar API."""
    if not integration.google_token:
        return []
    calendar_id = integration.google_calendar_id or "primary"
    url = f"{GOOGLE_CALENDAR_BASE}/calendars/{calendar_id}/events"
    params = {
        "timeMin": range_start.isoformat(),
        "timeMax": range_end.isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
    }
    headers = {"Authorization": f"Bearer {integration.google_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params, headers=headers)
    if resp.status_code >= 400:
        return []
    data = resp.json()
    events = []
    for item in data.get("items", []):
        start = item.get("start", {})
        end = item.get("end", {})
        events.append(
            {
                "external_id": item.get("id", ""),
                "title": item.get("summary", ""),
                "description": item.get("description"),
                "start_time": start.get("dateTime") or start.get("date"),
                "end_time": end.get("dateTime") or end.get("date"),
                "location": item.get("location"),
            }
        )
    return events


async def google_create_event(
    integration: CalendarIntegration,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> str | None:
    """Create a Google Calendar event. Returns external event ID."""
    if not integration.google_token:
        return None
    calendar_id = integration.google_calendar_id or "primary"
    url = f"{GOOGLE_CALENDAR_BASE}/calendars/{calendar_id}/events"
    body: dict[str, Any] = {
        "summary": title,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
    }
    if description:
        body["description"] = description
    if location:
        body["location"] = location
    headers = {
        "Authorization": f"Bearer {integration.google_token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=body, headers=headers)
    if resp.status_code < 400:
        return resp.json().get("id")
    return None


async def google_delete_event(integration: CalendarIntegration, event_id: str) -> bool:
    if not integration.google_token:
        return False
    calendar_id = integration.google_calendar_id or "primary"
    url = f"{GOOGLE_CALENDAR_BASE}/calendars/{calendar_id}/events/{event_id}"
    headers = {"Authorization": f"Bearer {integration.google_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(url, headers=headers)
    return resp.status_code < 400


# ---------------------------------------------------------------------------
# Outlook / Microsoft Graph
# ---------------------------------------------------------------------------

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


async def outlook_list_events(
    integration: CalendarIntegration,
    range_start: datetime,
    range_end: datetime,
) -> list[dict[str, Any]]:
    """List events from Microsoft Graph Calendar API."""
    if not integration.outlook_token:
        return []
    url = f"{GRAPH_BASE}/me/calendarview"
    params = {
        "startDateTime": range_start.isoformat(),
        "endDateTime": range_end.isoformat(),
        "$orderby": "start/dateTime",
    }
    headers = {"Authorization": f"Bearer {integration.outlook_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params, headers=headers)
    if resp.status_code >= 400:
        return []
    data = resp.json()
    events = []
    for item in data.get("value", []):
        events.append(
            {
                "external_id": item.get("id", ""),
                "title": item.get("subject", ""),
                "description": (item.get("body") or {}).get("content"),
                "start_time": (item.get("start") or {}).get("dateTime"),
                "end_time": (item.get("end") or {}).get("dateTime"),
                "location": (item.get("location") or {}).get("displayName"),
            }
        )
    return events


async def outlook_create_event(
    integration: CalendarIntegration,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> str | None:
    """Create an Outlook calendar event. Returns external event ID."""
    if not integration.outlook_token:
        return None
    url = f"{GRAPH_BASE}/me/events"
    body: dict[str, Any] = {
        "subject": title,
        "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
    }
    if description:
        body["body"] = {"contentType": "text", "content": description}
    if location:
        body["location"] = {"displayName": location}
    headers = {
        "Authorization": f"Bearer {integration.outlook_token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=body, headers=headers)
    if resp.status_code < 400:
        return resp.json().get("id")
    return None


async def outlook_delete_event(integration: CalendarIntegration, event_id: str) -> bool:
    if not integration.outlook_token:
        return False
    url = f"{GRAPH_BASE}/me/events/{event_id}"
    headers = {"Authorization": f"Bearer {integration.outlook_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(url, headers=headers)
    return resp.status_code < 400
