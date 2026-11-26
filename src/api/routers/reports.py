"""Router API — Génération de rapports."""
from __future__ import annotations
from datetime import datetime, date
from typing import Optional, Any
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text

from api.auth   import get_current_user, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


class ReportRequest(BaseModel):
    report_type: str
    format:      str = "PDF"
    parameters:  Optional[dict[str, Any]] = None


@router.get("/reports")
async def list_reports(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    rows = await db.execute(text("""
        SELECT r.*, u.username AS created_by_username
        FROM audit_report r
        LEFT JOIN appliance_user u ON r.created_by = u.id
        ORDER BY r.id
    """))
    return [dict(r._mapping) for r in rows.fetchall()]


@router.post("/reports/run")
async def run_report(
    req:  ReportRequest,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    """
    Génère un rapport et retourne le contenu ou une URL de téléchargement.
    En production, les rapports volumineux sont générés en arrière-plan
    et téléchargeables via un lien signé.
    """
    # Enregistrer le rapport demandé
    await db.execute(text("""
        INSERT INTO audit_report (name, report_type, parameters, created_by, last_run_at, last_run_status)
        VALUES (:name, :type, :params::jsonb, :uid, now(), 'RUNNING')
    """), {
        "name":   f"{req.report_type} — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "type":   req.report_type,
        "params": str(req.parameters or {}),
        "uid":    user.user_id,
    })
    await db.commit()

    # Générer les données du rapport
    data = await _generate_report_data(req.report_type, req.parameters or {}, db)

    return {
        "status":      "SUCCESS",
        "report_type": req.report_type,
        "format":      req.format,
        "generated_at": datetime.now().isoformat(),
        "row_count":   len(data),
        "data":        data[:100],   # preview — en production : lien de téléchargement
    }


async def _generate_report_data(report_type: str, params: dict, db: AsyncSession) -> list[dict]:
    """Requêtes SQL pour chaque type de rapport."""

    queries = {
        "DAILY_AUDIT": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   u.username AS db_username, e.risk_level, e.risk_score,
                   e.changed_columns
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE e.event_time >= CURRENT_DATE
            ORDER BY e.event_time DESC LIMIT 10000
        """,
        "WEEKLY_SECURITY": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   u.username AS db_username, e.client_ip,
                   e.risk_level, e.risk_score
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE e.event_time >= now() - interval '7 days'
              AND e.risk_level IN ('HIGH', 'CRITICAL')
            ORDER BY e.risk_score DESC LIMIT 5000
        """,
        "USER_ACTIVITY": """
            SELECT u.username, COUNT(*) AS event_count,
                   COUNT(*) FILTER (WHERE e.operation='INSERT') AS inserts,
                   COUNT(*) FILTER (WHERE e.operation='UPDATE') AS updates,
                   COUNT(*) FILTER (WHERE e.operation='DELETE') AS deletes,
                   MAX(e.risk_score) AS max_risk_score,
                   MIN(e.event_time) AS first_event,
                   MAX(e.event_time) AS last_event
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE e.event_time >= CURRENT_DATE - interval '30 days'
            GROUP BY u.username
            ORDER BY event_count DESC
        """,
        "SENSITIVE_TABLE": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   e.primary_key, u.username AS db_username,
                   e.client_ip, e.risk_level, e.risk_score,
                   e.changed_columns
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            LEFT JOIN audit_table_config tc
                ON e.database_id = tc.database_id
               AND e.schema_name = tc.schema_name
               AND e.table_name  = tc.table_name
            WHERE tc.is_sensitive = TRUE
              AND e.event_time >= CURRENT_DATE - interval '30 days'
            ORDER BY e.event_time DESC LIMIT 5000
        """,
        "CRITICAL_CHANGES": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   e.primary_key, u.username AS db_username, e.client_ip,
                   e.risk_score, e.before_data, e.after_data, e.changed_columns
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE e.risk_level = 'CRITICAL'
              AND e.event_time >= CURRENT_DATE - interval '30 days'
            ORDER BY e.event_time DESC LIMIT 5000
        """,
        "AFTER_HOURS": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   u.username AS db_username, e.client_ip, e.risk_level,
                   EXTRACT(DOW FROM e.event_time) AS day_of_week,
                   EXTRACT(HOUR FROM e.event_time) AS hour_of_day
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE (
                EXTRACT(HOUR FROM e.event_time) < 8
                OR EXTRACT(HOUR FROM e.event_time) >= 18
                OR EXTRACT(DOW  FROM e.event_time) IN (0, 6)
            )
            AND e.event_time >= CURRENT_DATE - interval '30 days'
            ORDER BY e.event_time DESC LIMIT 5000
        """,
        "COMPLIANCE": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   e.primary_key, u.username AS db_username,
                   e.client_ip, e.hostname, e.application_id,
                   e.risk_level, e.risk_score,
                   e.event_hash, e.previous_event_hash,
                   e.transaction_id, e.scn
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE e.event_time >= CURRENT_DATE - interval '90 days'
            ORDER BY e.event_time DESC LIMIT 50000
        """,
        "DATABASE_CHANGE": """
            SELECT e.event_time, e.operation, e.schema_name, e.table_name,
                   u.username AS db_username, e.client_ip, e.risk_level
            FROM audit_event e
            LEFT JOIN audit_db_user u ON e.db_user_id = u.id
            WHERE e.operation IN ('DDL', 'TRUNCATE')
            ORDER BY e.event_time DESC LIMIT 5000
        """,
    }

    sql = queries.get(report_type)
    if not sql:
        return []

    rows = await db.execute(text(sql))
    return [dict(r._mapping) for r in rows.fetchall()]
