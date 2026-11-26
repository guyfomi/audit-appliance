"""Router API — Événements d'audit."""
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime

from fastapi  import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from api.auth   import get_current_user, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


# ── Schémas ───────────────────────────────────────────────────────────────────

class EventSearchParams(BaseModel):
    from_time:       Optional[datetime] = None
    to_time:         Optional[datetime] = None
    database_name:   Optional[str]      = None
    schema_name:     Optional[str]      = None
    table_name:      Optional[str]      = None
    operation:       Optional[str]      = None
    db_username:     Optional[str]      = None
    app_user:        Optional[str]      = None
    client_ip:       Optional[str]      = None
    hostname:        Optional[str]      = None
    transaction_id:  Optional[str]      = None
    scn:             Optional[int]      = None
    risk_level:      Optional[str]      = None
    changed_column:  Optional[str]      = None
    page:            int = 1
    page_size:       int = 50
    sort_by:         str = "event_time"
    sort_dir:        str = "desc"


def _build_where(p: EventSearchParams) -> tuple[str, dict]:
    clauses: list[str] = ["1=1"]
    bind:    dict      = {}

    if p.from_time:
        clauses.append("e.event_time >= :from_time"); bind["from_time"] = p.from_time
    if p.to_time:
        clauses.append("e.event_time < :to_time");    bind["to_time"]   = p.to_time
    if p.database_name:
        clauses.append("d.name = :db_name");          bind["db_name"]   = p.database_name
    if p.schema_name:
        clauses.append("e.schema_name = :schema");    bind["schema"]    = p.schema_name
    if p.table_name:
        clauses.append("e.table_name = :table");      bind["table"]     = p.table_name
    if p.operation:
        clauses.append("e.operation = :op");          bind["op"]        = p.operation.upper()
    if p.db_username:
        clauses.append("u.username ILIKE :dbuser");   bind["dbuser"]    = f"%{p.db_username}%"
    if p.app_user:
        clauses.append("e.app_user ILIKE :appuser");  bind["appuser"]   = f"%{p.app_user}%"
    if p.client_ip:
        clauses.append("e.client_ip = :ip::inet");    bind["ip"]        = p.client_ip
    if p.hostname:
        clauses.append("e.hostname ILIKE :hostname"); bind["hostname"]  = f"%{p.hostname}%"
    if p.transaction_id:
        clauses.append("e.transaction_id = :txn");    bind["txn"]       = p.transaction_id
    if p.scn:
        clauses.append("e.scn = :scn");               bind["scn"]       = p.scn
    if p.risk_level:
        clauses.append("e.risk_level = :risk");       bind["risk"]      = p.risk_level.upper()
    if p.changed_column:
        clauses.append(":col = ANY(e.changed_columns)"); bind["col"]    = p.changed_column.upper()

    return " AND ".join(clauses), bind


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/events")
async def list_events(
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    offset = (page - 1) * page_size
    total = (await db.execute(text("SELECT COUNT(*) FROM audit_event"))).scalar() or 0

    rows = await db.execute(text("""
        SELECT e.id, e.event_id::text, e.event_time,
               d.name AS database_name,
               e.schema_name, e.table_name, e.operation,
               u.username AS db_username,
               e.app_user, e.client_ip::text,
               e.risk_score, e.risk_level, e.changed_columns
        FROM audit_event e
        LEFT JOIN audit_database d ON e.database_id = d.id
        LEFT JOIN audit_db_user  u ON e.db_user_id  = u.id
        ORDER BY e.event_time DESC
        LIMIT :limit OFFSET :offset
    """), {"limit": page_size, "offset": offset})

    return {
        "total": total, "page": page, "page_size": page_size,
        "pages": -(-total // page_size),
        "items": [dict(r._mapping) for r in rows.fetchall()],
    }


@router.get("/events/search")
async def search_events(
    # Paramètres de recherche via query string
    from_time:      Optional[datetime] = Query(default=None),
    to_time:        Optional[datetime] = Query(default=None),
    database_name:  Optional[str]      = Query(default=None),
    schema_name:    Optional[str]      = Query(default=None),
    table_name:     Optional[str]      = Query(default=None),
    operation:      Optional[str]      = Query(default=None),
    db_username:    Optional[str]      = Query(default=None),
    app_user:       Optional[str]      = Query(default=None),
    client_ip:      Optional[str]      = Query(default=None),
    hostname:       Optional[str]      = Query(default=None),
    transaction_id: Optional[str]      = Query(default=None),
    scn:            Optional[int]      = Query(default=None),
    risk_level:     Optional[str]      = Query(default=None),
    changed_column: Optional[str]      = Query(default=None),
    page:           int = Query(default=1, ge=1),
    page_size:      int = Query(default=50, ge=1, le=500),
    sort_by:        str = Query(default="event_time"),
    sort_dir:       str = Query(default="desc"),
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    p = EventSearchParams(
        from_time=from_time, to_time=to_time, database_name=database_name,
        schema_name=schema_name, table_name=table_name, operation=operation,
        db_username=db_username, app_user=app_user, client_ip=client_ip,
        hostname=hostname, transaction_id=transaction_id, scn=scn,
        risk_level=risk_level, changed_column=changed_column,
        page=page, page_size=page_size, sort_by=sort_by, sort_dir=sort_dir,
    )
    where, bind = _build_where(p)
    offset = (page - 1) * page_size

    allowed_sort = {"event_time", "risk_score", "table_name", "operation"}
    sort_col = p.sort_by if p.sort_by in allowed_sort else "event_time"
    sort_direction = "DESC" if p.sort_dir.lower() == "desc" else "ASC"

    total = (await db.execute(text(f"""
        SELECT COUNT(*) FROM audit_event e
        LEFT JOIN audit_database d ON e.database_id = d.id
        LEFT JOIN audit_db_user  u ON e.db_user_id  = u.id
        WHERE {where}
    """), bind)).scalar() or 0

    bind.update({"limit": page_size, "offset": offset})
    rows = await db.execute(text(f"""
        SELECT e.id, e.event_id::text, e.event_time,
               d.name AS database_name,
               e.schema_name, e.table_name, e.operation,
               u.username AS db_username,
               e.app_user, e.client_ip::text,
               e.risk_score, e.risk_level, e.changed_columns
        FROM audit_event e
        LEFT JOIN audit_database d ON e.database_id = d.id
        LEFT JOIN audit_db_user  u ON e.db_user_id  = u.id
        WHERE {where}
        ORDER BY e.{sort_col} {sort_direction}
        LIMIT :limit OFFSET :offset
    """), bind)

    return {
        "total": total, "page": page, "page_size": page_size,
        "pages": -(-total // page_size),
        "items": [dict(r._mapping) for r in rows.fetchall()],
    }


@router.get("/events/{event_id}")
async def get_event(
    event_id: int,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    row = await db.execute(text("""
        SELECT e.*,
               e.event_id::text        AS event_id,
               e.client_ip::text       AS client_ip,
               d.name                  AS database_name,
               u.username              AS db_username,
               a.display_name          AS application_name
        FROM audit_event e
        LEFT JOIN audit_database    d ON e.database_id    = d.id
        LEFT JOIN audit_db_user     u ON e.db_user_id     = u.id
        LEFT JOIN audit_application a ON e.application_id = a.id
        WHERE e.id = :id
    """), {"id": event_id})
    event = row.fetchone()
    if not event:
        raise HTTPException(404, "Event not found")

    result = dict(event._mapping)

    # Raisons du risque
    risk_rows = await db.execute(text("""
        SELECT ar.name AS rule_name, rd.score_contribution, rd.reason
        FROM audit_event_risk_detail rd
        JOIN audit_rule ar ON rd.rule_id = ar.id
        WHERE rd.event_id = :id
        ORDER BY rd.score_contribution DESC
    """), {"id": event_id})
    result["risk_reasons"] = [dict(r._mapping) for r in risk_rows.fetchall()]

    return result
