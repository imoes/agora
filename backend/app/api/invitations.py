"""API-Endpoints fuer Einladungen per E-Mail mit ICS-Anhang."""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.channel import Channel, ChannelMember
from app.models.invitation import Invitation
from app.models.user import User
from app.schemas.invitation import InvitationCreate, InvitationOut, InviteAcceptResponse
from app.services.auth import get_current_user
from app.services.email import send_invitation_email
from app.services.ics import generate_invitation_ics

router = APIRouter(prefix="/api/invitations", tags=["invitations"])

INVITATION_EXPIRY_DAYS = 7


@router.post(
    "/channel/{channel_id}",
    response_model=InvitationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    channel_id: uuid.UUID,
    data: InvitationCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Erstellt eine Einladung und sendet eine E-Mail mit ICS-Anhang."""
    # Pruefen, ob der User Mitglied des Channels ist
    membership = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Nicht Mitglied des Channels")

    # Channel laden
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel nicht gefunden")

    # Pruefen ob bereits eine aktive Einladung existiert
    existing = await db.execute(
        select(Invitation).where(
            and_(
                Invitation.channel_id == channel_id,
                Invitation.invited_email == data.email,
                Invitation.status == "pending",
                Invitation.expires_at > datetime.now(timezone.utc),
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail="Aktive Einladung fuer diese E-Mail existiert bereits",
        )

    # Einladung erstellen
    invitation = Invitation(
        channel_id=channel_id,
        invited_by=current_user.id,
        invited_email=data.email,
        message=data.message,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITATION_EXPIRY_DAYS),
    )
    db.add(invitation)
    await db.flush()
    await db.refresh(invitation)

    # Einladungs-Link erstellen
    invite_link = f"{settings.frontend_url}/invite/{channel.invite_token}"

    # ICS generieren
    ics_content = generate_invitation_ics(
        channel_name=channel.name,
        inviter_name=current_user.display_name,
        inviter_email=current_user.email,
        invited_email=data.email,
        invite_link=invite_link,
        message=data.message,
    )

    # E-Mail im Hintergrund senden
    async def send_email_task():
        import logging
        logger = logging.getLogger(__name__)
        try:
            success = await send_invitation_email(
                to_email=data.email,
                channel_name=channel.name,
                inviter_name=current_user.display_name,
                invite_link=invite_link,
                ics_content=ics_content,
                message=data.message,
            )
            if success:
                try:
                    from app.database import async_session
                    async with async_session() as session:
                        inv = await session.get(Invitation, invitation.id)
                        if inv:
                            inv.email_sent = True
                            await session.commit()
                except Exception as e:
                    logger.warning(f"email_sent Flag konnte nicht aktualisiert werden: {e}")
        except Exception as e:
            logger.error(f"Hintergrund-E-Mail-Versand fehlgeschlagen: {e}")

    background_tasks.add_task(send_email_task)

    return InvitationOut(
        id=invitation.id,
        channel_id=invitation.channel_id,
        channel_name=channel.name,
        invited_by=invitation.invited_by,
        inviter_name=current_user.display_name,
        invited_email=invitation.invited_email,
        message=invitation.message,
        status=invitation.status,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        email_sent=False,
    )


@router.get("/channel/{channel_id}", response_model=list[InvitationOut])
async def list_channel_invitations(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Listet alle Einladungen fuer einen Channel auf."""
    membership = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Nicht Mitglied des Channels")

    result = await db.execute(
        select(Invitation, Channel.name, User.display_name)
        .join(Channel, Invitation.channel_id == Channel.id)
        .join(User, Invitation.invited_by == User.id)
        .where(Invitation.channel_id == channel_id)
        .order_by(Invitation.created_at.desc())
    )
    rows = result.all()

    return [
        InvitationOut(
            id=inv.id,
            channel_id=inv.channel_id,
            channel_name=ch_name,
            invited_by=inv.invited_by,
            inviter_name=inviter_name,
            invited_email=inv.invited_email,
            message=inv.message,
            status=inv.status,
            expires_at=inv.expires_at,
            created_at=inv.created_at,
            email_sent=inv.email_sent,
        )
        for inv, ch_name, inviter_name in rows
    ]


@router.get("/accept/{invite_token}", response_model=InviteAcceptResponse)
async def accept_invitation_by_token(
    invite_token: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Akzeptiert eine Einladung ueber den Channel-Token und fuegt den User als Mitglied hinzu."""
    result = await db.execute(
        select(Channel).where(Channel.invite_token == invite_token)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Ungueltiger Einladungs-Token")

    # Pruefen ob User bereits Mitglied ist
    existing = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel.id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if existing.scalar_one_or_none():
        return InviteAcceptResponse(
            channel_id=channel.id,
            channel_name=channel.name,
            status="already_member",
        )

    # User als Mitglied hinzufuegen
    member = ChannelMember(channel_id=channel.id, user_id=current_user.id)
    db.add(member)

    # Passendes Invitation-Objekt aktualisieren (falls vorhanden)
    inv_result = await db.execute(
        select(Invitation).where(
            and_(
                Invitation.channel_id == channel.id,
                Invitation.invited_email == current_user.email,
                Invitation.status == "pending",
            )
        )
    )
    invitation = inv_result.scalar_one_or_none()
    if invitation:
        invitation.status = "accepted"
        invitation.accepted_at = datetime.now(timezone.utc)

    await db.flush()

    return InviteAcceptResponse(
        channel_id=channel.id,
        channel_name=channel.name,
        status="joined",
    )


@router.post("/channel/{channel_id}/regenerate-token")
async def regenerate_invite_token(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generiert einen neuen Einladungs-Token fuer den Channel."""
    membership = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Nicht Mitglied des Channels")

    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel nicht gefunden")

    channel.invite_token = secrets.token_urlsafe(32)
    await db.flush()

    return {"invite_token": channel.invite_token}


@router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Widerruft eine ausstehende Einladung."""
    result = await db.execute(
        select(Invitation).where(Invitation.id == invitation_id)
    )
    invitation = result.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")

    # Pruefen ob der User Mitglied des Channels ist
    membership = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == invitation.channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Nicht Mitglied des Channels")

    if invitation.status != "pending":
        raise HTTPException(
            status_code=400, detail="Nur ausstehende Einladungen koennen widerrufen werden"
        )

    invitation.status = "declined"
    await db.flush()


@router.get("/channel/{channel_id}/ics/{invitation_id}")
async def download_ics(
    channel_id: uuid.UUID,
    invitation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Laed die ICS-Datei fuer eine bestimmte Einladung herunter."""
    from fastapi.responses import Response

    invitation = await db.get(Invitation, invitation_id)
    if not invitation or invitation.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Einladung nicht gefunden")

    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel nicht gefunden")

    invite_link = f"{settings.frontend_url}/invite/{channel.invite_token}"

    ics_content = generate_invitation_ics(
        channel_name=channel.name,
        inviter_name=current_user.display_name,
        inviter_email=current_user.email,
        invited_email=invitation.invited_email,
        invite_link=invite_link,
        message=invitation.message,
    )

    return Response(
        content=ics_content,
        media_type="text/calendar",
        headers={"Content-Disposition": "attachment; filename=einladung.ics"},
    )
