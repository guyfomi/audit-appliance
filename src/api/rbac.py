"""RBAC granulaire — permissions par endpoint."""
from __future__ import annotations
from enum import Enum
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


class Permission(str, Enum):
    EVENTS_READ      = "events:read"
    EVENTS_EXPORT    = "events:export"
    ALERTS_READ      = "alerts:read"
    ALERTS_ACK       = "alerts:ack"
    ALERTS_RESOLVE   = "alerts:resolve"
    RULES_READ       = "rules:read"
    RULES_WRITE      = "rules:write"
    INTEGRITY_READ   = "integrity:read"
    INTEGRITY_VERIFY = "integrity:verify"
    CDC_READ         = "cdc:read"
    CDC_CONTROL      = "cdc:control"
    USERS_READ       = "users:read"
    USERS_WRITE      = "users:write"
    DATABASES_WRITE  = "databases:write"
    ARCHIVE_CONTROL  = "archive:control"
    SYSTEM_HEALTH    = "system:health"


_ROLE_PERMISSIONS: dict[str, set[Permission]] = {
    "READONLY": {
        Permission.EVENTS_READ,
        Permission.ALERTS_READ,
        Permission.RULES_READ,
        Permission.INTEGRITY_READ,
        Permission.CDC_READ,
        Permission.SYSTEM_HEALTH,
    },
}
_ROLE_PERMISSIONS["ANALYST"] = _ROLE_PERMISSIONS["READONLY"] | {
    Permission.EVENTS_EXPORT,
    Permission.ALERTS_ACK,
    Permission.ALERTS_RESOLVE,
}
_ROLE_PERMISSIONS["AUDITOR"] = _ROLE_PERMISSIONS["ANALYST"] | {
    Permission.INTEGRITY_VERIFY,
    Permission.CDC_CONTROL,
    Permission.USERS_READ,
}
_ROLE_PERMISSIONS["ADMIN"] = set(Permission)


def has_permission(role: str, permission: Permission) -> bool:
    return permission in _ROLE_PERMISSIONS.get(role, set())


def require_permission(permission: Permission):
    """Dépendance FastAPI pour le contrôle de permission granulaire."""
    async def _check(
        request: Request,
        token:   str = Depends(oauth2_scheme),
    ):
        from api.auth import get_current_user
        user = await get_current_user(request, token)
        if not has_permission(user.role, permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Permission '{permission.value}' required"
            )
        return user
    return _check
