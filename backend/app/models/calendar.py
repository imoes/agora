import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKey, UUIDType


class CalendarEvent(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "calendar_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    all_day: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType(),
        ForeignKey("channels.id", ondelete="SET NULL"),
        nullable=True,
    )
    external_id: Mapped[str | None] = mapped_column(
        String(512), nullable=True
    )  # ID in external calendar system

    user = relationship("User", back_populates="calendar_events")
    channel = relationship("Channel")


class CalendarIntegration(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "calendar_integrations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("users.id"), nullable=False, unique=True
    )
    provider: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="internal"
    )  # 'internal', 'webdav', 'google', 'outlook'

    # WebDAV / CalDAV
    webdav_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    webdav_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    webdav_password: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Google Calendar (CalDAV with Google account)
    google_email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    google_app_password: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Outlook / Exchange (EWS with username + password)
    outlook_server_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    outlook_username: Mapped[str | None] = mapped_column(String(200), nullable=True)
    outlook_password: Mapped[str | None] = mapped_column(String(200), nullable=True)

    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user = relationship("User", back_populates="calendar_integration")
