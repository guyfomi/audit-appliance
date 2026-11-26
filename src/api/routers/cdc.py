"""Router API — Statut et contrôle du CDC."""
from fastapi  import APIRouter, Depends
from sqlalchemy import text
from api.auth   import get_current_user, require_role, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()

@router.get("/cdc/status")
async def cdc_status(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN", "AUDITOR")),
):
    rows = await db.execute(text("""
        SELECT cp.id, cp.database_id, cp.adapter_type,
               cp.last_scn, cp.last_commit_scn, cp.last_event_time,
               cp.status, cp.lag_seconds, cp.updated_at,
               d.name AS database_name
        FROM cdc_checkpoint cp
        JOIN audit_database d ON cp.database_id = d.id
    """))
    return [dict(r._mapping) for r in rows.fetchall()]

@router.post("/cdc/pause")
async def cdc_pause(
    database_id: int,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    await db.execute(text(
        "UPDATE cdc_checkpoint SET status = 'PAUSED' WHERE database_id = :id"
    ), {"id": database_id})
    await db.commit()
    return {"status": "PAUSED", "database_id": database_id}

@router.post("/cdc/resume")
async def cdc_resume(
    database_id: int,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    await db.execute(text(
        "UPDATE cdc_checkpoint SET status = 'RUNNING' WHERE database_id = :id"
    ), {"id": database_id})
    await db.commit()
    return {"status": "RUNNING", "database_id": database_id}
