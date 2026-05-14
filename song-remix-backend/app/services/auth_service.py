from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.core.security import hash_password, verify_password, create_access_token


async def register_user(db: AsyncSession, email: str, username: str, password: str) -> User:
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")

    user = User(email=email, username=username, hashed_password=hash_password(password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.hashed_password):
        return None
    return user


def create_token_for_user(user: User) -> str:
    return create_access_token(subject=str(user.id))
