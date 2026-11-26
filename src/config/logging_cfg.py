"""Configuration du logging structuré JSON."""
from __future__ import annotations
import json
import logging
import sys
from datetime import datetime, UTC

SENSITIVE_FIELDS = frozenset({
    "before_data", "after_data", "password", "token",
    "password_hash", "mfa_secret", "card_number",
    "oracle_pass", "smtp_password", "backup_encrypt_key",
    "archive_s3_secret_key", "synchdb_api_key",
})


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # Le message peut être un dict (log structuré) ou une chaîne
        raw = record.getMessage()
        if isinstance(raw, dict):
            log = {
                "timestamp":  datetime.now(UTC).isoformat(),
                "level":      record.levelname,
                "component":  raw.pop("component", record.name),
                **{k: "***REDACTED***" if k in SENSITIVE_FIELDS else v
                   for k, v in raw.items()},
            }
        else:
            log = {
                "timestamp": datetime.now(UTC).isoformat(),
                "level":     record.levelname,
                "logger":    record.name,
                "message":   raw,
            }

        if record.exc_info:
            log["exception"] = self.formatException(record.exc_info)

        return json.dumps(log, default=str, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.handlers = [handler]

    # Réduire le bruit des bibliothèques tierces
    for noisy in ("uvicorn.access", "sqlalchemy.engine", "httpx", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
