#!/usr/bin/env bash
# =============================================================================
# SynchDB Oracle CDC Connector — Script d'installation
# Usage : sudo bash install-synchdb.sh [--embedded | --standalone]
# --embedded   : installation sur la même VM que l'appliance (défaut)
# --standalone : configuration réseau uniquement (SynchDB sur VM dédiée)
# =============================================================================

set -euo pipefail

SYNCHDB_VERSION="1.4.2"
SYNCHDB_HOME="/opt/synchdb"
SYNCHDB_USER="synchdb"
JAVA_MIN_VERSION=17

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${BLUE}══ $* ══${NC}"; }

MODE="${1:---embedded}"
[[ $EUID -ne 0 ]] && error "Exécuter en tant que root"

# ── Lire la configuration Oracle ─────────────────────────────────────────────
load_oracle_config() {
    if [[ -f /opt/audit-appliance/config/.oracle_secrets ]]; then
        source /opt/audit-appliance/config/.oracle_secrets
        info "Configuration Oracle chargée depuis l'appliance"
    else
        section "Configuration Oracle"
        read -rp "  Hôte Oracle: "    ORA_HOST
        read -rp "  Port Oracle: "    ORA_PORT; ORA_PORT=${ORA_PORT:-1521}
        read -rp "  Service Oracle: " ORA_SERVICE
        read -rp "  Utilisateur CDC: " ORA_USER; ORA_USER=${ORA_USER:-audit_cdc}
        read -rsp "  Mot de passe CDC: " ORA_PASS; echo ""
    fi

    # Lire le nom du service depuis appliance.env si disponible
    if [[ -f /opt/audit-appliance/config/appliance.env ]]; then
        source /opt/audit-appliance/config/appliance.env
        ORA_HOST="${ORACLE_HOST:-${ORA_HOST:-}}"
        ORA_PORT="${ORACLE_PORT:-${ORA_PORT:-1521}}"
        ORA_SERVICE="${ORACLE_SERVICE:-${ORA_SERVICE:-}}"
    fi
}

# ── Java ──────────────────────────────────────────────────────────────────────
install_java() {
    section "Java ${JAVA_MIN_VERSION}+"

    if command -v java &>/dev/null; then
        local ver
        ver=$(java -version 2>&1 | grep -oP '(?<=version ")[\d]+' | head -1)
        if [[ ${ver:-0} -ge ${JAVA_MIN_VERSION} ]]; then
            info "Java ${ver} déjà installé"
            return
        fi
    fi

    info "Installation de OpenJDK ${JAVA_MIN_VERSION}..."
    apt-get update -qq
    apt-get install -y --no-install-recommends "openjdk-${JAVA_MIN_VERSION}-jre-headless"
    info "Java $(java -version 2>&1 | head -1) installé"
}

# ── Répertoires et utilisateur ────────────────────────────────────────────────
create_synchdb_structure() {
    section "Création de la structure SynchDB"

    if ! id "${SYNCHDB_USER}" &>/dev/null; then
        useradd --system \
            --home-dir "${SYNCHDB_HOME}" \
            --shell /bin/false \
            --comment "SynchDB CDC Connector" \
            "${SYNCHDB_USER}"
        info "Utilisateur système '${SYNCHDB_USER}' créé"
    fi

    mkdir -p "${SYNCHDB_HOME}"/{bin,config,logs,checkpoint,lib}
    chown -R "${SYNCHDB_USER}:${SYNCHDB_USER}" "${SYNCHDB_HOME}"
    chmod 750 "${SYNCHDB_HOME}/config"
    info "Répertoires créés dans ${SYNCHDB_HOME}"
}

