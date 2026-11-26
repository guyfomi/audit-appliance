"""Router API — Alertes de sécurité."""
from __future__ import annotations
from typing import Optional
from datetime import datetime

from fastapi  import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from api.auth   import get_current_user, require_role, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


class AlertPatch(BaseModel):
    status: str   # ACKNOWLEDGED | RESOLVED | FALSE_POSITIVE
    notes:  Optional[str] = None


@router.get("/alerts")
async def list_alerts(
    status:    Optional[str] = Query(default=None),
    severity:  Optional[str] = Query(default=None),
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    where  = "1=1"
    params: dict = {"limit": page_size, "offset": (page - 1) * page_size}

    if status:
        where += " AND al.status = :status"
        params["status"] = status.upper()
    if severity:
        where += " AND al.severity = :severity"
        params["severity"] = severity.upper()

    total = (await db.execute(text(
        f"SELECT COUNT(*) FROM audit_alert al WHERE {where}"
    ), params)).scalar() or 0

    rows = await db.execute(text(f"""
        SELECT al.id, al.event_id, al.alert_time, al.severity,
               al.title, al.description, al.status,
               al.acknowledged_at, al.resolved_at, al.notes,
               ar.name AS rule_name,
               u.username AS acknowledged_by
        FROM audit_alert al
        JOIN audit_rule ar ON al.rule_id = ar.id
        LEFT JOIN appliance_user u ON al.acknowledged_by = u.id
        WHERE {where}
        ORDER BY al.alert_time DESC
        LIMIT :limit OFFSET :offset
    """), params)

    items = [dict(r._mapping) for r in rows.fetchall()]
    return {
        "total": total, "page": page, "page_size": page_size,
        "pages": -(-total // page_size), "items": items,
    }


@router.patch("/alerts/{alert_id}")
async def update_alert(
    alert_id: int,
    body:     AlertPatch,
    db:       AsyncSession = Depends(get_session),
    user:     TokenData    = Depends(require_role("ADMIN", "AUDITOR", "ANALYST")),
):
    valid_statuses = {"ACKNOWLEDGED", "RESOLVED", "FALSE_POSITIVE"}
    if body.status.upper() not in valid_statuses:
        raise HTTPException(400, f"Invalid status. Must be one of: {valid_statuses}")

    extra_fields = ""
    if body.status.upper() == "ACKNOWLEDGED":
        extra_fields = ", acknowledged_by = :uid, acknowledged_at = now()"
    elif body.status.upper() in ("RESOLVED", "FALSE_POSITIVE"):
        extra_fields = ", resolved_at = now()"

    result = await db.execute(text(f"""
        UPDATE audit_alert
        SET status = :status, notes = COALESCE(:notes, notes) {extra_fields}
        WHERE id = :id
        RETURNING id, status, notes
    """), {"status": body.status.upper(), "notes": body.notes,
           "id": alert_id, "uid": user.user_id})
    await db.commit()

    row = result.fetchone()
    if not row:
        raise HTTPException(404, "Alert not found")
    return dict(row._mapping)
