"""
Tests d'intégration — API FastAPI
Nécessite PostgreSQL en cours d'exécution avec la base audit_test.
"""
from __future__ import annotations
import os
import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("DATABASE_URL",   "postgresql+asyncpg://audit:audit@localhost/audit_test")
os.environ.setdefault("JWT_SECRET",     "test-secret-key-minimum-32-characters-long-for-tests")
os.environ.setdefault("SYNCHDB_URL",    "http://localhost:8080")
os.environ.setdefault("ORACLE_SERVICE", "TESTDB")
os.environ.setdefault("LOG_LEVEL",      "WARNING")

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../src"))


@pytest.fixture(scope="module")
async def client():
    from api.main import app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


@pytest.fixture(scope="module")
async def auth_headers(client):
    """Obtenir un token JWT valide pour les tests."""
    resp = await client.post(
        "/api/v1/auth/token",
        data={"username": "admin", "password": "admin_test_password_123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if resp.status_code == 200:
        token = resp.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}
    # Si l'admin n'existe pas encore, skip les tests auth
    return {}


class TestHealth:

    @pytest.mark.integration
    async def test_health_simple(self, client):
        resp = await client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data
        assert data["status"] in ("ok", "degraded", "error")

    @pytest.mark.integration
    async def test_root_redirect(self, client):
        resp = await client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "appliance" in data


class TestAuth:

    @pytest.mark.integration
    async def test_login_missing_credentials(self, client):
        resp = await client.post(
            "/api/v1/auth/token",
            data={"username": "", "password": ""},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code in (401, 422)

    @pytest.mark.integration
    async def test_login_wrong_credentials(self, client):
        resp = await client.post(
            "/api/v1/auth/token",
            data={"username": "wrong", "password": "wrong"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 401

    @pytest.mark.integration
    async def test_protected_route_without_token(self, client):
        resp = await client.get("/api/v1/events")
        assert resp.status_code == 401

    @pytest.mark.integration
    async def test_protected_route_with_invalid_token(self, client):
        resp = await client.get(
            "/api/v1/events",
            headers={"Authorization": "Bearer invalid.jwt.token"},
        )
        assert resp.status_code == 401


class TestEvents:

    @pytest.mark.integration
    async def test_list_events_requires_auth(self, client):
        resp = await client.get("/api/v1/events")
        assert resp.status_code == 401

    @pytest.mark.integration
    async def test_list_events_with_auth(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/events", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "total"     in data
        assert "page"      in data
        assert "page_size" in data
        assert "items"     in data
        assert isinstance(data["items"], list)

    @pytest.mark.integration
    async def test_list_events_pagination(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get(
            "/api/v1/events?page=1&page_size=10",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["page"]      == 1
        assert data["page_size"] == 10
        assert len(data["items"]) <= 10

    @pytest.mark.integration
    async def test_list_events_page_size_limit(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        # page_size > 500 doit être rejeté
        resp = await client.get(
            "/api/v1/events?page_size=1000",
            headers=auth_headers,
        )
        assert resp.status_code == 422

    @pytest.mark.integration
    async def test_get_event_not_found(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/events/999999999", headers=auth_headers)
        assert resp.status_code == 404

    @pytest.mark.integration
    async def test_search_events(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get(
            "/api/v1/events/search?risk_level=CRITICAL&page_size=5",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        for item in data["items"]:
            assert item["risk_level"] == "CRITICAL"


class TestDashboard:

    @pytest.mark.integration
    async def test_dashboard_structure(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/dashboard", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()

        required_fields = [
            "total_events", "events_today", "inserts", "updates", "deletes",
            "critical_events", "high_risk_events", "open_alerts",
            "events_per_second", "storage_used_bytes",
            "top_tables", "top_users", "events_by_hour", "risk_distribution",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

        assert isinstance(data["total_events"],    int)
        assert isinstance(data["top_tables"],      list)
        assert isinstance(data["risk_distribution"], dict)


class TestAlerts:

    @pytest.mark.integration
    async def test_list_alerts(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/alerts", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data

    @pytest.mark.integration
    async def test_list_alerts_filter_status(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get(
            "/api/v1/alerts?status=OPEN",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        for item in data["items"]:
            assert item["status"] == "OPEN"

    @pytest.mark.integration
    async def test_patch_alert_invalid_status(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.patch(
            "/api/v1/alerts/1",
            json={"status": "INVALID_STATUS"},
            headers=auth_headers,
        )
        assert resp.status_code in (400, 404)


class TestRules:

    @pytest.mark.integration
    async def test_list_rules(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/rules", headers=auth_headers)
        assert resp.status_code == 200
        rules = resp.json()
        assert isinstance(rules, list)
        # Les règles par défaut doivent être présentes
        if rules:
            rule = rules[0]
            assert "name"           in rule
            assert "rule_type"      in rule
            assert "risk_score_add" in rule
            assert "is_active"      in rule

    @pytest.mark.integration
    async def test_create_rule_requires_admin(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        # Si l'utilisateur n'est pas ADMIN, doit retourner 403
        # (ce test dépend du rôle du token utilisé)
        resp = await client.post(
            "/api/v1/rules",
            json={
                "name":           "Test Rule API",
                "rule_type":      "OPERATION_TYPE",
                "conditions":     {"type": "OPERATION_TYPE", "operations": ["DELETE"]},
                "risk_score_add": 30,
                "risk_level_min": "MEDIUM",
            },
            headers=auth_headers,
        )
        assert resp.status_code in (201, 403)


class TestCDC:

    @pytest.mark.integration
    async def test_cdc_status(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/cdc/status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


class TestIntegrity:

    @pytest.mark.integration
    async def test_integrity_status(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get("/api/v1/integrity/status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "last_checkpoint_time" in data
        assert "total_checkpoints"    in data


class TestTimeline:

    @pytest.mark.integration
    async def test_timeline_no_results(self, client, auth_headers):
        if not auth_headers:
            pytest.skip("No auth token available")
        resp = await client.get(
            "/api/v1/records/BANK/CUSTOMER/NONEXISTENT_KEY_12345/timeline",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []
