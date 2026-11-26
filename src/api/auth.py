"""
Authentification JWT et RBAC pour l'API Oracle Data Audit.
"""
from __future__ import annotations
from datetime import datetime, timedelta, UTC
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy import text

from config.settings import settings
from db.session      import AsyncSession, get_session

auth_router    = APIRouter()
oauth2_scheme  = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")
ALGORITHM      = "HS256"


# ── Schémas ───────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type:   str
    expires_in:   int
    role:         str


class TokenData(BaseModel):
    user_id:  int
    username: str
    role:     str


# ── Login ─────────────────────────────────────────────────────────────────────

@auth_router.post("/token", response_model=Token)
async def login(
    request: Request,
    form:    OAuth2PasswordRequestForm = Depends(),
    db:      AsyncSession              = Depends(get_session),
):
    row = await db.execute(text("""
        SELECT id, password_hash, role, is_active
        FROM appliance_user WHERE username = :u
    """), {"u": form.username})
    user = row.fetchone()

    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not bcrypt.checkpw(form.password.encode(), user[1].encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user[3]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    token  = jwt.encode(
        {"sub": str(user[0]), "username": form.username, "role": user[2], "exp": expire},
        settings.jwt_secret, algorithm=ALGORITHM,
    )

    await db.execute(text(
        "UPDATE appliance_user SET last_login_at = now() WHERE id = :id"
    ), {"id": user[0]})
    await db.commit()

    # Poser l'user_id dans le state pour AdminAuditMiddleware
    request.state.user_id = user[0]

    return Token(
        access_token=token, token_type="bearer",
        expires_in=settings.jwt_expire_minutes * 60, role=user[2],
    )


# ── Dépendances ───────────────────────────────────────────────────────────────

async def get_current_user(
    request: Request,
    token:   str         = Depends(oauth2_scheme),
) -> TokenData:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        user_id  = int(payload["sub"])
        username = payload["username"]
        role     = payload["role"]
        td = TokenData(user_id=user_id, username=username, role=role)
        request.state.user_id = user_id
        return td
    except (JWTError, KeyError, ValueError):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_role(*roles: str):
    """Dépendance FastAPI pour le contrôle de rôle."""
    async def _check(
        request: Request,
        token:   str = Depends(oauth2_scheme),
    ) -> TokenData:
        user = await get_current_user(request, token)
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{user.role}' cannot access this resource. "
                f"Required: {', '.join(roles)}"
            )
        return user
    return _check
