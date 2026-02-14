from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKey


class User(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="offline"
    )
    status_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    auth_source: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="local"
    )  # 'local' or 'ldap'

    owned_teams = relationship("Team", back_populates="owner")
    team_memberships = relationship("TeamMember", back_populates="user")
    channel_memberships = relationship("ChannelMember", back_populates="user")
    file_references = relationship("FileReference", back_populates="uploader")
    feed_events = relationship("FeedEvent", back_populates="user", foreign_keys="[FeedEvent.user_id]")
    calendar_events = relationship("CalendarEvent", back_populates="user", cascade="all, delete-orphan")
    calendar_integration = relationship(
        "CalendarIntegration", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
