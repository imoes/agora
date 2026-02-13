import secrets
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKey, UUIDType


def _generate_invite_token() -> str:
    return secrets.token_urlsafe(32)


class Channel(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "channels"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="group"
    )  # 'direct', 'group', 'team'
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType(),
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=True,
    )
    sqlite_db_path: Mapped[str] = mapped_column(String(512), nullable=False)
    invite_token: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, default=_generate_invite_token
    )

    team = relationship("Team", back_populates="channels")
    members = relationship(
        "ChannelMember", back_populates="channel", cascade="all, delete-orphan"
    )
    file_references = relationship("FileReference", back_populates="channel")
    invitations = relationship(
        "Invitation", back_populates="channel", cascade="all, delete-orphan"
    )


class ChannelMember(Base, TimestampMixin):
    __tablename__ = "channel_members"
    __table_args__ = (UniqueConstraint("channel_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(),
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("users.id"), nullable=False
    )
    last_read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    channel = relationship("Channel", back_populates="members")
    user = relationship("User", back_populates="channel_memberships")
