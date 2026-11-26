"""
Tests unitaires — Audit Engine
Couvre : idempotence, normalisation, masquage, risk scoring, integrity chain.
"""
from __future__ import annotations
import hashlib
import json
import pytest
from datetime import datetime, UTC
from unittest.mock import AsyncMock, MagicMock, patch

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src"))

from cdc.models      import CDCEvent, ColumnValue, DMLOperation, ValueSource
from engine.models   import AuditEvent, RiskLevel, RiskReason


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_cdc_event(**kwargs) -> CDCEvent:
    defaults = dict(
        event_id        = "evt-001",
        source_adapter  = "synchdb",
        source_position = "123456789",
        database        = "COREBANK",
        schema          = "BANK",
        table           = "CUSTOMER",
        operation       = DMLOperation.UPDATE,
        transaction_id  = "8.23.918273",
        scn             = 123456789,
        commit_scn      = 123456799,
        event_time      = datetime(2026, 11, 20, 15, 32, 18, tzinfo=UTC),
        commit_time     = datetime(2026, 11, 20, 15, 32, 18, tzinfo=UTC),
        primary_key     = {"CUSTOMER_ID": "123456"},
        before          = {"CREDIT_LIMIT": ColumnValue(5_000_000)},
        after           = {"CREDIT_LIMIT": ColumnValue(8_000_000)},
        db_user         = "APPUSER",
        client_identifier = "USER123",
        module          = "CORE_BANKING",
        action          = "CUSTOMER_UPDATE",
        client_ip       = "10.10.20.15",
        hostname        = "APP01",
    )
    defaults.update(kwargs)
    return CDCEvent(**defaults)


def make_audit_event(**kwargs) -> AuditEvent:
    defaults = dict(
        event_id        = __import__('uuid').UUID("a3f8d2e1-b9c4-0712-8e5f-1a2b3c4d5e6f"),
        raw_event_id    = 1,
        idempotency_key = "abc123",
        source_adapter  = "synchdb",
        source_position = "123456789",
        database_id     = 1,
        database_name   = "COREBANK",
        schema_name     = "BANK",
        table_name      = "CUSTOMER",
        operation       = "UPDATE",
        transaction_id  = "8.23.918273",
        scn             = 123456789,
        commit_scn      = 123456799,
        event_time      = datetime(2026, 11, 20, 15, 32, 18, tzinfo=UTC),
        commit_time     = datetime(2026, 11, 20, 15, 32, 18, tzinfo=UTC),
        primary_key     = {"CUSTOMER_ID": "123456"},
        before_data     = {"CREDIT_LIMIT": 5_000_000},
        after_data      = {"CREDIT_LIMIT": 8_000_000},
        changed_columns = ["CREDIT_LIMIT"],
        db_user_id      = None,
        db_username     = "APPUSER",
        app_user        = "USER123",
        client_identifier = "USER123",
        application_id  = None,
        application_name = "CORE_BANKING",
        client_ip       = "10.10.20.15",
        hostname        = "APP01",
        module          = "CORE_BANKING",
        action          = "CUSTOMER_UPDATE",
        risk_score      = 0,
        risk_level      = RiskLevel.LOW,
        risk_reasons    = [],
        event_hash      = "",
        previous_event_hash = None,
    )
    defaults.update(kwargs)
    return AuditEvent(**defaults)


# ── Tests CDCEvent ────────────────────────────────────────────────────────────

