"""Configuration pytest — Oracle Data Audit & Forensics Appliance."""
import sys
import os
import pytest

# Ajouter src au PYTHONPATH pour tous les tests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

# Variables d'environnement pour les tests (évite de charger appliance.env)
os.environ.setdefault("DATABASE_URL",    "postgresql+asyncpg://audit:audit@localhost/audit_test")
os.environ.setdefault("JWT_SECRET",      "test-secret-key-minimum-32-characters-long")
os.environ.setdefault("SYNCHDB_URL",     "http://localhost:8080")
os.environ.setdefault("ORACLE_SERVICE",  "TESTDB")
os.environ.setdefault("LOG_LEVEL",       "WARNING")


@pytest.fixture
def sample_cdc_event():
    from datetime import datetime, UTC
    from cdc.models import CDCEvent, ColumnValue, DMLOperation
    return CDCEvent(
        event_id        = "test-event-001",
        source_adapter  = "test",
        source_position = "999",
        database        = "TESTDB",
        schema          = "SCHEMA",
        table           = "TABLE",
        operation       = DMLOperation.UPDATE,
        transaction_id  = "1.1.1",
        scn             = 1000,
        commit_scn      = 1001,
        event_time      = datetime(2026, 1, 15, 10, 0, 0, tzinfo=UTC),
        primary_key     = {"ID": "42"},
        before          = {"VAL": ColumnValue(100)},
        after           = {"VAL": ColumnValue(200)},
        db_user         = "TESTUSER",
        client_ip       = "10.0.0.1",
    )
