import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKey, UUIDType


class FeedEvent(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "feed_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("users.id"), nullable=False, index=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("channels.id"), nullable=False
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType(), ForeignKey("users.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="message"
    )  # 'message', 'file', 'mention', 'reaction'
    preview_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_read: Mapped[bool] = mapped_column(default=False, nullable=False)

    user = relationship("User", back_populates="feed_events", foreign_keys=[user_id])
    channel = relationship("Channel")
