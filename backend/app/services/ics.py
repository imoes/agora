"""ICS-Kalendereinladungen generieren."""
import uuid
from datetime import datetime, timedelta, timezone

from icalendar import Calendar, Event, vText

from app.config import settings


def generate_invitation_ics(
    channel_name: str,
    inviter_name: str,
    inviter_email: str,
    invited_email: str,
    invite_link: str,
    start_time: datetime | None = None,
    message: str | None = None,
) -> bytes:
    """Erstellt eine ICS-Datei fuer eine Chat-Einladung.

    Wenn keine start_time angegeben ist, wird jetzt + 15 Minuten verwendet.
    """
    cal = Calendar()
    cal.add("prodid", "-//Agora Teams Clone//DE")
    cal.add("version", "2.0")
    cal.add("method", "REQUEST")

    event = Event()
    event.add("uid", str(uuid.uuid4()))
    event.add("summary", f"Chat-Einladung: {channel_name}")

    description = f"{inviter_name} hat Sie zum Chat \"{channel_name}\" eingeladen.\n"
    if message:
        description += f"Nachricht: {message}\n"
    description += f"\nBeitreten: {invite_link}"
    event.add("description", description)

    if start_time is None:
        start_time = datetime.now(timezone.utc) + timedelta(minutes=15)
    event.add("dtstart", start_time)
    event.add("dtend", start_time + timedelta(hours=1))
    event.add("dtstamp", datetime.now(timezone.utc))

    event.add("organizer", f"mailto:{inviter_email}")
    event.add("attendee", f"mailto:{invited_email}")

    event.add("url", invite_link)
    event.add("status", "CONFIRMED")

    cal.add_component(event)

    return cal.to_ical()
