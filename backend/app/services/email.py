"""E-Mail-Service fuer Einladungen per SMTP."""
import logging
from email.message import EmailMessage
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders

import aiosmtplib

from app.config import settings

logger = logging.getLogger(__name__)


async def send_invitation_email(
    to_email: str,
    channel_name: str,
    inviter_name: str,
    invite_link: str,
    ics_content: bytes,
    message: str | None = None,
) -> bool:
    """Sendet eine Einladungs-E-Mail mit ICS-Anhang."""
    msg = MIMEMultipart("mixed")
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = f"Einladung zum Chat: {channel_name}"

    body_text = (
        f"Hallo,\n\n"
        f"{inviter_name} hat Sie zum Chat \"{channel_name}\" eingeladen.\n"
    )
    if message:
        body_text += f"\nNachricht: {message}\n"
    body_text += (
        f"\nKlicken Sie auf den folgenden Link, um dem Chat beizutreten:\n"
        f"{invite_link}\n\n"
        f"Im Anhang finden Sie eine Kalendereinladung (.ics).\n\n"
        f"Viele Gruesse,\nDas Agora-Team\n"
    )

    body_html = (
        f"<html><body>"
        f"<p>Hallo,</p>"
        f"<p><strong>{inviter_name}</strong> hat Sie zum Chat "
        f"<strong>\"{channel_name}\"</strong> eingeladen.</p>"
    )
    if message:
        body_html += f"<p><em>Nachricht: {message}</em></p>"
    body_html += (
        f"<p><a href=\"{invite_link}\" style=\"display:inline-block;padding:12px 24px;"
        f"background:#6200ee;color:white;text-decoration:none;border-radius:4px;\">"
        f"Chat beitreten</a></p>"
        f"<p>Im Anhang finden Sie eine Kalendereinladung (.ics).</p>"
        f"<p>Viele Gr&uuml;&szlig;e,<br>Das Agora-Team</p>"
        f"</body></html>"
    )

    alt_part = MIMEMultipart("alternative")
    alt_part.attach(MIMEText(body_text, "plain", "utf-8"))
    alt_part.attach(MIMEText(body_html, "html", "utf-8"))
    msg.attach(alt_part)

    # ICS-Anhang
    ics_part = MIMEBase("text", "calendar", method="REQUEST")
    ics_part.set_payload(ics_content)
    encoders.encode_base64(ics_part)
    ics_part.add_header(
        "Content-Disposition", "attachment", filename="einladung.ics"
    )
    msg.attach(ics_part)

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user or None,
            password=settings.smtp_password or None,
            use_tls=settings.smtp_use_tls,
        )
        logger.info(f"Einladungs-E-Mail an {to_email} gesendet")
        return True
    except Exception as e:
        logger.error(f"E-Mail-Versand an {to_email} fehlgeschlagen: {e}")
        return False
