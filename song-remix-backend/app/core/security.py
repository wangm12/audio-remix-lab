from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from app.config import settings

ACCESS_SCOPE = "access"
MEDIA_SCOPE = "media"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(subject: str, expires_delta: timedelta | None = None, scope: str = ACCESS_SCOPE) -> str:
    expire = datetime.now(UTC) + (expires_delta or timedelta(minutes=settings.JWT_EXPIRE_MINUTES))
    payload = {"sub": subject, "exp": expire, "scope": scope}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str, scope: str = ACCESS_SCOPE) -> str | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("scope", ACCESS_SCOPE) != scope:
        return None
    subject = payload.get("sub")
    return subject if isinstance(subject, str) else None
