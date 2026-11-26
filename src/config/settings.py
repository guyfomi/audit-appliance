"""
Configuration centrale de l'appliance — chargée depuis les variables d'environnement.
Toutes les valeurs sensibles viennent de appliance.env (jamais du code source).
"""
from __future__ import annotations
from typing import Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("/opt/audit-appliance/config/appliance.env",
                  "/opt/audit-appliance/config/.oracle_secrets"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Identité ──────────────────────────────────────────────────────────────
    appliance_name:    str = "AUDIT-APPLIANCE"
    org_name:          str = "Organisation"
    appliance_fqdn:    str = "localhost"
    appliance_version: str = "1.0.0"

    # ── Base de données ───────────────────────────────────────────────────────
    database_url:         str = "postgresql+asyncpg://audit:audit@localhost/audit"
    database_pool_size:   int = 20
    database_max_overflow: int = 10

    # ── API ───────────────────────────────────────────────────────────────────
    api_host:    str = "127.0.0.1"
    api_port:    int = 8000
    api_workers: int = 2

    # ── Authentification ──────────────────────────────────────────────────────
    jwt_secret:          str = Field(default="change-me-in-production", min_length=32)
    jwt_expire_minutes:  int = 480
    jwt_algorithm:       str = "HS256"
    mfa_enabled:         bool = False

    # ── CDC ───────────────────────────────────────────────────────────────────
    cdc_adapter:            str = "synchdb"
    synchdb_url:            str = "http://localhost:8080"
    synchdb_api_key:        str = ""
    cdc_poll_interval_ms:   int = 500
    cdc_batch_size:         int = 100
    cdc_tables_filter:      Optional[str] = None   # "BANK.CUSTOMER,BANK.ACCOUNT"

    @property
    def cdc_tables_filter_list(self) -> Optional[list[str]]:
        if self.cdc_tables_filter:
            return [t.strip() for t in self.cdc_tables_filter.split(",") if t.strip()]
        return None

    # ── Oracle ────────────────────────────────────────────────────────────────
    oracle_host:    str = "localhost"
    oracle_port:    int = 1521
    oracle_service: str = "ORCL"
    oracle_user:    str = "audit_cdc"
    oracle_pass:    str = ""       # depuis .oracle_secrets — jamais loggué

    # ── Rétention ─────────────────────────────────────────────────────────────
    retention_hot_days:    int = 90
    retention_warm_days:   int = 365
    retention_cold_days:   int = 2555
    retention_min_risk_keep: str = "HIGH"

    # ── Archive ───────────────────────────────────────────────────────────────
    archive_format:       str = "parquet"
    archive_backend:      str = "filesystem"
    archive_local_path:   str = "/var/lib/audit-appliance/archive"
    archive_s3_endpoint:  str = ""
    archive_s3_bucket:    str = "audit-archive"
    archive_s3_access_key: str = ""
    archive_s3_secret_key: str = ""  # jamais loggué
    archive_s3_prefix:    str = "audit-archive/"

    # ── Alertes email ─────────────────────────────────────────────────────────
    alert_email_enabled: bool = False
    alert_email_to:      str  = ""
    alert_email_from:    str  = "audit-appliance@localhost"
    smtp_host:           str  = ""
    smtp_port:           int  = 587
    smtp_user:           str  = ""
    smtp_password:       str  = ""   # jamais loggué
    smtp_tls:            bool = True

    # ── Alertes webhook ───────────────────────────────────────────────────────
    alert_webhook_enabled: bool = False
    alert_webhook_url:     str  = ""

    # ── Monitoring ────────────────────────────────────────────────────────────
    disk_alert_threshold_gb:    int = 20
    disk_critical_threshold_gb: int = 5
    cdc_lag_alert_seconds:      int = 30
    cdc_lag_critical_seconds:   int = 300

    # ── Logs ──────────────────────────────────────────────────────────────────
    log_level:  str = "INFO"
    log_format: str = "json"

    # ── Intégrité ─────────────────────────────────────────────────────────────
    integrity_checkpoint_every_n: int  = 1000
    integrity_auto_verify:        bool = True
    integrity_verify_interval_hours: int = 6

    # ── Performance ───────────────────────────────────────────────────────────
    engine_max_queue_size:    int = 10_000
    rule_reload_interval_seconds: int = 60

    # ── Backup ────────────────────────────────────────────────────────────────
    backup_dest:         str = "local"
    backup_local_path:   str = "/mnt/backup"
    backup_encrypt_key:  str = ""  # jamais loggué

    @field_validator("jwt_secret")
    @classmethod
    def warn_weak_secret(cls, v: str) -> str:
        if v in ("change-me-in-production", "CHANGE_ME", ""):
            import warnings
            warnings.warn("JWT_SECRET faible détecté — changer avant la mise en production !", stacklevel=2)
        return v


# Instance singleton
settings = Settings()
