"""Router API — Intégrité cryptographique SHA-256."""
from __future__ import annotations
from typing import Optional
from datetime import datetime
from fastapi  import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from api.auth   import get_current_user, require_role, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


class IntegrityVerifyRequest(BaseModel):
    database_id:  int
    schema_name:  str
    table_name:   str
    from_time:    Optional[datetime] = None
    to_time:      Optional[datetime] = None


@router.get("/integrity/status")
async def integrity_status(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    row = await db.execute(text("""
        SELECT checkpoint_time, verified_at, verified_ok,
               (SELECT COUNT(*) FROM audit_integrity_checkpoint) AS total_checkpoints
        FROM audit_integrity_checkpoint
        ORDER BY checkpoint_time DESC LIMIT 1
    """))
    r = row.fetchone()
    return {
        "last_checkpoint_time": r[0] if r else None,
        "last_verified_at":     r[1] if r else None,
        "last_verified_ok":     r[2] if r else None,
        "total_checkpoints":    r[3] if r else 0,
    }


@router.post("/integrity/verify")
async def verify_integrity(
    req:  IntegrityVerifyRequest,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN", "AUDITOR")),
):
    from engine.integrity_verifier import IntegrityVerifier
    verifier = IntegrityVerifier(db)
    result   = await verifier.verify_table(
        database_id = req.database_id,
        schema      = req.schema_name,
        table       = req.table_name,
        from_time   = req.from_time,
        to_time     = req.to_time,
    )
    return {
        "ok":             result.ok,
        "events_checked": result.events_checked,
        "error_at_id":    result.error_at_id,
        "error_message":  result.error_message,
        "duration_ms":    result.duration_ms,
    }
