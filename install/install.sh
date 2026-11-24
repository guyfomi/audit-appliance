#!/usr/bin/env bash
# =============================================================================
# Oracle Data Audit & Forensics Appliance v1.0.0
# Script d'installation — Ubuntu 22.04 / 24.04 LTS
# Usage : sudo bash install.sh
# =============================================================================

set -euo pipefail

APPLIANCE_VERSION="1.0.0"
APPLIANCE_HOME="/opt/audit-appliance"
APPLIANCE_USER="audit"
APPLIANCE_GROUP="audit"
PG_VERSION="16"
PYTHON_VERSION="3.12"

# Couleurs
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${BLUE}══ $* ══${NC}"; }

# ── Vérifications préalables ──────────────────────────────────────────────────
check_requirements() {
    section "Vérification des prérequis"
    [[ $EUID -ne 0 ]] && error "Ce script doit être exécuté en tant que root (sudo)"

    # OS
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        if [[ "${ID}" != "ubuntu" ]]; then
            warn "OS non testé : ${PRETTY_NAME}. Continuation..."
        else
            info "OS : ${PRETTY_NAME}"
        fi
    fi

    # Architecture
    [[ $(uname -m) != "x86_64" ]] && error "Seul x86_64 est supporté"

    # RAM
    local mem_kb
    mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local mem_gb=$(( mem_kb / 1024 / 1024 ))
    if [[ ${mem_kb} -lt 3900000 ]]; then
        warn "RAM insuffisante : ${mem_gb} GB (minimum recommandé : 4 GB)"
    else
        info "RAM : ${mem_gb} GB"
    fi

    # Disque
    local disk_avail_kb
    disk_avail_kb=$(df / --output=avail | tail -1)
    local disk_avail_gb=$(( disk_avail_kb / 1024 / 1024 ))
    if [[ ${disk_avail_kb} -lt 20000000 ]]; then
        error "Espace disque insuffisant : ${disk_avail_gb} GB (minimum : 20 GB)"
    fi
    info "Disque libre : ${disk_avail_gb} GB"

    info "Prérequis vérifiés"
}

# ── Paquets système ───────────────────────────────────────────────────────────
install_system_packages() {
    section "Installation des paquets système"
    export DEBIAN_FRONTEND=noninteractive

    apt-get update -qq

    sudo apt install software-properties-common -y

    # 2. Add deadsnakes PPA
    sudo add-apt-repository ppa:deadsnakes/ppa -y

    # 3. Update package list
    sudo apt update

    # PostgreSQL 16
    if ! command -v psql &>/dev/null || [[ $(psql --version | grep -oP '\d+' | head -1) -lt 16 ]]; then
        info "Ajout du dépôt PostgreSQL 16..."
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
        echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            > /etc/apt/sources.list.d/pgdg.list
        apt-get update -qq
    fi

    apt-get install -y --no-install-recommends \
        "postgresql-${PG_VERSION}" \
        "postgresql-client-${PG_VERSION}" \
        "postgresql-${PG_VERSION}-partman" \
        python3.12 python3.12-venv python3.12-dev \
        libpq-dev libssl-dev libffi-dev \
        nginx \
        openssl curl wget git \
        build-essential \
        rsync jq bc \
        awscli \
        netcat-openbsd \
        psmisc \
        htop \
        2>&1 | grep -v "^Get\|^Fetched\|^Reading\|^Building\|^Selecting"

    info "Paquets système installés"
}

# ── Utilisateur système ───────────────────────────────────────────────────────
create_system_user() {
    section "Création de l'utilisateur système"
    if ! id "${APPLIANCE_USER}" &>/dev/null; then
        useradd \
            --system \
            --create-home \
            --home-dir "${APPLIANCE_HOME}" \
            --shell /bin/bash \
            --comment "Oracle Audit Appliance" \
            "${APPLIANCE_USER}"
        info "Utilisateur '${APPLIANCE_USER}' créé"
    else
        info "Utilisateur '${APPLIANCE_USER}' existe déjà"
    fi

    # Répertoires de données
    mkdir -p \
        "${APPLIANCE_HOME}/src" \
        "${APPLIANCE_HOME}/config" \
        "${APPLIANCE_HOME}/ssl" \
        "${APPLIANCE_HOME}/ui/dist" \
        "${APPLIANCE_HOME}/logs" \
        "${APPLIANCE_HOME}/bin" \
        /var/lib/audit-appliance/{archive,checkpoints,backup-work,pg_archive}

    chown -R "${APPLIANCE_USER}:${APPLIANCE_GROUP}" \
        "${APPLIANCE_HOME}" \
        /var/lib/audit-appliance

    chmod 750 "${APPLIANCE_HOME}/config"
}

