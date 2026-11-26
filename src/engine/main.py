"""
Oracle Data Audit & Forensics Appliance
Audit Engine — point d'entrée principal

Ce module démarre le pipeline de traitement des événements CDC :
CDC Adapter → Ingest → Dedup → Normalize → Enrich → Risk → Integrity → Persist → Alert
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
from datetime import datetime

from config.settings     import settings
from config.logging_cfg  import setup_logging
from db.session          import init_db, AsyncSessionLocal
from cdc.factory         import create_adapter
from engine.engine       import AuditEngine
from engine.ingestion    import IngestionService
from engine.idempotence  import IdempotenceService
from engine.normalization import NormalizationService
from engine.enrichment   import EnrichmentService
from engine.risk         import RiskEngine
from engine.risk_manager import RiskRuleManager
from engine.integrity    import IntegrityEngine
from engine.persistence  import PersistenceService
from engine.alerting     import AlertingService
from engine.archive.partition_manager import PartitionManager

logger = logging.getLogger("audit.engine.main")


async def main() -> None:
    setup_logging(settings.log_level)
    logger.info({
        "component": "engine",
        "message":   "Audit Engine starting",
        "version":   settings.appliance_version,
    })

    # ── Initialisation de la base de données ──────────────────────────────────
    await init_db()

    # Créer les partitions futures si elles manquent
    async with AsyncSessionLocal() as session:
        pm = PartitionManager(session)
        created = await pm.ensure_partitions(months_ahead=2)
        if created:
            logger.info({"component": "partitions", "message": f"Partitions créées: {created}"})

    # ── Instanciation des services ────────────────────────────────────────────
    async with AsyncSessionLocal() as session:
        ingestion    = IngestionService(session)
        idempotence  = IdempotenceService(session)
        normalization = NormalizationService(session)
        enrichment   = EnrichmentService(session)
        risk         = RiskEngine(session)
        integrity    = IntegrityEngine(
            session,
            checkpoint_every_n=settings.integrity_checkpoint_every_n
        )
        persistence  = PersistenceService(session)
        alerting     = AlertingService(session)

        # Charger les canaux d'alerte configurés
        if settings.alert_email_enabled:
            from engine.alerting_channels import EmailChannel
            alerting.register_channel(EmailChannel(settings))
        if settings.alert_webhook_enabled:
            from engine.alerting_channels import WebhookChannel
            alerting.register_channel(WebhookChannel(settings.alert_webhook_url))

        # Charger les règles de risque initiales
        await risk.load_rules()

        # Créer l'adapter CDC
        adapter = create_adapter(
            adapter_type=settings.cdc_adapter,
            config={
                "synchdb_url":       settings.synchdb_url,
                "synchdb_api_key":   settings.synchdb_api_key,
                "database_name":     settings.oracle_service,
                "poll_interval_ms":  settings.cdc_poll_interval_ms,
                "batch_size":        settings.cdc_batch_size,
                "tables_filter":     settings.cdc_tables_filter,
            },
            database_id=1,
            db_session=session,
        )

        # Instancier et démarrer le moteur
        engine = AuditEngine(
            adapter=adapter,
            ingestion=ingestion,
            idempotence=idempotence,
            normalization=normalization,
            enrichment=enrichment,
            risk=risk,
            integrity=integrity,
            persistence=persistence,
            alerting=alerting,
        )

        # Gestionnaire de rechargement des règles (toutes les 60s)
        rule_manager = RiskRuleManager(
            engine=risk,
            session=session,
            reload_interval=settings.rule_reload_interval_seconds,
        )

        # ── Arrêt propre sur SIGTERM/SIGINT ───────────────────────────────────
        loop = asyncio.get_event_loop()

        def handle_shutdown(sig: signal.Signals) -> None:
            logger.info({"component": "engine", "message": f"Signal reçu: {sig.name} — arrêt en cours"})
            asyncio.create_task(engine.stop())

        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda s=sig: handle_shutdown(s))

        # ── Démarrage des tâches parallèles ───────────────────────────────────
        logger.info({"component": "engine", "message": "Pipeline démarré"})
        await asyncio.gather(
            engine.run(),
            rule_manager.watch(),
            return_exceptions=True,
        )

    logger.info({"component": "engine", "message": "Audit Engine arrêté"})


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
