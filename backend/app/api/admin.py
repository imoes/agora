from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


class LdapConfig(BaseModel):
    ldap_enabled: bool = False
    ldap_server: str = ""
    ldap_port: int = 389
    ldap_use_ssl: bool = False
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_base_dn: str = ""
    ldap_user_filter: str = "(sAMAccountName={username})"
    ldap_group_dn: str = ""
    ldap_username_attr: str = "sAMAccountName"
    ldap_email_attr: str = "mail"
    ldap_display_name_attr: str = "displayName"
    ldap_admin_group_dn: str = ""


@router.get("/ldap-config", response_model=LdapConfig)
async def get_ldap_config(admin: User = Depends(require_admin)):
    """Get current LDAP configuration (admin only)."""
    return LdapConfig(
        ldap_enabled=settings.ldap_enabled,
        ldap_server=settings.ldap_server,
        ldap_port=settings.ldap_port,
        ldap_use_ssl=settings.ldap_use_ssl,
        ldap_bind_dn=settings.ldap_bind_dn,
        ldap_bind_password="***" if settings.ldap_bind_password else "",
        ldap_base_dn=settings.ldap_base_dn,
        ldap_user_filter=settings.ldap_user_filter,
        ldap_group_dn=settings.ldap_group_dn,
        ldap_username_attr=settings.ldap_username_attr,
        ldap_email_attr=settings.ldap_email_attr,
        ldap_display_name_attr=settings.ldap_display_name_attr,
        ldap_admin_group_dn=settings.ldap_admin_group_dn,
    )


@router.get("/stats")
async def get_admin_stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get system statistics (admin only)."""
    total_users = await db.execute(select(func.count(User.id)))
    ldap_users = await db.execute(
        select(func.count(User.id)).where(User.auth_source == "ldap")
    )
    local_users = await db.execute(
        select(func.count(User.id)).where(User.auth_source == "local")
    )
    online_users = await db.execute(
        select(func.count(User.id)).where(User.status == "online")
    )
    admin_users = await db.execute(
        select(func.count(User.id)).where(User.is_admin == True)
    )
    return {
        "total_users": total_users.scalar(),
        "ldap_users": ldap_users.scalar(),
        "local_users": local_users.scalar(),
        "online_users": online_users.scalar(),
        "admin_users": admin_users.scalar(),
        "ldap_enabled": settings.ldap_enabled,
    }


class ToggleAdminRequest(BaseModel):
    user_id: str
    is_admin: bool


@router.post("/toggle-admin")
async def toggle_user_admin(
    data: ToggleAdminRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Toggle admin status for a user (admin only)."""
    import uuid

    result = await db.execute(select(User).where(User.id == uuid.UUID(data.user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_admin = data.is_admin
    await db.flush()
    return {"status": "ok", "user_id": str(user.id), "is_admin": user.is_admin}
