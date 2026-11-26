"""Router API — Règles de risque."""
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime

from fastapi  import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from api.auth   import get_current_user, require_role, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


class RuleCreate(BaseModel):
    name:           str
    description:    Optional[str]  = None
    rule_type:      str
    conditions:     dict[str, Any]
    risk_score_add: int   = Field(ge=0, le=100)
    risk_level_min: str   = "LOW"
    generate_alert: bool  = False
    priority:       int   = 100
    is_active:      bool  = True


class RuleOut(RuleCreate):
    id:         int
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/rules", response_model=list[RuleOut])
async def list_rules(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    rows = await db.execute(text("""
        SELECT id, name, description, rule_type, conditions,
               risk_score_add, risk_level_min, generate_alert,
               is_active, priority, created_at
        FROM audit_rule
        ORDER BY priority ASC, id ASC
    """))
    return [dict(r._mapping) for r in rows.fetchall()]


@router.post("/rules", response_model=RuleOut, status_code=201)
async def create_rule(
    body: RuleCreate,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    import json
    result = await db.execute(text("""
        INSERT INTO audit_rule
            (name, description, rule_type, conditions, risk_score_add,
             risk_level_min, generate_alert, is_active, priority)
        VALUES
            (:name, :desc, :type, :cond::jsonb, :score,
             :level, :alert, :active, :prio)
        RETURNING id, name, description, rule_type, conditions,
                  risk_score_add, risk_level_min, generate_alert,
                  is_active, priority, created_at
    """), {
        "name":   body.name,
        "desc":   body.description,
        "type":   body.rule_type,
        "cond":   json.dumps(body.conditions),
        "score":  body.risk_score_add,
        "level":  body.risk_level_min,
        "alert":  body.generate_alert,
        "active": body.is_active,
        "prio":   body.priority,
    })
    await db.commit()
    return dict(result.fetchone()._mapping)


@router.put("/rules/{rule_id}", response_model=RuleOut)
async def update_rule(
    rule_id: int,
    body:    RuleCreate,
    db:      AsyncSession = Depends(get_session),
    user:    TokenData    = Depends(require_role("ADMIN")),
):
    import json
    result = await db.execute(text("""
        UPDATE audit_rule
        SET name = :name, description = :desc, rule_type = :type,
            conditions = :cond::jsonb, risk_score_add = :score,
            risk_level_min = :level, generate_alert = :alert,
            is_active = :active, priority = :prio
        WHERE id = :id
        RETURNING id, name, description, rule_type, conditions,
                  risk_score_add, risk_level_min, generate_alert,
                  is_active, priority, created_at
    """), {
        "id": rule_id, "name": body.name, "desc": body.description,
        "type": body.rule_type, "cond": json.dumps(body.conditions),
        "score": body.risk_score_add, "level": body.risk_level_min,
        "alert": body.generate_alert, "active": body.is_active,
        "prio": body.priority,
    })
    await db.commit()
    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Rule not found")
    return dict(row._mapping)


@router.post("/rules/reload")
async def reload_rules(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    """
    Signal au moteur de recharger les règles depuis la base.
    Le moteur vérifie toutes les 60 secondes — cet endpoint force un rechargement immédiat.
    """
    # Mettre à jour un timestamp dans une table de contrôle
    await db.execute(text("""
        INSERT INTO audit_rule (name, rule_type, conditions, risk_score_add, is_active, priority)
        VALUES ('__reload_signal__', 'TABLE_SENSITIVITY', '{}', 0, FALSE, 9999)
        ON CONFLICT (name) DO UPDATE SET created_at = now()
    """))
    await db.commit()
    return {"status": "reload_signal_sent", "message": "Rules will reload within 60 seconds"}