# ── Environnement Python ──────────────────────────────────────────────────────
setup_python_env() {
    section "Configuration de l'environnement Python"
    local venv="${APPLIANCE_HOME}/venv"

    if [[ ! -d "${venv}" ]]; then
        sudo -u "${APPLIANCE_USER}" python3.12 -m venv "${venv}"
        info "Virtualenv créé dans ${venv}"
    fi

    info "Installation des dépendances Python..."
    sudo -u "${APPLIANCE_USER}" "${venv}/bin/pip" install \
        --upgrade pip wheel --quiet

    sudo -u "${APPLIANCE_USER}" "${venv}/bin/pip" install \
        "fastapi==0.111.0" \
        "uvicorn[standard]==0.30.0" \
        "sqlalchemy[asyncio]==2.0.30" \
        "asyncpg==0.29.0" \
        "psycopg2-binary==2.9.9" \
        "alembic==1.13.1" \
        "pydantic==2.7.1" \
        "pydantic-settings==2.3.0" \
        "python-multipart==0.0.9" \
        "python-jose[cryptography]==3.3.0" \
        "passlib[bcrypt]==1.7.4" \
        "bcrypt==4.1.3" \
        "pyotp==2.9.0" \
        "qrcode[pil]==7.4.2" \
        "httpx==0.27.0" \
        "aioboto3==13.0.0" \
        "pyarrow==16.0.0" \
        "pandas==2.2.2" \
        "prometheus-client==0.20.0" \
        "psutil==5.9.8" \
        "slowapi==0.1.9" \
        --quiet

    info "Dépendances Python installées"
}

# ── PostgreSQL ────────────────────────────────────────────────────────────────
configure_postgresql() {
    section "Configuration de PostgreSQL ${PG_VERSION}"
    local pg_conf="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
    local hba_conf="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
    local pg_data="/var/lib/postgresql/${PG_VERSION}/main"

    # Démarrer PostgreSQL pour la configuration initiale
    systemctl start postgresql
    sleep 3

    # Tuning performance pour la charge d'audit
    cat >> "${pg_conf}" << 'PGCONF'

# ── Oracle Audit Appliance tuning ────────────────────────────────────────────
max_connections              = 100
shared_buffers               = 512MB
effective_cache_size         = 2GB
work_mem                     = 16MB
maintenance_work_mem         = 256MB
random_page_cost             = 1.1
effective_io_concurrency     = 200

# WAL et checkpoint
wal_level                    = replica
archive_mode                 = on
archive_command              = 'cp %p /var/lib/audit-appliance/pg_archive/%f'
max_wal_size                 = 2GB
min_wal_size                 = 512MB
checkpoint_completion_target = 0.9
wal_buffers                  = 64MB

# Logging
log_min_duration_statement   = 1000
log_line_prefix              = '%t [%p]: [%l-1] '
log_lock_waits               = on
log_temp_files               = 0
log_autovacuum_min_duration  = 0

# Partitionnement
enable_partition_pruning     = on
constraint_exclusion         = partition

# Autovacuum agressif pour audit_event
autovacuum_vacuum_scale_factor  = 0.01
autovacuum_analyze_scale_factor = 0.005
PGCONF

    # Configuration pg_hba (authentification)
    cat > "${hba_conf}" << 'PGCONF'
# TYPE  DATABASE    USER            ADDRESS         METHOD
local   all         postgres                        peer
local   audit       audit                           peer
host    audit       audit           127.0.0.1/32    scram-sha-256
host    audit       audit           ::1/128         scram-sha-256
host    audit       audit_backup    127.0.0.1/32    scram-sha-256
PGCONF

    systemctl restart postgresql
    sleep 3

    # Générer un mot de passe PostgreSQL aléatoire
    local pg_password
    pg_password=$(openssl rand -hex 32)

    # Créer la base et l'utilisateur
    sudo -u postgres psql << PSQL
-- Créer l'utilisateur applicatif
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit') THEN
        CREATE USER audit WITH PASSWORD '${pg_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    ELSE
        ALTER USER audit WITH PASSWORD '${pg_password}';
    END IF;
END \$\$;

-- Créer la base de données
SELECT 'CREATE DATABASE audit OWNER audit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'audit') \gexec

GRANT ALL PRIVILEGES ON DATABASE audit TO audit;

-- Utilisateur de backup (replication)
DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_backup') THEN
        CREATE USER audit_backup WITH REPLICATION;
    END IF;
END \$\$;
PSQL

    # Écrire le fichier .pgpass
    echo "localhost:5432:audit:audit:${pg_password}" \
        > /opt/audit-appliance/config/.pgpass
    echo "localhost:5432:audit:audit_backup:" \
        >> /opt/audit-appliance/config/.pgpass
    chmod 600 /opt/audit-appliance/config/.pgpass
    chown "${APPLIANCE_USER}:${APPLIANCE_GROUP}" \
        /opt/audit-appliance/config/.pgpass

    # Écrire l'URL de connexion dans le template de configuration
    echo "PG_PASSWORD=${pg_password}" \
        >> /opt/audit-appliance/config/.pg_credentials
    chmod 600 /opt/audit-appliance/config/.pg_credentials
    chown "${APPLIANCE_USER}:${APPLIANCE_GROUP}" \
        /opt/audit-appliance/config/.pg_credentials

    info "PostgreSQL ${PG_VERSION} configuré (mot de passe généré automatiquement)"
}

