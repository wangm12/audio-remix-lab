from uuid import UUID
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.security import BCRYPT_MAX_PASSWORD_BYTES

PASSWORD_MIN_LENGTH = 8


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=PASSWORD_MIN_LENGTH)
    invite_code: str | None = None

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must be at most {BCRYPT_MAX_PASSWORD_BYTES} bytes")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: UUID
    email: str
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}
