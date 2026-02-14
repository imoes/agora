"""Calendar provider sync helpers.

Provides a thin abstraction over different calendar back-ends so the
API layer can create / read / update / delete events in a uniform way.

Supported providers:
  - WebDAV / CalDAV  (URL + username + password)
  - Google Calendar  (Google email + app password via CalDAV)
  - Outlook Exchange (EWS server URL + username + password)
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
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
# Google Calendar  (CalDAV with Google account email + app password)
# ---------------------------------------------------------------------------

GOOGLE_CALDAV_BASE = "https://apidata.googleusercontent.com/caldav/v2"


def _google_caldav_url(integration: CalendarIntegration) -> str | None:
    """Build the CalDAV URL for Google Calendar."""
    if not integration.google_email:
        return None
    return f"{GOOGLE_CALDAV_BASE}/{integration.google_email}/events/"


async def google_list_events(
    integration: CalendarIntegration,
    range_start: datetime,
    range_end: datetime,
) -> list[dict[str, Any]]:
    """List events from Google Calendar via CalDAV."""
    caldav_url = _google_caldav_url(integration)
    if not caldav_url or not integration.google_app_password:
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
    auth = (integration.google_email, integration.google_app_password)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.request(
            "REPORT",
            caldav_url,
            content=body,
            headers={"Content-Type": "application/xml; charset=utf-8", "Depth": "1"},
            auth=auth,
        )
    if resp.status_code >= 400:
        return []
    return _parse_caldav_response(resp.text)


async def google_create_event(
    integration: CalendarIntegration,
    title: str,
    start: datetime,
    end: datetime,
    description: str | None = None,
    location: str | None = None,
) -> str | None:
    """Create a Google Calendar event via CalDAV PUT. Returns UID."""
    caldav_url = _google_caldav_url(integration)
    if not caldav_url or not integration.google_app_password:
        return None
    import uuid as _uuid

    uid = str(_uuid.uuid4())
    ical_bytes = _ical_event(uid, title, start, end, description, location)
    url = caldav_url.rstrip("/") + f"/{uid}.ics"
    auth = (integration.google_email, integration.google_app_password)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            url,
            content=ical_bytes,
            headers={"Content-Type": "text/calendar; charset=utf-8"},
            auth=auth,
        )
    return uid if resp.status_code < 400 else None


async def google_delete_event(integration: CalendarIntegration, event_id: str) -> bool:
    """Delete a Google Calendar event via CalDAV DELETE."""
    caldav_url = _google_caldav_url(integration)
    if not caldav_url or not integration.google_app_password:
        return False
    url = caldav_url.rstrip("/") + f"/{event_id}.ics"
    auth = (integration.google_email, integration.google_app_password)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.delete(url, auth=auth)
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
    if resp is None or resp.status_code >= 400:
        return []
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