# ── Schéma de base de données ─────────────────────────────────────────────────
run_migrations() {
    section "Création du schéma de base de données"

    sudo -E -u "${APPLIANCE_USER}" PGPASSFILE=/opt/audit-appliance/config/.pgpass psql \
        -h localhost -d audit \
        -f "${APPLIANCE_HOME}/src/db/migrations/001_initial_schema.sql" \
        --quiet

    info "Schéma créé"
}

# ── Nginx ─────────────────────────────────────────────────────────────────────
configure_nginx() {
    section "Configuration de Nginx"
    local ssl_dir="${APPLIANCE_HOME}/ssl"

    # Certificat auto-signé (10 ans — remplacé par le wizard si FQDN fourni)
    if [[ ! -f "${ssl_dir}/cert.pem" ]]; then
        openssl req -x509 \
            -newkey rsa:4096 \
            -keyout "${ssl_dir}/key.pem" \
            -out    "${ssl_dir}/cert.pem" \
            -days   3650 \
            -nodes \
            -subj "/CN=audit-appliance/O=Audit Appliance/C=FR/ST=IDF/L=Paris" \
            2>/dev/null
        chown "${APPLIANCE_USER}:${APPLIANCE_GROUP}" \
            "${ssl_dir}/cert.pem" "${ssl_dir}/key.pem"
        chmod 600 "${ssl_dir}/key.pem"
        info "Certificat TLS auto-signé généré (10 ans)"
    fi

    # Vhost Nginx
    cp "${APPLIANCE_HOME}/nginx/audit-appliance.conf" \
       /etc/nginx/sites-available/audit-appliance

    ln -sf /etc/nginx/sites-available/audit-appliance \
           /etc/nginx/sites-enabled/audit-appliance
    rm -f /etc/nginx/sites-enabled/default

    # Tester la configuration
    nginx -t || error "Configuration Nginx invalide"

    systemctl enable nginx
    systemctl restart nginx
    info "Nginx configuré et démarré"
}

# ── Services systemd ──────────────────────────────────────────────────────────
install_systemd_services() {
    section "Installation des services systemd"

    local services=(
        "audit-engine.service"
        "audit-api.service"
        "audit-cdc.service"
        "audit-archive.service"
    )

    local timers=(
        "audit-archive.timer"
        "audit-backup.timer"
        "audit-partition.timer"
        "audit-integrity.timer"
        "audit-idempotency-cleanup.timer"
    )

    # Générer les fichiers timer à partir du template
    local timer_configs=(
        "audit-archive.timer|*-*-* 02:00:00"
        "audit-backup.timer|*-*-* 01:00:00"
        "audit-partition.timer|Mon *-*-* 00:30:00"
        "audit-integrity.timer|*-*-* 00,06,12,18:00:00"
        "audit-idempotency-cleanup.timer|Sun *-*-* 03:00:00"
    )

    for config in "${timer_configs[@]}"; do
        IFS='|' read -r timer_name calendar <<< "${config}"
        local service_name="${timer_name%.timer}.service"
        local desc="${timer_name%.timer} scheduled task"

        cat > "/etc/systemd/system/${timer_name}" << EOF
[Unit]
Description=Oracle Data Audit — ${desc}

[Timer]
OnCalendar=${calendar}
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF
        info "Timer créé : ${timer_name} (${calendar})"
    done

    # Copier les services
    for svc in "${services[@]}"; do
        if [[ -f "${APPLIANCE_HOME}/systemd/${svc}" ]]; then
            cp "${APPLIANCE_HOME}/systemd/${svc}" "/etc/systemd/system/${svc}"
            info "Service installé : ${svc}"
        fi
    done

    systemctl daemon-reload

    # Activer les services au démarrage
    systemctl enable audit-api audit-engine
    # audit-cdc activé manuellement après configuration Oracle
    # systemctl enable audit-cdc

    # Activer les timers
    for timer in "${timers[@]}"; do
        systemctl enable "${timer}"
    done

    # Démarrer les services de base
    systemctl start audit-engine
    sleep 3
    systemctl start audit-api

    info "Services systemd installés et démarrés"
}

