from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.core.security import hash_password, verify_password, create_access_token


def _is_email_unique_violation(error: IntegrityError) -> bool:
    pending = [error.orig]
    seen: set[int] = set()
    while pending:
        cause = pending.pop()
        if cause is None or id(cause) in seen:
            continue
        seen.add(id(cause))
        sqlstate = getattr(cause, "sqlstate", None) or getattr(cause, "pgcode", None)
        constraint_name = getattr(cause, "constraint_name", None)
        if sqlstate == "23505" and constraint_name == "ix_users_email":
            return True
        pending.extend((getattr(cause, "__cause__", None), getattr(cause, "__context__", None)))
    return False


async def register_user(db: AsyncSession, email: str, username: str, password: str) -> User:
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise ValueError("Email already registered")

    user = User(email=email, username=username, hashed_password=hash_password(password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as error:
        duplicate_email = _is_email_unique_violation(error)
        await db.rollback()
        if duplicate_email:
            raise ValueError("Email already registered") from error
        raise
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
