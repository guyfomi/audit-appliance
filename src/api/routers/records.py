"""Router API — Record Timeline (historique d'un enregistrement)."""
from __future__ import annotations
from fastapi  import APIRouter, Depends, Query
from sqlalchemy import text
from api.auth   import get_current_user, TokenData
from db.session import AsyncSession, get_session

router = APIRouter()


@router.get("/records/{schema}/{table}/{primary_key_value}/timeline")
async def record_timeline(
    schema:            str,
    table:             str,
    primary_key_value: str,
    page:      int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    """
    Reconstruit l'historique complet d'un enregistrement identifié
    par son schéma, sa table et la valeur de sa clé primaire.
    Utilise l'opérateur @> de PostgreSQL sur le JSONB primary_key.
    """
    offset = (page - 1) * page_size
    # Recherche dans le JSONB primary_key par valeur (toute colonne PK)
    pk_pattern = f"%{primary_key_value}%"

    total = (await db.execute(text("""
        SELECT COUNT(*) FROM audit_event e
        WHERE e.schema_name = :schema
          AND e.table_name  = :table
          AND e.primary_key::text ILIKE :pk
    """), {"schema": schema, "table": table, "pk": pk_pattern})).scalar() or 0

    rows = await db.execute(text("""
        SELECT
            e.id, e.event_id, e.event_time, e.operation,
            d.name   AS database_name,
            e.schema_name, e.table_name, e.primary_key,
            e.before_data, e.after_data, e.changed_columns,
            u.username AS db_username,
            e.app_user, e.client_ip::text, e.hostname,
            e.transaction_id, e.scn,
            e.risk_score, e.risk_level
        FROM audit_event e
        LEFT JOIN audit_database d ON e.database_id = d.id
        LEFT JOIN audit_db_user  u ON e.db_user_id  = u.id
        WHERE e.schema_name = :schema
          AND e.table_name  = :table
          AND e.primary_key::text ILIKE :pk
        ORDER BY e.event_time ASC, e.id ASC
        LIMIT :limit OFFSET :offset
    """), {"schema": schema, "table": table, "pk": pk_pattern,
           "limit": page_size, "offset": offset})

    items = [dict(r._mapping) for r in rows.fetchall()]
    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "pages":     -(-total // page_size),
        "items":     items,
        "schema":    schema,
        "table":     table,
        "primary_key_value": primary_key_value,
    }
