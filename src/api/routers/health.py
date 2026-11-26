"""Router API — Santé de l'appliance."""
from __future__ import annotations
import shutil
import time
from fastapi  import APIRouter, Depends
from sqlalchemy import text
from api.auth   import get_current_user, require_role, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


@router.get("/health")
async def health_simple():
    """Probe légère — sans authentification — pour systemd/load balancer."""
    return {"status": "ok", "timestamp": time.time()}


@router.get("/health/detail")
async def health_detail(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN", "AUDITOR")),
):
    checks: dict = {}

    # PostgreSQL
    try:
        await db.execute(text("SELECT 1"))
        checks["postgresql"] = "ok"
    except Exception as e:
        checks["postgresql"] = f"error: {e}"

    # Disque
    usage = shutil.disk_usage("/")
    checks["disk_free_pct"]  = round(usage.free / usage.total * 100, 1)
    checks["disk_free_gb"]   = round(usage.free / 1_073_741_824, 2)
    checks["disk_total_gb"]  = round(usage.total / 1_073_741_824, 2)

    # CDC lag
    try:
        row = await db.execute(text(
            "SELECT MAX(lag_seconds) FROM cdc_checkpoint WHERE status = 'RUNNING'"
        ))
        checks["cdc_lag_seconds"] = row.scalar()
    except Exception:
        checks["cdc_lag_seconds"] = None

    # Intégrité
    try:
        row = await db.execute(text(
            "SELECT verified_ok FROM audit_integrity_checkpoint "
            "ORDER BY checkpoint_time DESC LIMIT 1"
        ))
        r = row.fetchone()
        checks["integrity_ok"] = r[0] if r else None
    except Exception:
        checks["integrity_ok"] = None

    # Métriques événements
    try:
        row = await db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE event_time >= CURRENT_DATE)      AS events_today,
                COUNT(*) FILTER (WHERE event_time >= now() - interval '1 hour') AS events_hour,
                (SELECT COUNT(*) FROM audit_raw_event WHERE processing_status = 'FAILED')    AS failed,
                (SELECT COUNT(*) FROM audit_raw_event WHERE processing_status = 'DUPLICATE') AS duplicated,
                pg_database_size(current_database()) / 1073741824.0 AS pg_size_gb
            FROM audit_event
        """))
        r = row.fetchone()
        if r:
            checks["events_today"]    = r[0] or 0
            checks["events_hour"]     = r[1] or 0
            checks["events_failed"]   = r[2] or 0
            checks["events_duplicated"] = r[3] or 0
            checks["pg_size_gb"]      = round(float(r[4] or 0), 2)
            checks["events_per_second"] = round((r[1] or 0) / 3600, 2)
    except Exception:
        pass

    # Alertes ouvertes
    try:
        row = await db.execute(text("SELECT COUNT(*) FROM audit_alert WHERE status = 'OPEN'"))
        checks["open_alerts"] = row.scalar() or 0
    except Exception:
        checks["open_alerts"] = None

    overall = "ok"
    if checks.get("postgresql") != "ok":
        overall = "error"
    elif (checks.get("disk_free_gb", 999) < 5
          or (checks.get("cdc_lag_seconds") or 0) > 300):
        overall = "degraded"

    return {"status": overall, "checks": checks}