class TestCDCEvent:

    def test_idempotency_key_generated(self):
        """La clé d'idempotence est calculée automatiquement."""
        event = make_cdc_event()
        assert event.idempotency_key is not None
        assert len(event.idempotency_key) == 64  # SHA-256 hex

    def test_idempotency_key_deterministic(self):
        """Deux événements identiques produisent la même clé."""
        e1 = make_cdc_event()
        e2 = make_cdc_event()
        assert e1.idempotency_key == e2.idempotency_key

    def test_idempotency_key_differs_on_pk(self):
        """Des clés primaires différentes produisent des clés différentes."""
        e1 = make_cdc_event(primary_key={"CUSTOMER_ID": "111"})
        e2 = make_cdc_event(primary_key={"CUSTOMER_ID": "222"})
        assert e1.idempotency_key != e2.idempotency_key

    def test_idempotency_key_differs_on_scn(self):
        """Des SCN différents produisent des clés différentes."""
        e1 = make_cdc_event(scn=100)
        e2 = make_cdc_event(scn=200)
        assert e1.idempotency_key != e2.idempotency_key

    def test_changed_columns_update(self):
        """changed_columns détecte correctement les colonnes modifiées."""
        event = make_cdc_event(
            before={"STATUS": ColumnValue("ACTIVE"), "LIMIT": ColumnValue(5000)},
            after= {"STATUS": ColumnValue("ACTIVE"), "LIMIT": ColumnValue(8000)},
        )
        assert "LIMIT" in event.changed_columns
        assert "STATUS" not in event.changed_columns

    def test_changed_columns_insert(self):
        """Pour un INSERT, before est vide donc toutes les colonnes after sont 'changed'."""
        event = make_cdc_event(
            operation=DMLOperation.INSERT,
            before={},
            after={"STATUS": ColumnValue("ACTIVE"), "LIMIT": ColumnValue(5000)},
        )
        assert "STATUS" in event.changed_columns
        assert "LIMIT" in event.changed_columns

    def test_unavailable_value_preserved(self):
        """Les valeurs UNAVAILABLE ne sont jamais inventées."""
        event = make_cdc_event(
            before={"LOB_COL": ColumnValue(None, source=ValueSource.UNAVAILABLE)},
            after= {"LOB_COL": ColumnValue("new_val")},
        )
        assert event.before["LOB_COL"].source == ValueSource.UNAVAILABLE
        assert event.before["LOB_COL"].value is None


# ── Tests Masquage ────────────────────────────────────────────────────────────

class TestMasking:

    def test_mask_full(self):
        from engine.normalization import _apply_mask
        assert _apply_mask("secret", "FULL") == "***"

    def test_mask_partial_long(self):
        from engine.normalization import _apply_mask
        result = _apply_mask("1234567890123456", "PARTIAL")
        assert result.startswith("1234")
        assert result.endswith("3456")
        assert "*" in result

    def test_mask_partial_short(self):
        from engine.normalization import _apply_mask
        result = _apply_mask("12345", "PARTIAL")
        assert result == "*****"

    def test_mask_hash(self):
        from engine.normalization import _apply_mask
        result = _apply_mask("secret", "HASH")
        assert result.startswith("hash:")
        assert len(result) > 10

    def test_mask_redact(self):
        from engine.normalization import _apply_mask
        assert _apply_mask("anything", "REDACT") == "[REDACTED]"

    def test_mask_none_passthrough(self):
        from engine.normalization import _apply_mask
        assert _apply_mask("value", "NONE") == "value"

    def test_mask_none_value(self):
        from engine.normalization import _apply_mask
        assert _apply_mask(None, "FULL") is None


# ── Tests Risk Scoring ────────────────────────────────────────────────────────

