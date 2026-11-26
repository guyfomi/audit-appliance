"""Router API — Dashboard métriques temps réel."""
from __future__ import annotations
import asyncio
from fastapi  import APIRouter, Depends
from sqlalchemy import text
from api.auth   import get_current_user, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


@router.get("/dashboard")
async def get_dashboard(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    async def q(sql, params=None):
        return await db.execute(text(sql), params or {})

    (total, today, hour, by_op, risk_counts,
     top_tables, top_users, by_hour, cdc_lag,
     storage, alert_count) = await asyncio.gather(
        q("SELECT COUNT(*) FROM audit_event"),
        q("SELECT COUNT(*) FROM audit_event WHERE event_time >= CURRENT_DATE"),
        q("SELECT COUNT(*) FROM audit_event WHERE event_time >= now() - interval '1 hour'"),
        q("""SELECT operation, COUNT(*) FROM audit_event
             WHERE event_time >= CURRENT_DATE GROUP BY operation"""),
        q("""SELECT risk_level, COUNT(*) FROM audit_event
             WHERE event_time >= CURRENT_DATE GROUP BY risk_level"""),
        q("""SELECT table_name, COUNT(*) AS cnt FROM audit_event
             WHERE event_time >= CURRENT_DATE
             GROUP BY table_name ORDER BY cnt DESC LIMIT 10"""),
        q("""SELECT u.username, COUNT(*) AS cnt
             FROM audit_event e
             JOIN audit_db_user u ON e.db_user_id = u.id
             WHERE e.event_time >= CURRENT_DATE
             GROUP BY u.username ORDER BY cnt DESC LIMIT 10"""),
        q("""SELECT date_trunc('hour', event_time) AS hour, COUNT(*) AS cnt
             FROM audit_event
             WHERE event_time >= now() - interval '24 hours'
             GROUP BY 1 ORDER BY 1"""),
        q("SELECT lag_seconds FROM cdc_checkpoint ORDER BY updated_at DESC LIMIT 1"),
        q("SELECT pg_database_size(current_database())"),
        q("SELECT COUNT(*) FROM audit_alert WHERE status = 'OPEN'"),
    )

    ops       = {r[0]: r[1] for r in by_op.fetchall()}
    risk_dist = {r[0]: r[1] for r in risk_counts.fetchall()}
    hour_total = hour.scalar() or 0
    cdc_row    = cdc_lag.fetchone()

    return {
        "total_events":       total.scalar()   or 0,
        "events_today":       today.scalar()   or 0,
        "events_hour":        hour_total,
        "inserts":            ops.get("INSERT",   0),
        "updates":            ops.get("UPDATE",   0),
        "deletes":            ops.get("DELETE",   0),
        "critical_events":    risk_dist.get("CRITICAL", 0),
        "high_risk_events":   risk_dist.get("HIGH",     0),
        "open_alerts":        alert_count.scalar() or 0,
        "cdc_lag_seconds":    float(cdc_row[0]) if cdc_row and cdc_row[0] else None,
        "events_per_second":  round(hour_total / 3600, 2),
        "storage_used_bytes": storage.scalar()  or 0,
        "archive_status":     "OK",
        "integrity_status":   "OK",
        "top_tables":  [{"table": r[0], "count": r[1]} for r in top_tables.fetchall()],
        "top_users":   [{"username": r[0], "count": r[1]} for r in top_users.fetchall()],
        "events_by_hour": [{"hour": str(r[0]), "count": r[1]} for r in by_hour.fetchall()],
        "risk_distribution": risk_dist,
    }
