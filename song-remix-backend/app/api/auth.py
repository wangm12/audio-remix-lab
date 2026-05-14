from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.auth import RegisterRequest, LoginRequest, TokenResponse, UserResponse
from app.services.auth_service import register_user, authenticate_user, create_token_for_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    try:
        user = await register_user(db, req.email, req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    token = create_token_for_user(user)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await authenticate_user(db, req.email, req.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_token_for_user(user)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
