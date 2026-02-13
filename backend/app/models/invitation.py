import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKey, UUIDType


class Invitation(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "invitations"

    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(),
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    invited_by: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("users.id"), nullable=False
    )
    invited_email: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )  # 'pending', 'accepted', 'declined', 'expired'
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    email_sent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="0"
    )

    channel = relationship("Channel", back_populates="invitations")
    inviter = relationship("User", foreign_keys=[invited_by])
