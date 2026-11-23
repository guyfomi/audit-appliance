# =============================================================================
# Oracle Data Audit & Forensics Appliance — Makefile
# =============================================================================

APPLIANCE_VERSION := 1.0.0
PYTHON            := /opt/audit-appliance/venv/bin/python
PIP               := /opt/audit-appliance/venv/bin/pip
ALEMBIC           := /opt/audit-appliance/venv/bin/alembic
PYTEST            := /opt/audit-appliance/venv/bin/pytest
TOKEN             ?= ""

.PHONY: help install dev-up dev-down migrate test test-load \
        backup restore verify-integrity build-ova build-qcow2 \
        status logs restart clean release

# ── Aide ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Oracle Data Audit & Forensics Appliance v$(APPLIANCE_VERSION)"
	@echo ""
	@echo "Installation:"
	@echo "  make install         Installer l'appliance sur ce système"
	@echo ""
	@echo "Développement:"
	@echo "  make dev-up          Démarrer l'environnement Docker de dev"
	@echo "  make dev-down        Arrêter l'environnement Docker de dev"
	@echo ""
	@echo "Base de données:"
	@echo "  make migrate         Exécuter les migrations Alembic"
	@echo "  make migrate-status  Voir le statut des migrations"
	@echo ""
	@echo "Tests:"
	@echo "  make test            Tests unitaires et d'intégration"
	@echo "  make test-load       Tests de charge (1k/5k/10k eps)"
	@echo "  make test-resilience Tests de résilience"
	@echo ""
	@echo "Opérations:"
	@echo "  make backup          Lancer un backup manuel"
	@echo "  make verify-integrity Vérifier la chaîne SHA-256"
	@echo "  make status          État de tous les services"
	@echo "  make logs            Afficher les logs en temps réel"
	@echo "  make restart         Redémarrer tous les services"
	@echo ""
	@echo "Build:"
	@echo "  make build-ova       Construire l'image OVA (VMware)"
	@echo "  make build-qcow2     Construire l'image QCOW2 (Proxmox/KVM)"
	@echo "  make release         Build + package complet"
	@echo ""

# ── Installation ──────────────────────────────────────────────────────────────
install:
	@echo "==> Installation de l'appliance..."
	sudo bash install/install.sh

setup:
	@echo "==> Assistant de configuration..."
	sudo bash install/setup-wizard.sh

# ── Développement ─────────────────────────────────────────────────────────────
dev-up:
	docker compose -f docker-compose.dev.yml up -d
	@echo "API disponible sur http://localhost:8000"
	@echo "MinIO console : http://localhost:9001"

dev-down:
	docker compose -f docker-compose.dev.yml down

dev-logs:
	docker compose -f docker-compose.dev.yml logs -f

# ── Base de données ───────────────────────────────────────────────────────────
migrate:
	$(ALEMBIC) --config src/alembic.ini upgrade head

migrate-status:
	$(ALEMBIC) --config src/alembic.ini current
	$(ALEMBIC) --config src/alembic.ini history

migrate-rollback:
	$(ALEMBIC) --config src/alembic.ini downgrade -1

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	$(PYTEST) tests/unit tests/integration -v \
		--tb=short \
		--cov=src \
		--cov-report=term-missing \
		--cov-report=html:reports/coverage

test-load:
	@echo "==> Tests de charge (cible: 1k, 5k, 10k eps)"
	$(PYTHON) tests/load/run_all.py
	@echo "Résultats dans benchmark_results.json"

test-resilience:
	@echo "==> Tests de résilience (nécessite sudo)"
	sudo $(PYTEST) tests/resilience -v --tb=short -s

test-fast:
	$(PYTEST) tests/unit -v -x --tb=short

# ── Opérations ────────────────────────────────────────────────────────────────
backup:
	sudo bash bin/appliance-backup.sh
	@echo "Backup terminé. Vérifier /mnt/backup/"

verify-integrity:
	@echo "==> Vérification de l'intégrité des événements..."
	curl -sk -X POST https://localhost/api/v1/integrity/verify \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"database_id":1,"schema_name":"BANK","table_name":"CUSTOMER"}' | jq .

status:
	@echo "==> État des services"
	@systemctl is-active --quiet audit-cdc    && echo "✓ audit-cdc"    || echo "✗ audit-cdc"
	@systemctl is-active --quiet audit-engine && echo "✓ audit-engine" || echo "✗ audit-engine"
	@systemctl is-active --quiet audit-api    && echo "✓ audit-api"    || echo "✗ audit-api"
	@systemctl is-active --quiet postgresql   && echo "✓ postgresql"   || echo "✗ postgresql"
	@systemctl is-active --quiet nginx        && echo "✓ nginx"        || echo "✗ nginx"
	@echo ""
	@echo "==> Santé de l'appliance"
	@curl -sk https://localhost/api/v1/health/detail 2>/dev/null | jq '{status, cdc_lag: .checks.cdc_lag_seconds, disk_free_gb: .checks.disk_free_gb}' || echo "API non disponible"

logs:
	journalctl -u audit-cdc -u audit-engine -u audit-api -f --output=short-precise

logs-engine:
	journalctl -u audit-engine -f --output=json | jq -r '"\(.REALTIME_TIMESTAMP) [\(.PRIORITY)] \(.MESSAGE)"'

restart:
	sudo systemctl restart audit-cdc audit-engine audit-api
	@echo "Services redémarrés"

stop:
	sudo systemctl stop audit-cdc
	sleep 3
	sudo systemctl stop audit-engine audit-api

start:
	sudo systemctl start audit-engine audit-api
	sleep 5
	sudo systemctl start audit-cdc

cdc-status:
	curl -sk -H "Authorization: Bearer $(TOKEN)" \
		https://localhost/api/v1/cdc/status | jq .

cdc-pause:
	curl -sk -X POST "https://localhost/api/v1/cdc/pause?database_id=1" \
		-H "Authorization: Bearer $(TOKEN)" | jq .

cdc-resume:
	curl -sk -X POST "https://localhost/api/v1/cdc/resume?database_id=1" \
		-H "Authorization: Bearer $(TOKEN)" | jq .

# ── Build appliance ───────────────────────────────────────────────────────────
build-ui:
	@echo "==> Build de l'interface React"
	cd ui && npm ci && npm run build
	sudo cp -r ui/dist/* /opt/audit-appliance/ui/dist/

build-ova:
	@echo "==> Build OVA (VMware ESXi/vSphere)"
	mkdir -p dist
	packer build packer/ubuntu.pkr.hcl
	@echo "OVA disponible dans dist/"

build-qcow2:
	@echo "==> Build QCOW2 (Proxmox/KVM)"
	mkdir -p dist
	packer build -only=qemu packer/ubuntu.pkr.hcl
	@echo "QCOW2 disponible dans dist/"

release: build-ui
	@echo "==> Package de release v$(APPLIANCE_VERSION)"
	mkdir -p dist/release
	tar czf dist/release/oracle-audit-appliance-$(APPLIANCE_VERSION)-src.tar.gz \
		--exclude='.git' \
		--exclude='dist' \
		--exclude='__pycache__' \
		--exclude='*.pyc' \
		--exclude='venv' \
		--exclude='node_modules' \
		.
	sha256sum dist/release/*.tar.gz > dist/release/SHA256SUMS
	@echo "Release: dist/release/oracle-audit-appliance-$(APPLIANCE_VERSION)-src.tar.gz"

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache htmlcov reports/coverage
	@echo "Nettoyage terminé"
