import os
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.schemas.user import Token, UserCreate, UserLogin, UserOut, UserUpdate
from app.services.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.services.ldap_auth import ldap_authenticate

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(data: UserCreate, db: AsyncSession = Depends(get_db)):
    if not settings.allow_registration:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration disabled. Please contact an administrator.",
        )

    # Check for duplicate username or email
    existing = await db.execute(
        select(User).where(
            (func.lower(User.username) == data.username.lower())
            | (func.lower(User.email) == data.email.lower())
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already exists",
        )

    user = User(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)

    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
async def login(data: UserLogin, db: AsyncSession = Depends(get_db)):
    # Try LDAP authentication first if enabled
    if settings.ldap_enabled:
        ldap_user = ldap_authenticate(data.username, data.password)
        if ldap_user:
            # Find or create local user from LDAP
            result = await db.execute(
                select(User).where(func.lower(User.username) == ldap_user["username"].lower())
            )
            user = result.scalar_one_or_none()

            if not user:
                # Create local user from LDAP data on first login
                user = User(
                    username=ldap_user["username"],
                    email=ldap_user["email"],
                    password_hash=hash_password("ldap-managed"),
                    display_name=ldap_user["display_name"],
                    is_admin=ldap_user.get("is_admin", False),
                    auth_source="ldap",
                )
                db.add(user)
                await db.flush()
                await db.refresh(user)
            else:
                # Update attributes from LDAP on each login
                user.email = ldap_user["email"]
                user.display_name = ldap_user["display_name"]
                user.is_admin = ldap_user.get("is_admin", False)
                user.auth_source = "ldap"

            user.status = "online"
            await db.flush()

            token = create_access_token(user.id)
            return Token(access_token=token, user=UserOut.model_validate(user))

        # LDAP auth failed
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # Local authentication (case-insensitive)
    result = await db.execute(select(User).where(func.lower(User.username) == data.username.lower()))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    user.status = "online"
    await db.flush()

    token = create_access_token(user.id)
    return Token(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if data.display_name is not None:
        current_user.display_name = data.display_name
    if data.status_message is not None:
        current_user.status_message = data.status_message
    if data.status is not None:
        current_user.status = data.status
    if data.language is not None:
        current_user.language = data.language
    if data.email is not None:
        # Check email uniqueness
        dup = await db.execute(
            select(User).where(
                func.lower(User.email) == data.email.lower(),
                User.id != current_user.id,
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already in use",
            )
        current_user.email = data.email
    if data.password is not None:
        if not data.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password required",
            )
        if not verify_password(data.current_password, current_user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Current password is incorrect",
            )
        current_user.password_hash = hash_password(data.password)
    await db.flush()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a profile avatar image."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    # Max 5MB
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5MB)")

    avatar_dir = os.path.join(settings.upload_dir, "avatars")
    os.makedirs(avatar_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "avatar.png")[1] or ".png"
    filename = f"{current_user.id}{ext}"
    filepath = os.path.join(avatar_dir, filename)

    # Delete old avatar if it exists with a different extension
    for old in os.listdir(avatar_dir):
        if old.startswith(str(current_user.id)) and old != filename:
            os.remove(os.path.join(avatar_dir, old))

    with open(filepath, "wb") as f:
        f.write(content)

    current_user.avatar_path = f"/api/auth/avatar/{current_user.id}/{filename}"
    await db.flush()
    await db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.get("/avatar/{user_id}/{filename}")
async def get_avatar(user_id: _uuid.UUID, filename: str):
    """Serve a user's avatar image."""
    avatar_dir = os.path.join(settings.upload_dir, "avatars")
    filepath = os.path.join(avatar_dir, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Avatar not found")
    return FileResponse(filepath, media_type="image/png")


@router.get("/config")
async def get_auth_config():
    """Public endpoint to check auth configuration."""
    return {
        "ldap_enabled": settings.ldap_enabled,
        "registration_enabled": settings.allow_registration,
    }
