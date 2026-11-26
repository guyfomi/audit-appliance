"""
Oracle Data Audit & Forensics Appliance
CDC Service — point d'entrée du connecteur CDC

Ce service est distinct du moteur d'audit. Il se connecte à SynchDB,
lit les événements et les transmet au moteur via la queue PostgreSQL.
En production, il peut tourner sur un nœud dédié.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys

from config.settings    import settings
from config.logging_cfg import setup_logging
from db.session         import init_db, AsyncSessionLocal
from cdc.factory        import create_adapter
from cdc.checkpoint     import CheckpointManager

logger = logging.getLogger("audit.cdc.main")


async def run_cdc_service() -> None:
    setup_logging(settings.log_level)
    logger.info({"component": "cdc", "message": "CDC service starting",
                 "adapter": settings.cdc_adapter, "url": settings.synchdb_url})

    await init_db()

    async with AsyncSessionLocal() as session:
        checkpoint_mgr = CheckpointManager(
            database_id=1,
            adapter_type=settings.cdc_adapter,
            db_session=session,
        )

        adapter = create_adapter(
            adapter_type=settings.cdc_adapter,
            config={
                "synchdb_url":      settings.synchdb_url,
                "synchdb_api_key":  settings.synchdb_api_key,
                "database_name":    settings.oracle_service,
                "poll_interval_ms": settings.cdc_poll_interval_ms,
                "batch_size":       settings.cdc_batch_size,
                "tables_filter":    settings.cdc_tables_filter,
            },
            database_id=1,
            db_session=session,
        )

        # Vérifier si le CDC est en pause (commande via la table cdc_checkpoint)
        async def check_pause_command() -> bool:
            from sqlalchemy import text
            row = await session.execute(text(
                "SELECT status FROM cdc_checkpoint WHERE database_id = 1"
            ))
            r = row.fetchone()
            return r is not None and r[0] == 'PAUSED'

        running = True

        def handle_stop(sig: signal.Signals) -> None:
            nonlocal running
            logger.info({"component": "cdc", "message": f"Signal {sig.name} — CDC stopping"})
            running = False
            asyncio.create_task(adapter.close())

        loop = asyncio.get_event_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda s=sig: handle_stop(s))

        await adapter.connect()
        logger.info({"component": "cdc", "message": "Connected to CDC source"})

        # Écrire dans la queue PostgreSQL pour que le moteur consomme
        async for event in adapter.events():
            if not running:
                break

            # Vérifier si une pause est demandée via l'API
            if await check_pause_command():
                await adapter.pause()
                logger.info({"component": "cdc", "message": "CDC paused by API command"})
                while await check_pause_command() and running:
                    await asyncio.sleep(5)
                if running:
                    await adapter.resume()
                    logger.info({"component": "cdc", "message": "CDC resumed"})
                continue

            if event is None:
                continue  # heartbeat

            # Écrire l'événement brut dans audit_raw_event pour le moteur
            # Le moteur lit depuis cette table (ou reçoit directement si même processus)
            from sqlalchemy import text
            import json
            from dataclasses import asdict

            await session.execute(text("""
                INSERT INTO audit_raw_event
                    (received_at, source_adapter, source_position, payload, payload_hash, processing_status)
                VALUES
                    (now(), :adapter, :position, :payload, :hash, 'PENDING')
                ON CONFLICT DO NOTHING
            """), {
                "adapter":  event.source_adapter,
                "position": event.source_position,
                "payload":  json.dumps({
                    "event_id":       event.event_id,
                    "operation":      event.operation.value,
                    "database":       event.database,
                    "schema":         event.schema,
                    "table":          event.table,
                    "transaction_id": event.transaction_id,
                    "scn":            event.scn,
                    "commit_scn":     event.commit_scn,
                    "event_time":     event.event_time.isoformat(),
                    "commit_time":    event.commit_time.isoformat() if event.commit_time else None,
                    "primary_key":    event.primary_key,
                    "before":         {k: v.value for k, v in event.before.items()},
                    "after":          {k: v.value for k, v in event.after.items()},
                    "db_user":        event.db_user,
                    "client_identifier": event.client_identifier,
                    "module":         event.module,
                    "action":         event.action,
                    "client_ip":      event.client_ip,
                    "hostname":       event.hostname,
                }, default=str),
                "hash": event.idempotency_key,
            })
            await session.commit()

            # Confirmer la position au CDC
            await adapter.commit(event.source_position)

        await adapter.close()
        logger.info({"component": "cdc", "message": "CDC service stopped"})


if __name__ == "__main__":
    try:
        asyncio.run(run_cdc_service())
    except KeyboardInterrupt:
        sys.exit(0)