# ── Configuration des logs ────────────────────────────────────────────────────
configure_logging() {
    section "Configuration des logs"

    # Rotation des logs journald
    mkdir -p /etc/systemd/journald.conf.d
    cat > /etc/systemd/journald.conf.d/audit-appliance.conf << 'EOF'
[Journal]
SystemMaxUse=500M
MaxRetentionSec=2592000
Compress=yes
EOF

    # Logrotate pour les logs Nginx
    cat > /etc/logrotate.d/audit-appliance-nginx << 'EOF'
/var/log/nginx/audit-appliance-*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    sharedscripts
    postrotate
        nginx -s reopen 2>/dev/null || true
    endscript
}
EOF

    systemctl restart systemd-journald
    info "Logging configuré"
}

# ── Hardening sécurité ────────────────────────────────────────────────────────
configure_security() {
    section "Durcissement sécurité"

    # Désactiver les modules nginx inutiles
    # (déjà fait par la config nginx)

    # Limites système pour l'utilisateur audit
    cat >> /etc/security/limits.conf << 'EOF'
audit soft nofile 65536
audit hard nofile 65536
audit soft nproc  4096
audit hard nproc  4096
EOF

    # Désactiver l'accès SSH pour l'utilisateur audit (si souhaité)
    # echo "DenyUsers audit" >> /etc/ssh/sshd_config

    # Firewall UFW (optionnel)
    if command -v ufw &>/dev/null; then
        ufw --force enable
        ufw allow 443/tcp comment "Audit Appliance HTTPS"
        ufw allow 22/tcp  comment "SSH admin"
        ufw deny  80/tcp  comment "HTTP redirect only via nginx"
        info "Firewall UFW configuré (SSH + HTTPS)"
    else
        warn "UFW non disponible — configurer le firewall manuellement"
    fi

    info "Sécurité configurée"
}

# ── Vérification finale ───────────────────────────────────────────────────────
verify_installation() {
    section "Vérification de l'installation"
    local errors=0

    check_service() {
        if systemctl is-active --quiet "$1"; then
            info "✓ Service actif : $1"
        else
            warn "✗ Service inactif : $1"
            ((errors++))
        fi
    }

    check_port() {
        if ss -tlnp | grep -q ":$1 "; then
            info "✓ Port $1 ouvert"
        else
            warn "✗ Port $1 non disponible"
            ((errors++))
        fi
    }

    check_service postgresql
    check_service nginx
    check_service audit-api
    check_service audit-engine

    check_port 443
    check_port 8000

    # Test API
    sleep 2
    local health
    health=$(curl -sk https://localhost/api/v1/health 2>/dev/null | python3 -c \
        "import sys,json; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null || echo "unreachable")
    if [[ "${health}" == "ok" ]]; then
        info "✓ API health check : OK"
    else
        warn "✗ API health check : ${health}"
        ((errors++))
    fi

    if [[ ${errors} -eq 0 ]]; then
        info "Installation réussie — aucune erreur"
    else
        warn "Installation terminée avec ${errors} avertissement(s)"
    fi
}

# ── Résumé ────────────────────────────────────────────────────────────────────
print_summary() {
    local ip
    ip=$(hostname -I | awk '{print $1}')

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   Oracle Data Audit & Forensics Appliance v${APPLIANCE_VERSION}            ║${NC}"
    echo -e "${GREEN}║   Installation terminée                                      ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   Prochaine étape : lancer l'assistant de configuration      ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   sudo bash ${APPLIANCE_HOME}/install/setup-wizard.sh           ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   Interface provisoire : https://${ip}             ║${NC}"
    echo -e "${GREEN}║   (certificat auto-signé — accepter l'exception)            ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║   Oracle Data Audit & Forensics Appliance                   ║${NC}"
    echo -e "${BLUE}║   Installation v${APPLIANCE_VERSION} — $(date +%Y-%m-%d)                      ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    check_requirements
    install_system_packages
    create_system_user
    setup_python_env
    configure_postgresql
    run_migrations
    configure_nginx
    install_systemd_services
    configure_logging
    configure_security
    verify_installation
    print_summary
}

main "$@"
