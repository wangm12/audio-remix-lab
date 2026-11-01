import os
import shutil
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

from app.config import settings

ALLOWED_SOURCE_EXTENSIONS = frozenset({"mp3", "wav", "flac", "ogg", "m4a"})


class InvalidStorageKey(ValueError):
    """A storage key that is not a safe relative path inside STORAGE_PATH."""


def storage_root() -> Path:
    root = Path(settings.STORAGE_PATH).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_key(key: str) -> Path:
    if not key or "\x00" in key or "\\" in key:
        raise InvalidStorageKey(f"Invalid storage key: {key!r}")
    if PurePosixPath(key).is_absolute() or any(part in ("", ".", "..") for part in key.split("/")):
        raise InvalidStorageKey(f"Invalid storage key: {key!r}")
    root = storage_root()
    try:
        resolved = (root / key).resolve()
    except (RuntimeError, OSError):
        raise InvalidStorageKey(f"Unresolvable storage key: {key!r}") from None
    if resolved == root or not resolved.is_relative_to(root):
        raise InvalidStorageKey(f"Storage key escapes the storage root: {key!r}")
    return resolved


def song_prefix(user_id: uuid.UUID | str, song_id: uuid.UUID | str) -> str:
    return f"users/{user_id}/songs/{song_id}"


def song_source_key(user_id: uuid.UUID | str, song_id: uuid.UUID | str, extension: str) -> str:
    if extension not in ALLOWED_SOURCE_EXTENSIONS:
        raise InvalidStorageKey(f"Unsupported source extension: {extension!r}")
    return f"{song_prefix(user_id, song_id)}/source.{extension}"


def _partial_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.{uuid.uuid4().hex}.part")


@contextmanager
def _atomic_target(path: Path) -> Iterator[Path]:
    """Yield a temp `.part` path; rename it onto `path` on success, remove it on any failure."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = _partial_path(path)
    try:
        yield partial
        os.replace(partial, path)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


def write_key(key: str, data: bytes) -> Path:
    path = resolve_key(key)
    with _atomic_target(path) as partial:
        partial.write_bytes(data)
    return path


def store_file(key: str, source: Path) -> Path:
    path = resolve_key(key)
    with _atomic_target(path) as partial:
        shutil.copyfile(source, partial)
    return path


def delete_key(key: str | None) -> None:
    if not key:
        return
    try:
        path = resolve_key(key)
    except InvalidStorageKey:
        return
    path.unlink(missing_ok=True)


def delete_prefix(prefix: str) -> None:
    path = resolve_key(prefix)
    if path.is_dir():
        shutil.rmtree(path)


def legacy_file_path(path: str | None) -> Path | None:
    """Resolve a legacy path column (e.g. generation_tasks.output_audio_path); trusted only inside STORAGE_PATH."""
    if not path:
        return None
    candidate = Path(path).expanduser().resolve()
    if candidate.is_relative_to(storage_root()) and candidate.is_file():
        return candidate
    return None


def delete_legacy_file(path: str | None) -> None:
    candidate = legacy_file_path(path)
    if candidate is not None:
        candidate.unlink(missing_ok=True)

