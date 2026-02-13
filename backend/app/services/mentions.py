"""@Mention-Erkennung und Verarbeitung in Nachrichten."""
import re
import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelMember
from app.models.user import User

# Regex: @username oder @"Vorname Nachname"
# Einfache Mentions: Wortzeichen (Buchstaben, Ziffern, Unterstrich, Bindestrich)
MENTION_PATTERN = re.compile(r'@"([^"]+)"|@([\w.-]+)', re.UNICODE)


def extract_mentions(content: str) -> list[str]:
    """Extrahiert alle @mentions aus dem Nachrichtentext.

    Unterstuetzt:
      - @username
      - @"Vorname Nachname"
    """
    mentions = []
    for match in MENTION_PATTERN.finditer(content):
        quoted = match.group(1)
        simple = match.group(2)
        mentions.append(quoted if quoted else simple)
    return mentions


async def resolve_mentions(
    db: AsyncSession,
    mentions: list[str],
    channel_id: uuid.UUID,
) -> list[uuid.UUID]:
    """Loest Mention-Strings auf tatsaechliche User-IDs im Channel auf."""
    if not mentions:
        return []

    # Alle Channel-Mitglieder laden
    member_result = await db.execute(
        select(ChannelMember.user_id).where(
            ChannelMember.channel_id == channel_id
        )
    )
    member_ids = {row[0] for row in member_result.all()}

    resolved_ids = set()
    for mention_text in mentions:
        # Nach Username oder Display-Name suchen
        result = await db.execute(
            select(User).where(
                or_(
                    User.username.ilike(mention_text),
                    User.display_name.ilike(mention_text),
                )
            )
        )
        users = result.scalars().all()
        for user in users:
            if user.id in member_ids:
                resolved_ids.add(user.id)

    return list(resolved_ids)
