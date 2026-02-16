import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.channel import Channel
from app.models.file import FileReference
from app.models.file import File as FileModel
from app.models.user import User
from app.schemas.file import FileReferenceOut
from app.services.auth import get_current_user
from app.services.file_store import get_file_path, store_file

router = APIRouter(prefix="/api/files", tags=["files"])


@router.post("/upload", response_model=FileReferenceOut, status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    channel_id: uuid.UUID | None = Form(None),
    message_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_file, ref = await store_file(
        db, file, current_user.id, channel_id, message_id
    )
    await db.refresh(ref)
    await db.refresh(db_file)

    return FileReferenceOut(
        id=ref.id,
        file_id=db_file.id,
        channel_id=ref.channel_id,
        uploader_id=ref.uploader_id,
        original_filename=ref.original_filename,
        file={
            "id": db_file.id,
            "md5_hash": db_file.md5_hash,
            "file_size": db_file.file_size,
            "mime_type": db_file.mime_type,
            "created_at": db_file.created_at,
        },
        created_at=ref.created_at,
    )


@router.get("/download/{ref_id}")
async def download_file(
    ref_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await get_file_path(db, ref_id)
    if not result:
        raise HTTPException(status_code=404, detail="File not found")

    file_path, original_name, _mime_type = result
    return FileResponse(
        path=file_path,
        filename=original_name,
        media_type="application/octet-stream",
    )


# Allowed MIME prefixes that may be rendered inline by the browser
_INLINE_PREFIXES = ("image/", "video/", "audio/")


@router.get("/inline/{ref_id}")
async def inline_file(
    ref_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve a file with its real MIME type so browsers can render it inline."""
    result = await get_file_path(db, ref_id)
    if not result:
        raise HTTPException(status_code=404, detail="File not found")

    file_path, original_name, mime_type = result

    # Only serve known safe media types inline; fall back to download for others
    if not any(mime_type.startswith(p) for p in _INLINE_PREFIXES):
        return FileResponse(
            path=file_path,
            filename=original_name,
            media_type="application/octet-stream",
        )

    return FileResponse(
        path=file_path,
        filename=original_name,
        media_type=mime_type,
        headers={"Content-Disposition": f'inline; filename="{original_name}"'},
    )


@router.get("/channel/{channel_id}", response_model=list[FileReferenceOut])
async def list_channel_files(
    channel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(FileReference, FileModel)
        .join(FileModel, FileReference.file_id == FileModel.id)
        .where(FileReference.channel_id == channel_id)
        .order_by(FileReference.created_at.desc())
    )
    rows = result.all()
    return [
        FileReferenceOut(
            id=ref.id,
            file_id=ref.file_id,
            channel_id=ref.channel_id,
            uploader_id=ref.uploader_id,
            original_filename=ref.original_filename,
            file={
                "id": f.id,
                "md5_hash": f.md5_hash,
                "file_size": f.file_size,
                "mime_type": f.mime_type,
                "created_at": f.created_at,
            },
            created_at=ref.created_at,
        )
        for ref, f in rows
    ]


@router.get("/team/{team_id}", response_model=list[FileReferenceOut])
async def list_team_files(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all files shared in any channel belonging to a team."""
    result = await db.execute(
        select(FileReference, FileModel)
        .join(FileModel, FileReference.file_id == FileModel.id)
        .join(Channel, FileReference.channel_id == Channel.id)
        .where(Channel.team_id == team_id)
        .order_by(FileReference.created_at.desc())
    )
    rows = result.all()
    return [
        FileReferenceOut(
            id=ref.id,
            file_id=ref.file_id,
            channel_id=ref.channel_id,
            uploader_id=ref.uploader_id,
            original_filename=ref.original_filename,
            file={
                "id": f.id,
                "md5_hash": f.md5_hash,
                "file_size": f.file_size,
                "mime_type": f.mime_type,
                "created_at": f.created_at,
            },
            created_at=ref.created_at,
        )
        for ref, f in rows
    ]