# ── Téléchargement SynchDB ────────────────────────────────────────────────────
download_synchdb() {
    section "Téléchargement de SynchDB ${SYNCHDB_VERSION}"

    local jar="${SYNCHDB_HOME}/bin/synchdb-oracle-${SYNCHDB_VERSION}.jar"

    if [[ -f "${jar}" ]]; then
        info "SynchDB déjà téléchargé"
    else
        warn "Téléchargement depuis le dépôt officiel SynchDB..."
        warn "Remplacer l'URL ci-dessous par l'URL réelle de votre licence"
        # wget -O "${jar}" "https://releases.synchdb.io/synchdb-oracle-${SYNCHDB_VERSION}.jar"

        # Pour le développement : créer un jar simulé
        if [[ "${SYNCHDB_VERSION}" == "MOCK" ]] || [[ ! -f "${jar}" ]]; then
            warn "Mode développement : création d'un connecteur mock"
            # Le mock est fourni dans tests/synchdb-mock/
        fi
    fi

    if [[ -f "${jar}" ]]; then
        ln -sf "${jar}" "${SYNCHDB_HOME}/bin/synchdb.jar"
        chown "${SYNCHDB_USER}:${SYNCHDB_USER}" "${jar}"
        info "SynchDB ${SYNCHDB_VERSION} prêt"
    fi
}

