from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ACCESS_SCOPE, decode_access_token
from app.database import get_db
from app.models.user import User

MEDIA_COOKIE_NAME = "remix_media"

bearer_scheme = HTTPBearer()
optional_bearer_scheme = HTTPBearer(auto_error=False)


async def _user_from_subject(db: AsyncSession, subject: str | None) -> User | None:
    if subject is None:
        return None
    try:
        user_id = UUID(subject)
    except ValueError:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    subject = decode_access_token(credentials.credentials, scope=ACCESS_SCOPE)
    if subject is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = await _user_from_subject(db, subject)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if credentials is None:
        return None
    return await _user_from_subject(db, decode_access_token(credentials.credentials, scope=ACCESS_SCOPE))
