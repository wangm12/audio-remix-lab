import os
import uuid

from app.config import settings


def get_upload_dir() -> str:
    path = os.path.join(settings.STORAGE_PATH, "uploads")
    os.makedirs(path, exist_ok=True)
    return path


def save_upload(content: bytes, original_filename: str) -> str:
    ext = os.path.splitext(original_filename)[1] or ".mp3"
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.abspath(os.path.join(get_upload_dir(), filename))
    with open(filepath, "wb") as f:
        f.write(content)
    return filepath
