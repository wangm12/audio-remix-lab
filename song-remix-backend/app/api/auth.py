import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.deps import MEDIA_COOKIE_NAME, get_current_user
from app.core.rate_limit import login_rate_limiter
from app.core.security import MEDIA_SCOPE, create_access_token
from app.database import get_db
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import authenticate_user, create_token_for_user, register_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

MEDIA_COOKIE_PATH = "/api"


def set_media_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        key=MEDIA_COOKIE_NAME,
        value=create_access_token(subject=str(user.id), scope=MEDIA_SCOPE),
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
        path=MEDIA_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, response: Response, db: AsyncSession = Depends(get_db)):
    invite = settings.REGISTRATION_INVITE_CODE
    submitted = (req.invite_code or "").encode("utf-8")
    if invite and not secrets.compare_digest(submitted, invite.encode("utf-8")):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="A valid invite code is required to register")
    try:
        user = await register_user(db, req.email, req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    set_media_cookie(response, user)
    return TokenResponse(access_token=create_token_for_user(user))


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    key = _client_key(request)
    retry_after = login_rate_limiter.retry_after(key)
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts; try again later",
            headers={"Retry-After": str(retry_after)},
        )
    # Reserve the slot before awaiting authentication, bounding same-IP concurrency.
    login_rate_limiter.hit(key)
    user = await authenticate_user(db, req.email, req.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    login_rate_limiter.reset(key)
    set_media_cookie(response, user)
    return TokenResponse(access_token=create_token_for_user(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie(
        key=MEDIA_COOKIE_NAME,
        path=MEDIA_COOKIE_PATH,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
    )


@router.get("/me", response_model=UserResponse)
async def me(response: Response, current_user: User = Depends(get_current_user)):
    set_media_cookie(response, current_user)
    return current_user
