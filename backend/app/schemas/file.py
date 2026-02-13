import uuid
from datetime import datetime

from pydantic import BaseModel


class FileOut(BaseModel):
    id: uuid.UUID
    md5_hash: str
    file_size: int
    mime_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FileReferenceOut(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    channel_id: uuid.UUID | None = None
    uploader_id: uuid.UUID
    original_filename: str
    file: FileOut
    created_at: datetime

    model_config = {"from_attributes": True}
