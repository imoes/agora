import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKey


class File(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "files"

    md5_hash: Mapped[str] = mapped_column(
        String(32), unique=True, nullable=False, index=True
    )
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)

    references = relationship(
        "FileReference", back_populates="file", cascade="all, delete-orphan"
    )


class FileReference(Base, UUIDPrimaryKey, TimestampMixin):
    __tablename__ = "file_references"

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("files.id"), nullable=False
    )
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channels.id"), nullable=True
    )
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)

    file = relationship("File", back_populates="references")
    channel = relationship("Channel", back_populates="file_references")
    uploader = relationship("User", back_populates="file_references")
