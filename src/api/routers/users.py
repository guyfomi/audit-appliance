"""Router API — Gestion des utilisateurs de l'appliance."""
from __future__ import annotations
import secrets
from typing import Optional
from datetime import datetime

import bcrypt
from fastapi  import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import text

from api.auth   import get_current_user, require_role, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


class UserCreate(BaseModel):
    username:  str
    email:     EmailStr
    full_name: Optional[str] = None
    role:      str = "READONLY"
    password:  Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password:     str


class UserOut(BaseModel):
    id:           int
    username:     str
    email:        str
    full_name:    Optional[str]
    role:         str
    is_active:    bool
    last_login_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    rows = await db.execute(text("""
        SELECT id, username, email, full_name, role, is_active, last_login_at
        FROM appliance_user
        ORDER BY username
    """))
    return [dict(r._mapping) for r in rows.fetchall()]


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(
    body: UserCreate,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    valid_roles = {"ADMIN", "AUDITOR", "ANALYST", "READONLY"}
    if body.role.upper() not in valid_roles:
        raise HTTPException(400, f"Invalid role. Must be one of: {valid_roles}")

    # Vérifier que le username n'existe pas
    existing = await db.execute(text(
        "SELECT id FROM appliance_user WHERE username = :u"
    ), {"u": body.username})
    if existing.fetchone():
        raise HTTPException(409, f"Username '{body.username}' already exists")

    # Générer ou utiliser le mot de passe fourni
    plain_password = body.password or secrets.token_urlsafe(16)
    if len(plain_password) < 12:
        raise HTTPException(400, "Password must be at least 12 characters")

    pw_hash = bcrypt.hashpw(plain_password.encode(), bcrypt.gensalt()).decode()

    result = await db.execute(text("""
        INSERT INTO appliance_user (username, email, full_name, role, password_hash)
        VALUES (:u, :e, :f, :r, :h)
        RETURNING id, username, email, full_name, role, is_active, last_login_at
    """), {
        "u": body.username.lower(),
        "e": body.email,
        "f": body.full_name,
        "r": body.role.upper(),
        "h": pw_hash,
    })
    await db.commit()

    created = dict(result.fetchone()._mapping)
    # Retourner le mot de passe temporaire pour affichage unique
    if not body.password:
        created["_temp_password"] = plain_password
    return created


@router.patch("/users/{user_id}/disable")
async def disable_user(
    user_id: int,
    db:      AsyncSession = Depends(get_session),
    user:    TokenData    = Depends(require_role("ADMIN")),
):
    if user_id == user.user_id:
        raise HTTPException(400, "Cannot disable your own account")

    result = await db.execute(text(
        "UPDATE appliance_user SET is_active = FALSE WHERE id = :id RETURNING id"
    ), {"id": user_id})
    await db.commit()
    if not result.fetchone():
        raise HTTPException(404, "User not found")
    return {"disabled": True, "user_id": user_id}


@router.patch("/users/{user_id}/enable")
async def enable_user(
    user_id: int,
    db:      AsyncSession = Depends(get_session),
    user:    TokenData    = Depends(require_role("ADMIN")),
):
    result = await db.execute(text(
        "UPDATE appliance_user SET is_active = TRUE WHERE id = :id RETURNING id"
    ), {"id": user_id})
    await db.commit()
    if not result.fetchone():
        raise HTTPException(404, "User not found")
    return {"enabled": True, "user_id": user_id}


@router.post("/users/me/change-password")
async def change_password(
    body: PasswordChange,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    row = await db.execute(text(
        "SELECT password_hash FROM appliance_user WHERE id = :id"
    ), {"id": user.user_id})
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "User not found")

    if not bcrypt.checkpw(body.current_password.encode(), r[0].encode()):
        raise HTTPException(400, "Current password is incorrect")

    if len(body.new_password) < 12:
        raise HTTPException(400, "New password must be at least 12 characters")

    new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.execute(text(
        "UPDATE appliance_user SET password_hash = :h WHERE id = :id"
    ), {"h": new_hash, "id": user.user_id})
    await db.commit()
    return {"changed": True}
