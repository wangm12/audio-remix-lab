from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status

from app.core.deps import get_current_user
from app.models.user import User
from app.utils.storage import save_upload

router = APIRouter(prefix="/api/upload", tags=["upload"])

ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/flac", "audio/ogg", "audio/m4a", "audio/mp4"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/audio")
async def upload_audio(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if file.content_type and file.content_type not in ALLOWED_AUDIO_TYPES:
        ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename else ""
        if ext not in ("mp3", "wav", "flac", "ogg", "m4a", "mp4"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported audio format: {file.content_type}",
            )

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large (max 50MB)")

    filepath = save_upload(content, file.filename or "upload.mp3")
    return {"path": filepath, "size": len(content)}