# ── Configuration ─────────────────────────────────────────────────────────────
write_synchdb_config() {
    section "Écriture de la configuration SynchDB"

    # Générer un token API sécurisé
    local api_key
    api_key=$(openssl rand -hex 32)

    # Lire les tables configurées dans l'appliance
    local tables_include=""
    if command -v psql &>/dev/null && [[ -f /opt/audit-appliance/config/.pgpass ]]; then
        tables_include=$(PGPASSFILE=/opt/audit-appliance/config/.pgpass \
            psql -h localhost -U audit -d audit -t \
            -c "SELECT '    - \"' || schema_name || '.' || table_name || '\"'
                FROM audit_table_config
                ORDER BY schema_name, table_name" 2>/dev/null || echo "")
    fi

    if [[ -z "${tables_include}" ]]; then
        tables_include='    # Ajouter les tables ici
    # - "BANK.CUSTOMER"
    # - "BANK.ACCOUNT"'
    fi

    cat > "${SYNCHDB_HOME}/config/synchdb.yml" << EOF
# =============================================================================
# SynchDB Oracle CDC Connector — Configuration
# Généré le $(date -u +%FT%TZ)
# =============================================================================

server:
  port: 8080
  host: 0.0.0.0
  api_key: "${api_key}"

oracle:
  host: "${ORA_HOST:-oracle-host.internal}"
  port: ${ORA_PORT:-1521}
  service: "${ORA_SERVICE:-COREBANK}"
  user: "${ORA_USER:-audit_cdc}"
  password: "${ORA_PASS:-CHANGE_ME}"
  connection_timeout_seconds: 30
  retry_interval_seconds: 15
  max_retries: 10

cdc:
  start_scn: null
  batch_size: 500
  poll_delay_ms: 100
  checkpoint_retention_days: 7
  checkpoint_file: "${SYNCHDB_HOME}/checkpoint/synchdb.checkpoint"
  include_session_context: true
  include_before: true
  scn_stability_delay_seconds: 2
  # Inclure les colonnes non modifiées dans BEFORE (utile pour audit complet)
  include_unchanged_toasted: false

tables:
  include:
${tables_include}
  exclude:
    - "%TEMP%"
    - "%TMP%"
    - "%LOG%"
    - "%STAGING%"
    - "%AUD\$%"

logging:
  level: INFO
  format: json
  file: "${SYNCHDB_HOME}/logs/synchdb.log"
  max_size_mb: 100
  max_files: 10

health:
  enabled: true
  endpoint: "/health"
  lag_endpoint: "/lag"
  status_endpoint: "/status"
  metrics_endpoint: "/metrics"
EOF

    chmod 600 "${SYNCHDB_HOME}/config/synchdb.yml"
    chown "${SYNCHDB_USER}:${SYNCHDB_USER}" "${SYNCHDB_HOME}/config/synchdb.yml"

    # Enregistrer le token dans la configuration de l'appliance
    if [[ -f /opt/audit-appliance/config/appliance.env ]]; then
        # Supprimer l'ancienne valeur si présente
        sed -i '/^SYNCHDB_API_KEY=/d' /opt/audit-appliance/config/appliance.env
        echo "SYNCHDB_API_KEY=${api_key}" >> /opt/audit-appliance/config/appliance.env
        info "Token API enregistré dans la configuration de l'appliance"
    fi

    info "Configuration SynchDB écrite"
    warn "Token API : ${api_key}"
    warn "Conserver ce token — il est aussi dans /opt/audit-appliance/config/appliance.env"
}

# ── Service systemd ───────────────────────────────────────────────────────────
install_systemd_service() {
    section "Service systemd SynchDB"

    cat > /etc/systemd/system/synchdb.service << EOF
[Unit]
Description=SynchDB Oracle CDC Connector v${SYNCHDB_VERSION}
After=network-online.target
Wants=network-online.target
Documentation=file://${SYNCHDB_HOME}/docs/SYNCHDB.md

[Service]
Type=exec
User=${SYNCHDB_USER}
Group=${SYNCHDB_USER}
WorkingDirectory=${SYNCHDB_HOME}

ExecStart=/usr/bin/java \\
    -Xms256m \\
    -Xmx512m \\
    -XX:+UseG1GC \\
    -XX:MaxGCPauseMillis=100 \\
    -XX:+HeapDumpOnOutOfMemoryError \\
    -XX:HeapDumpPath=${SYNCHDB_HOME}/logs/heapdump.hprof \\
    -Djava.security.egd=file:/dev/./urandom \\
    -jar ${SYNCHDB_HOME}/bin/synchdb.jar \\
    --config=${SYNCHDB_HOME}/config/synchdb.yml

# Arrêt propre
ExecStop=/bin/sh -c 'kill -TERM \$MAINPID; sleep 5'

Restart=on-failure
RestartSec=15
StartLimitInterval=300
StartLimitBurst=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=synchdb

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${SYNCHDB_HOME}/logs
ReadWritePaths=${SYNCHDB_HOME}/checkpoint

LimitNOFILE=65536
TimeoutStartSec=120
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable synchdb

    info "Service systemd installé"
}

# ── Mock SynchDB pour développement ──────────────────────────────────────────
install_mock_server() {
    section "Serveur mock SynchDB (développement)"
    info "Installation du serveur mock Python pour les tests..."

    cat > "${SYNCHDB_HOME}/bin/synchdb-mock.py" << 'PYEOF'
#!/usr/bin/env python3
"""
SynchDB Mock Server — Simule l'API SynchDB pour le développement et les tests.
Génère des événements CDC synthétiques réalistes.
Usage: python3 synchdb-mock.py [--port 8080] [--eps 10]
"""

import argparse
import json
import random
import time
import uuid
from datetime import datetime, UTC
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Lock
from urllib.parse import parse_qs, urlparse

# ── Configuration ──────────────────────────────────────────────────────────────
TABLES = [
    ("BANK", "CUSTOMER",    ["CUSTOMER_ID"]),
    ("BANK", "ACCOUNT",     ["ACCOUNT_ID"]),
    ("BANK", "LOAN",        ["LOAN_ID"]),
    ("BANK", "TRANSACTION", ["TRANSACTION_ID"]),
    ("BANK", "COLLATERAL",  ["COLLATERAL_ID"]),
]
OPERATIONS = ["INSERT", "UPDATE", "UPDATE", "UPDATE", "DELETE"]
DB_USERS   = ["APPUSER", "BATCHJOB", "ADMIN01", "REPORTING"]
MODULES    = ["CORE_BANKING", "BATCH", "ADMIN_PORTAL", "REPORTING"]
IPS        = ["10.10.20.15", "10.10.20.16", "10.10.1.5", "10.10.10.2"]

class MockState:
    def __init__(self):
        self.lock       = Lock()
        self.current_scn = 100_000_000
        self.events     = []
        self.start_time = time.time()

    def generate_event(self):
        with self.lock:
            self.current_scn += random.randint(1, 10)
            schema, table, pks = random.choice(TABLES)
            operation = random.choice(OPERATIONS)
            pk_val    = str(random.randint(1, 999_999))
            txn_id    = f"{random.randint(1,20)}.{random.randint(1,99)}.{random.randint(100000,999999)}"
            now       = datetime.now(UTC).isoformat()

            event = {
                "event_id":        str(uuid.uuid4()),
                "operation":       operation,
                "database":        "COREBANK",
                "schema":          schema,
                "table":           table,
                "transaction_id":  txn_id,
                "scn":             self.current_scn,
                "commit_scn":      self.current_scn + random.randint(1, 5),
                "event_time":      now,
                "commit_time":     now,
                "primary_key":     {pks[0]: pk_val},
                "before":          self._make_row(table, operation, "before"),
                "after":           self._make_row(table, operation, "after"),
                "db_user":         random.choice(DB_USERS),
                "client_identifier": f"USER{random.randint(100,999)}",
                "module":          random.choice(MODULES),
                "action":          f"{table}_{'CREATE' if operation=='INSERT' else operation}",
                "client_ip":       random.choice(IPS),
                "hostname":        f"APP{random.randint(1,10):02d}",
            }
            self.events.append(event)
            # Garder seulement les 10 000 derniers
            if len(self.events) > 10_000:
                self.events = self.events[-10_000:]
            return event

    def _make_row(self, table, operation, side):
        if operation == "INSERT" and side == "before":
            return {}
        if operation == "DELETE" and side == "after":
            return {}
        base = {
            "CUSTOMER":    {"STATUS": random.choice(["ACTIVE","ACTIVE","ACTIVE","BLOCKED"]),
                            "CREDIT_LIMIT": random.randint(100_000, 10_000_000),
                            "BRANCH_CODE": random.choice(["AKWA","BIYEM","ESSOS"])},
            "ACCOUNT":     {"BALANCE": random.randint(0, 50_000_000),
                            "STATUS": random.choice(["OPEN","OPEN","CLOSED"])},
            "LOAN":        {"AMOUNT": random.randint(1_000_000, 100_000_000),
                            "STATUS": random.choice(["ACTIVE","ACTIVE","OVERDUE"])},
            "TRANSACTION": {"AMOUNT": random.randint(1_000, 5_000_000),
                            "TYPE": random.choice(["DEBIT","CREDIT","TRANSFER"])},
            "COLLATERAL":  {"VALUE": random.randint(1_000_000, 500_000_000),
                            "TYPE": random.choice(["REAL_ESTATE","VEHICLE","EQUIPMENT"])},
        }
        return base.get(table, {"VALUE": str(uuid.uuid4())})

    def get_events_after_scn(self, after_scn, limit):
        with self.lock:
            if after_scn is None:
                return self.events[-limit:]
            return [e for e in self.events if e["scn"] > after_scn][:limit]

    def get_lag_seconds(self, from_scn):
        if not self.events:
            return 0.0
        latest_scn = self.events[-1]["scn"] if self.events else self.current_scn
        scn_diff = max(0, latest_scn - (from_scn or latest_scn))
        return round(scn_diff * 0.001, 3)


state = MockState()

class SynchDBHandler(BaseHTTPRequestHandler):
    API_KEY = "mock-api-key"

    def log_message(self, format, *args):
        pass  # Désactiver les logs HTTP bruyants

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def check_auth(self):
        key = self.headers.get("X-API-Key", "")
        return key == self.API_KEY or self.API_KEY == "mock-api-key"

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = parsed.path
        params = parse_qs(parsed.query)

        if path == "/health":
            self.send_json({
                "status":              "UP",
                "oracle":              "connected",
                "current_scn":         state.current_scn,
                "last_checkpoint_scn": state.current_scn - 100,
                "lag_seconds":         0.4,
                "events_captured":     len(state.events),
                "uptime_seconds":      round(time.time() - state.start_time, 1),
                "version":             "1.4.2-mock",
            })

        elif path == "/status":
            self.send_json({
                "status":        "RUNNING",
                "oracle_host":   "mock-oracle",
                "oracle_service":"COREBANK",
                "current_scn":   state.current_scn,
                "batch_size":    500,
                "poll_delay_ms": 100,
            })

        elif path == "/lag":
            from_scn = int(params.get("from_scn", [state.current_scn])[0])
            self.send_json({"lag_seconds": state.get_lag_seconds(from_scn)})

        elif path == "/changes":
            after_scn_str = params.get("after_scn", [None])[0]
            after_scn = int(after_scn_str) if after_scn_str else None
            limit     = int(params.get("limit", [100])[0])
            events    = state.get_events_after_scn(after_scn, limit)
            next_scn  = events[-1]["commit_scn"] + 1 if events else state.current_scn
            self.send_json({
                "changes":      events,
                "count":        len(events),
                "next_scn":     next_scn,
                "query_time_ms":random.randint(1, 20),
            })

        elif path == "/metrics":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            metrics = f"""# HELP synchdb_events_total Total events captured
# TYPE synchdb_events_total counter
synchdb_events_total {len(state.events)}
# HELP synchdb_current_scn Current Oracle SCN
# TYPE synchdb_current_scn gauge
synchdb_current_scn {state.current_scn}
# HELP synchdb_lag_seconds CDC lag in seconds
# TYPE synchdb_lag_seconds gauge
synchdb_lag_seconds 0.4
"""
            self.wfile.write(metrics.encode())

        else:
            self.send_json({"error": "Not found"}, 404)


def generate_events_background(eps, state):
    """Génère des événements en arrière-plan au débit demandé."""
    import threading
    interval = 1.0 / eps

    def _loop():
        while True:
            state.generate_event()
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True)
    t.start()


def main():
    parser = argparse.ArgumentParser(description="SynchDB Mock Server")
    parser.add_argument("--port",   type=int,   default=8080)
    parser.add_argument("--eps",    type=float, default=10,
                        help="Events per second to generate")
    parser.add_argument("--api-key",             default="mock-api-key")
    args = parser.parse_args()

    SynchDBHandler.API_KEY = args.api_key

    print(json.dumps({
        "timestamp": datetime.now(UTC).isoformat(),
        "level": "INFO",
        "component": "synchdb-mock",
        "message": f"Mock server starting on port {args.port} at {args.eps} eps",
        "api_key": args.api_key,
    }))

    generate_events_background(args.eps, state)

    server = HTTPServer(("0.0.0.0", args.port), SynchDBHandler)
    print(json.dumps({
        "timestamp": datetime.now(UTC).isoformat(),
        "level": "INFO",
        "component": "synchdb-mock",
        "message": f"Listening on http://0.0.0.0:{args.port}",
    }))
    server.serve_forever()


if __name__ == "__main__":
    main()
PYEOF

    chmod +x "${SYNCHDB_HOME}/bin/synchdb-mock.py"
    chown "${SYNCHDB_USER}:${SYNCHDB_USER}" "${SYNCHDB_HOME}/bin/synchdb-mock.py"

    # Service systemd pour le mock
    cat > /etc/systemd/system/synchdb-mock.service << EOF
[Unit]
Description=SynchDB Mock Server (développement uniquement)
After=network.target

[Service]
Type=exec
User=${SYNCHDB_USER}
WorkingDirectory=${SYNCHDB_HOME}
ExecStart=/usr/bin/python3 ${SYNCHDB_HOME}/bin/synchdb-mock.py --port 8080 --eps 20
Restart=on-failure
RestartSec=5
StandardOutput=journal
SyslogIdentifier=synchdb-mock

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    info "Mock SynchDB installé → /etc/systemd/system/synchdb-mock.service"
    info "Démarrer le mock : systemctl start synchdb-mock"
}

