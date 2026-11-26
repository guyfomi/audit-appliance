"""Router API — Archive et jobs d'archivage."""
from __future__ import annotations
from fastapi  import APIRouter, Depends, BackgroundTasks
from sqlalchemy import text

from api.auth   import TokenData, require_role
from api.rbac   import Permission
from db.session import AsyncSession, get_session

router = APIRouter()


@router.get("/archive/jobs")
async def list_archive_jobs(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN", "AUDITOR")),
):
    rows = await db.execute(text("""
        SELECT id, started_at, completed_at, partition_name,
               event_count, archive_path, archive_hash,
               format, status, error_message
        FROM audit_archive_job
        ORDER BY started_at DESC
        LIMIT 100
    """))
    return [dict(r._mapping) for r in rows.fetchall()]


@router.post("/archive/run")
async def run_archive(
    background: BackgroundTasks,
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(require_role("ADMIN")),
):
    """Déclenche un archivage manuel en arrière-plan."""
    async def _run():
        from config.settings import settings
        from pathlib import Path
        if settings.archive_backend == "s3":
            from engine.archive.s3_backend import S3Backend
            backend = S3Backend(
                endpoint_url=settings.archive_s3_endpoint,
                bucket=settings.archive_s3_bucket,
                access_key=settings.archive_s3_access_key,
                secret_key=settings.archive_s3_secret_key,
            )
        else:
            from engine.archive.filesystem_backend import FilesystemBackend
            backend = FilesystemBackend(Path(settings.archive_local_path))

        from db.session import get_raw_session
        from engine.archive.worker import ArchiveWorker
        async with get_raw_session() as session:
            worker = ArchiveWorker(session=session, backend=backend)
            await worker.run()

    background.add_task(_run)
    return {"status": "Archive job started in background"}


@router.get("/archive/retention-policy")
async def get_retention_policy(
    db:   AsyncSession = Depends(get_session),
    user: TokenData    = Depends(get_current_user),
):
    from api.auth import get_current_user
    rows = await db.execute(text("""
        SELECT rp.*, d.name AS database_name
        FROM audit_retention_policy rp
        LEFT JOIN audit_database d ON rp.database_id = d.id
        WHERE rp.is_active = TRUE
        ORDER BY rp.id
    """))
    return [dict(r._mapping) for r in rows.fetchall()]


def get_current_user():
    from api.auth import get_current_user as _get
    return _get
