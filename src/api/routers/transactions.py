"""Router API — Transactions Oracle."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from api.auth    import get_current_user, TokenData
from db.session  import AsyncSession, get_session

router = APIRouter()


class TransactionOut(BaseModel):
    id:               int
    transaction_id:   str
    database_name:    str
    start_time:       Optional[datetime]
    commit_time:      Optional[datetime]
    db_username:      Optional[str]
    application_name: Optional[str]
    client_ip:        Optional[str]
    event_count:      int
    tables_affected:  list[str]
    max_risk_level:   str
    duration_ms:      Optional[int]
    is_rollback:      bool

    class Config:
        from_attributes = True


@router.get("/transactions")
async def list_transactions(
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db_username: Optional[str] = None,
    risk_level:  Optional[str] = None,
    db:    AsyncSession = Depends(get_session),
    user:  TokenData    = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    where  = "1=1"
    params: dict = {"limit": page_size, "offset": offset}

    if db_username:
        where += " AND u.username ILIKE :dbuser"
        params["dbuser"] = f"%{db_username}%"
    if risk_level:
        where += " AND t.max_risk_level = :risk"
        params["risk"] = risk_level.upper()

    total_row = await db.execute(text(f"""
        SELECT COUNT(*) FROM audit_transaction t
        LEFT JOIN audit_db_user u ON t.db_user_id = u.id
        WHERE {where}
    """), params)
    total = total_row.scalar() or 0

    rows = await db.execute(text(f"""
        SELECT t.id, t.transaction_id,
               d.name AS database_name,
               t.start_time, t.commit_time,
               u.username AS db_username,
               a.display_name AS application_name,
               t.client_ip::text,
               t.event_count, t.tables_affected,
               t.max_risk_level, t.duration_ms, t.is_rollback
        FROM audit_transaction t
        LEFT JOIN audit_database    d ON t.database_id    = d.id
        LEFT JOIN audit_db_user     u ON t.db_user_id     = u.id
        LEFT JOIN audit_application a ON t.application_id = a.id
        WHERE {where}
        ORDER BY t.commit_time DESC NULLS LAST
        LIMIT :limit OFFSET :offset
    """), params)

    items = []
    for r in rows.fetchall():
        m = dict(r._mapping)
        m["client_ip"]       = str(m["client_ip"]) if m["client_ip"] else None
        m["tables_affected"] = m["tables_affected"] or []
        items.append(m)

    return {
        "total": total, "page": page, "page_size": page_size,
        "pages": -(-total // page_size), "items": items,
    }


@router.get("/transactions/{transaction_id}")
async def get_transaction(
    transaction_id: str,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    row = await db.execute(text("""
        SELECT t.*, d.name AS database_name,
               u.username AS db_username,
               a.display_name AS application_name,
               t.client_ip::text
        FROM audit_transaction t
        LEFT JOIN audit_database    d ON t.database_id    = d.id
        LEFT JOIN audit_db_user     u ON t.db_user_id     = u.id
        LEFT JOIN audit_application a ON t.application_id = a.id
        WHERE t.transaction_id = :txn
        LIMIT 1
    """), {"txn": transaction_id})

    txn = row.fetchone()
    if not txn:
        raise HTTPException(404, f"Transaction '{transaction_id}' not found")

    result = dict(txn._mapping)

    # Charger les événements de la transaction
    events_row = await db.execute(text("""
        SELECT e.id, e.event_time, e.schema_name, e.table_name,
               e.operation, e.primary_key,
               e.risk_level, e.risk_score, e.changed_columns
        FROM audit_event e
        WHERE e.transaction_id = :txn
        ORDER BY e.event_time ASC
        LIMIT 500
    """), {"txn": transaction_id})

    result["events"] = [dict(r._mapping) for r in events_row.fetchall()]
    result["tables_affected"] = result.get("tables_affected") or []
    return result