# ── Vérification ──────────────────────────────────────────────────────────────
verify_synchdb() {
    section "Vérification"
    sleep 3

    if curl -sf http://localhost:8080/health &>/dev/null; then
        local health
        health=$(curl -s http://localhost:8080/health | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))")
        info "SynchDB health : ${health}"
    else
        warn "SynchDB non accessible sur port 8080 — démarrer manuellement"
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║   SynchDB Oracle CDC Connector — Installation               ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    load_oracle_config
    install_java
    create_synchdb_structure
    download_synchdb
    write_synchdb_config
    install_systemd_service
    install_mock_server

    echo ""
    echo -e "${YELLOW}  Mode production : systemctl start synchdb${NC}"
    echo -e "${YELLOW}  Mode dev/test   : systemctl start synchdb-mock${NC}"
    echo ""

    if [[ "${MODE}" != "--standalone" ]]; then
        read -rp "  Démarrer en mode mock pour tests ? [y/n]: " start_mock
        if [[ "${start_mock}" == "y" ]]; then
            systemctl start synchdb-mock
            verify_synchdb
        fi
    fi

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   SynchDB installé avec succès                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    info "Voir la documentation : ${SYNCHDB_HOME}/docs/SYNCHDB.md"
    info "Logs : journalctl -u synchdb -f"
}

main "$@"
