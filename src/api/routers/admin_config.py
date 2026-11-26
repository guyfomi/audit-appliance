"""Router API — Export / Import de configuration (backup/restore)."""
from __future__ import annotations
from fastapi  import APIRouter, Depends, HTTPException
from sqlalchemy import text
from api.auth   import require_role, TokenData
from db.session import AsyncSession, get_session

config_router = APIRouter(prefix="/api/v1/admin/config", tags=["admin"])

CONFIG_TABLES = [
    "audit_database",
    "audit_table_config",
    "audit_column_config",
    "audit_rule",
    "audit_retention_policy",
    "appliance_user",
    "cdc_checkpoint",
]


@config_router.get("/export")
async def export_config(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    """Exporte toutes les tables de configuration en JSON (sans données d'audit)."""
    from datetime import datetime, UTC
    export: dict = {
        "version":     "1.0",
        "exported_at": datetime.now(UTC).isoformat(),
        "exported_by": user.username,
    }
    for table in CONFIG_TABLES:
        rows = await db.execute(text(f"SELECT row_to_json(t) FROM {table} t"))
        export[table] = [r[0] for r in rows.fetchall()]
    return export


@config_router.post("/import")
async def import_config(
    payload: dict,
    db:      AsyncSession = Depends(get_session),
    user:    TokenData    = Depends(require_role("ADMIN")),
):
    """Importe une configuration exportée — utilisé lors de la restauration."""
    version = payload.get("version")
    if version != "1.0":
        raise HTTPException(400, f"Unsupported config version: {version}")

    for table in CONFIG_TABLES:
        rows = payload.get(table, [])
        if not rows:
            continue
        await db.execute(text(f"TRUNCATE {table} RESTART IDENTITY CASCADE"))
        for row in rows:
            cols = ", ".join(row.keys())
            vals = ", ".join(f":{k}" for k in row.keys())
            await db.execute(text(f"INSERT INTO {table} ({cols}) VALUES ({vals})"), row)

    await db.commit()
    return {"imported": True, "tables": CONFIG_TABLES}
