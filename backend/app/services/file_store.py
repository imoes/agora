import hashlib
import os
import uuid

import aiofiles
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.file import File, FileReference


async def compute_md5(file: UploadFile) -> str:
    md5 = hashlib.md5()
    await file.seek(0)
    while chunk := await file.read(8192):
        md5.update(chunk)
    await file.seek(0)
    return md5.hexdigest()


def _storage_path(md5_hash: str) -> str:
    subdir = md5_hash[:2]
    return os.path.join(settings.upload_dir, subdir, md5_hash)


async def store_file(
    db: AsyncSession,
    file: UploadFile,
    uploader_id: uuid.UUID,
    channel_id: uuid.UUID | None = None,
    message_id: str | None = None,
) -> tuple[File, FileReference]:
    md5_hash = await compute_md5(file)

    result = await db.execute(select(File).where(File.md5_hash == md5_hash))
    existing_file = result.scalar_one_or_none()

    if existing_file is None:
        storage_path = _storage_path(md5_hash)
        os.makedirs(os.path.dirname(storage_path), exist_ok=True)

        async with aiofiles.open(storage_path, "wb") as f:
            await file.seek(0)
            while chunk := await file.read(8192):
                await f.write(chunk)

        file_size = os.path.getsize(storage_path)
        db_file = File(
            md5_hash=md5_hash,
            file_path=storage_path,
            file_size=file_size,
            mime_type=file.content_type or "application/octet-stream",
        )
        db.add(db_file)
        await db.flush()
    else:
        db_file = existing_file

    ref = FileReference(
        file_id=db_file.id,
        channel_id=channel_id,
        message_id=message_id,
        uploader_id=uploader_id,
        original_filename=file.filename or "unnamed",
    )
    db.add(ref)
    await db.flush()

    return db_file, ref


async def get_file_path(db: AsyncSession, file_ref_id: uuid.UUID) -> tuple[str, str] | None:
    result = await db.execute(
        select(FileReference)
        .where(FileReference.id == file_ref_id)
        .options()
    )
    ref = result.scalar_one_or_none()
    if ref is None:
        return None

    file_result = await db.execute(select(File).where(File.id == ref.file_id))
    db_file = file_result.scalar_one_or_none()
    if db_file is None:
        return None

    return db_file.file_path, ref.original_filename