class TestRiskScoring:

    def test_score_to_level_critical(self):
        from engine.risk import _score_to_level
        assert _score_to_level(80).value == "CRITICAL"
        assert _score_to_level(100).value == "CRITICAL"

    def test_score_to_level_high(self):
        from engine.risk import _score_to_level
        assert _score_to_level(60).value == "HIGH"
        assert _score_to_level(79).value == "HIGH"

    def test_score_to_level_medium(self):
        from engine.risk import _score_to_level
        assert _score_to_level(30).value == "MEDIUM"
        assert _score_to_level(59).value == "MEDIUM"

    def test_score_to_level_low(self):
        from engine.risk import _score_to_level
        assert _score_to_level(0).value == "LOW"
        assert _score_to_level(29).value == "LOW"

    def test_level_rank_ordering(self):
        from engine.risk import _level_rank
        assert _level_rank(RiskLevel.LOW) < _level_rank(RiskLevel.MEDIUM)
        assert _level_rank(RiskLevel.MEDIUM) < _level_rank(RiskLevel.HIGH)
        assert _level_rank(RiskLevel.HIGH) < _level_rank(RiskLevel.CRITICAL)

    @pytest.mark.asyncio
    async def test_eval_operation_type_match(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        event = make_audit_event(operation="DELETE")
        triggered, reason = await engine._eval_operation_type(
            event, {"type": "OPERATION_TYPE", "operations": ["DELETE"]}
        )
        assert triggered is True
        assert "DELETE" in reason

    @pytest.mark.asyncio
    async def test_eval_operation_type_no_match(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        event = make_audit_event(operation="UPDATE")
        triggered, reason = await engine._eval_operation_type(
            event, {"type": "OPERATION_TYPE", "operations": ["DELETE"]}
        )
        assert triggered is False

    @pytest.mark.asyncio
    async def test_eval_value_change_increase(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        event = make_audit_event(
            before_data={"CREDIT_LIMIT": 5_000_000},
            after_data= {"CREDIT_LIMIT": 8_000_000},
        )
        triggered, reason = await engine._eval_value_change(
            event, {
                "type": "VALUE_CHANGE",
                "column": "CREDIT_LIMIT",
                "threshold_pct": 50,
                "direction": "increase",
            }
        )
        assert triggered is True
        assert "60" in reason  # 60% increase

    @pytest.mark.asyncio
    async def test_eval_value_change_below_threshold(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        event = make_audit_event(
            before_data={"CREDIT_LIMIT": 5_000_000},
            after_data= {"CREDIT_LIMIT": 6_000_000},
        )
        triggered, _ = await engine._eval_value_change(
            event, {
                "type": "VALUE_CHANGE",
                "column": "CREDIT_LIMIT",
                "threshold_pct": 50,
                "direction": "increase",
            }
        )
        assert triggered is False   # 20% < 50%

    @pytest.mark.asyncio
    async def test_eval_time_window_outside_hours(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        # 15:32 un vendredi — dans les heures ouvrées 08-18 lun-ven
        event = make_audit_event(
            event_time=datetime(2026, 11, 20, 15, 32, 18, tzinfo=UTC)
        )
        triggered, _ = await engine._eval_time_window(
            event, {
                "type": "TIME_WINDOW",
                "work_start": [8, 0],
                "work_end": [18, 0],
                "work_days": [0, 1, 2, 3, 4],
            }
        )
        assert triggered is False  # Dans les heures ouvrées

    @pytest.mark.asyncio
    async def test_eval_time_window_weekend(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        # Samedi 14h
        event = make_audit_event(
            event_time=datetime(2026, 11, 21, 14, 0, 0, tzinfo=UTC)  # Samedi
        )
        triggered, reason = await engine._eval_time_window(
            event, {
                "type": "TIME_WINDOW",
                "work_start": [8, 0],
                "work_end": [18, 0],
                "work_days": [0, 1, 2, 3, 4],
            }
        )
        assert triggered is True
        assert "outside" in reason.lower()

    @pytest.mark.asyncio
    async def test_eval_ip_range_blocked(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        event = make_audit_event(client_ip="192.168.1.100")
        triggered, reason = await engine._eval_ip_range(
            event, {
                "type": "IP_RANGE",
                "blocked_ranges": ["192.168.0.0/16"],
            }
        )
        assert triggered is True
        assert "192.168.1.100" in reason

    @pytest.mark.asyncio
    async def test_eval_ip_range_allowed(self):
        from engine.risk import RiskEngine
        engine = RiskEngine.__new__(RiskEngine)
        event = make_audit_event(client_ip="10.10.20.15")
        triggered, _ = await engine._eval_ip_range(
            event, {
                "type": "IP_RANGE",
                "blocked_ranges": ["192.168.0.0/16"],
            }
        )
        assert triggered is False


# ── Tests Integrity Chain ─────────────────────────────────────────────────────

class TestIntegrityChain:

    def _compute_hash(self, canonical: str, previous: str = "GENESIS") -> str:
        return hashlib.sha256((canonical + previous).encode()).hexdigest()

    def test_genesis_hash_deterministic(self):
        """Le premier événement d'une table utilise GENESIS comme seed."""
        canonical = json.dumps({"id": "1", "op": "INSERT"}, sort_keys=True)
        h1 = self._compute_hash(canonical, "GENESIS")
        h2 = self._compute_hash(canonical, "GENESIS")
        assert h1 == h2

    def test_chain_links(self):
        """Chaque hash enchaîne avec le précédent."""
        canonical1 = json.dumps({"id": "1"}, sort_keys=True)
        canonical2 = json.dumps({"id": "2"}, sort_keys=True)

        hash1 = self._compute_hash(canonical1, "GENESIS")
        hash2 = self._compute_hash(canonical2, hash1)

        # Vérifier la chaîne
        assert hash2 == hashlib.sha256((canonical2 + hash1).encode()).hexdigest()

    def test_tamper_breaks_chain(self):
        """Modifier un événement brise la chaîne."""
        canonical1 = json.dumps({"id": "1", "value": 100}, sort_keys=True)
        canonical2 = json.dumps({"id": "2", "value": 200}, sort_keys=True)
        tampered1  = json.dumps({"id": "1", "value": 999}, sort_keys=True)

        hash1_real    = self._compute_hash(canonical1, "GENESIS")
        hash1_tampered = self._compute_hash(tampered1, "GENESIS")
        hash2_real    = self._compute_hash(canonical2, hash1_real)
        hash2_expected = self._compute_hash(canonical2, hash1_tampered)

        assert hash1_real != hash1_tampered
        assert hash2_real != hash2_expected   # La chaîne est brisée

    def test_hash_length(self):
        """Les hashs SHA-256 font toujours 64 caractères hex."""
        canonical = json.dumps({"id": "1"}, sort_keys=True)
        h = self._compute_hash(canonical)
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


# ── Tests Alerting Channels ───────────────────────────────────────────────────

class TestAlertingChannels:

    def test_teams_payload_structure(self):
        """Le payload Teams Adaptive Cards a la bonne structure."""
        from engine.alerting_channels import WebhookChannel
        channel = WebhookChannel("https://outlook.office.com/webhook/teams/xxx")

        event = make_audit_event(risk_score=87, risk_level=RiskLevel.CRITICAL)
        from engine.alerting import Alert
        alert = Alert(
            event=event, rule_id=1, rule_name="Test Rule",
            severity=RiskLevel.CRITICAL,
            title="Test Alert", description="Test description",
        )
        payload = channel._teams_payload(alert)
        assert payload["type"] == "message"
        assert "attachments" in payload
        body = payload["attachments"][0]["content"]["body"]
        assert any("CRITICAL" in str(b) for b in body)

    def test_slack_payload_structure(self):
        """Le payload Slack a la bonne structure."""
        from engine.alerting_channels import WebhookChannel
        channel = WebhookChannel("https://hooks.slack.com/services/xxx")

        event = make_audit_event(risk_score=87, risk_level=RiskLevel.HIGH)
        from engine.alerting import Alert
        alert = Alert(
            event=event, rule_id=1, rule_name="Test Rule",
            severity=RiskLevel.HIGH,
            title="High Risk Event", description="Description",
        )
        payload = channel._slack_payload(alert)
        assert "text" in payload
        assert "attachments" in payload
        assert "HIGH" in payload["text"] or "🟠" in payload["text"]

    def test_generic_payload_fields(self):
        """Le payload générique contient tous les champs attendus."""
        from engine.alerting_channels import WebhookChannel
        channel = WebhookChannel("https://ntfy.sh/my-audit-topic")

        event = make_audit_event(risk_score=50)
        from engine.alerting import Alert
        alert = Alert(
            event=event, rule_id=1, rule_name="Test Rule",
            severity=RiskLevel.MEDIUM,
            title="Medium Alert", description="Desc",
        )
        payload = channel._generic_payload(alert)
        required_keys = ["severity", "title", "description", "table", "event_time", "risk_score"]
        for key in required_keys:
            assert key in payload, f"Missing key: {key}"


# ── Tests SynchDB Parser ──────────────────────────────────────────────────────

class TestSynchDBParser:

    def _make_parser(self):
        from cdc.synchdb import SynchDBAdapter
        adapter = SynchDBAdapter.__new__(SynchDBAdapter)
        adapter._db_name = "COREBANK"
        adapter._errors  = 0
        return adapter

    def test_parse_update_event(self):
        """Un événement UPDATE valide est correctement parsé."""
        adapter = self._make_parser()
        raw = {
            "event_id":       "uuid-001",
            "operation":      "UPDATE",
            "database":       "COREBANK",
            "schema":         "BANK",
            "table":          "CUSTOMER",
            "transaction_id": "8.23.918273",
            "scn":            123456789,
            "commit_scn":     123456799,
            "event_time":     "2026-11-20T15:32:18+00:00",
            "primary_key":    {"CUSTOMER_ID": "123456"},
            "before":         {"STATUS": "ACTIVE", "CREDIT_LIMIT": 5000000},
            "after":          {"STATUS": "ACTIVE", "CREDIT_LIMIT": 8000000},
            "db_user":        "APPUSER",
            "client_ip":      "10.10.20.15",
        }
        event = adapter._parse(raw)
        assert event is not None
        assert event.operation.value == "UPDATE"
        assert event.primary_key == {"CUSTOMER_ID": "123456"}
        assert event.before["CREDIT_LIMIT"].value == 5_000_000
        assert event.after["CREDIT_LIMIT"].value  == 8_000_000
        assert event.client_ip == "10.10.20.15"

    def test_parse_insert_no_before(self):
        """Un INSERT sans BEFORE est valide (normal pour INSERT)."""
        adapter = self._make_parser()
        raw = {
            "operation":  "INSERT",
            "database":   "COREBANK",
            "schema":     "BANK",
            "table":      "CUSTOMER",
            "event_time": "2026-11-20T08:12:03+00:00",
            "primary_key": {"CUSTOMER_ID": "999"},
            "before":     {},
            "after":      {"STATUS": "ACTIVE"},
        }
        event = adapter._parse(raw)
        assert event is not None
        assert event.before == {}
        assert event.after["STATUS"].value == "ACTIVE"

    def test_parse_unknown_operation_returns_none(self):
        """Une opération inconnue retourne None sans lever d'exception."""
        adapter = self._make_parser()
        raw = {
            "operation":  "UNKNOWN_OP",
            "database":   "COREBANK",
            "schema":     "BANK",
            "table":      "X",
            "event_time": "2026-11-20T10:00:00+00:00",
            "primary_key": {},
            "before":     {},
            "after":      {},
        }
        event = adapter._parse(raw)
        assert event is None

    def test_parse_idempotency_key_generated(self):
        """La clé d'idempotence est générée automatiquement si absente."""
        adapter = self._make_parser()
        raw = {
            "operation":      "DELETE",
            "database":       "COREBANK",
            "schema":         "BANK",
            "table":          "LOAN",
            "transaction_id": "1.2.3",
            "scn":            100,
            "event_time":     "2026-11-20T12:00:00+00:00",
            "primary_key":    {"LOAN_ID": "777"},
            "before":         {"AMOUNT": 1000000},
            "after":          {},
        }
        event = adapter._parse(raw)
        assert event is not None
        assert event.idempotency_key is not None
        assert len(event.idempotency_key) == 64
