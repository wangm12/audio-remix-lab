from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_optional_user(
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(HTTPBearer(auto_error=False)),
) -> User | None:
    if credentials is None:
        return None
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        return None
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    return result.scalar_one_or_none()
