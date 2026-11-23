#!/usr/bin/env bash
# =============================================================================
# Oracle Data Audit & Forensics Appliance
# Assistant de configuration initial — 10 étapes
# Usage : sudo bash setup-wizard.sh
# =============================================================================

set -euo pipefail

APPLIANCE_HOME="/opt/audit-appliance"
CONFIG_FILE="${APPLIANCE_HOME}/config/appliance.env"
SECRETS_FILE="${APPLIANCE_HOME}/config/.oracle_secrets"
VENV="${APPLIANCE_HOME}/venv"
APPLIANCE_USER="audit"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

[[ $EUID -ne 0 ]] && { echo "Exécuter en tant que root (sudo)"; exit 1; }

clear

# ── Utilitaires ───────────────────────────────────────────────────────────────
header() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}${BOLD}   Oracle Data Audit & Forensics Appliance — Setup Wizard    ${NC}${BLUE}║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

step() {
    local n="$1" total="$2" title="$3"
    echo ""
    echo -e "${CYAN}[ Étape ${n}/${total} ] ${BOLD}${title}${NC}"
    echo -e "${CYAN}$(printf '%.0s─' {1..62})${NC}"
}

prompt() {
    local label="$1" varname="$2" default="${3:-}"
    if [[ -n "${default}" ]]; then
        read -rp "  ${label} [${default}]: " "${varname}"
        [[ -z "${!varname}" ]] && eval "${varname}=${default}"
    else
        read -rp "  ${label}: " "${varname}"
    fi
}

prompt_secret() {
    local label="$1" varname="$2"
    read -rsp "  ${label}: " "${varname}"
    echo ""
}

prompt_yn() {
    local label="$1" varname="$2" default="${3:-n}"
    read -rp "  ${label} [y/n, défaut: ${default}]: " "${varname}"
    [[ -z "${!varname}" ]] && eval "${varname}=${default}"
}

info()  { echo -e "  ${GREEN}✓${NC} $*"; }
warn()  { echo -e "  ${YELLOW}⚠${NC}  $*"; }
error() { echo -e "  ${RED}✗${NC}  $*" >&2; exit 1; }

# ── Variables globales ────────────────────────────────────────────────────────
APPLIANCE_NAME=""
ORG_NAME=""
STATIC_IP=""
APPLIANCE_FQDN=""
ADMIN_USER=""
ADMIN_EMAIL=""
ADMIN_PASS=""
PG_HOST="localhost"
PG_PASS=""
ORA_HOST=""
ORA_PORT="1521"
ORA_SERVICE=""
ORA_USER=""
ORA_PASS=""
SYNCHDB_URL=""
POLL_MS="500"
HOT_DAYS="90"
WARM_DAYS="365"
COLD_DAYS="2555"
ALERT_EMAIL=""
SMTP_HOST=""
SMTP_PORT="587"
WEBHOOK_URL=""
TABLES=()
MASKED_COLS=()
BACKUP_DEST="local"
BACKUP_PATH="/mnt/backup"

# ── Étape 1 : Identité ────────────────────────────────────────────────────────
wizard_step1() {
    step 1 10 "Identité de l'appliance"
    prompt "Nom de l'appliance (ex: AUDIT-PROD-01)" APPLIANCE_NAME "AUDIT-PROD-01"
    prompt "Nom de l'organisation"                   ORG_NAME       "Organisation"
    info "Identité : ${APPLIANCE_NAME} / ${ORG_NAME}"
}

# ── Étape 2 : Réseau ──────────────────────────────────────────────────────────
wizard_step2() {
    step 2 10 "Configuration réseau"
    local detected_ip
    detected_ip=$(hostname -I | awk '{print $1}')
    prompt "Adresse IP (laisser vide pour DHCP)" STATIC_IP "${detected_ip}"
    prompt "FQDN ou nom d'hôte de l'appliance"   APPLIANCE_FQDN "audit.internal"

    if [[ -n "${APPLIANCE_FQDN}" ]]; then
        info "Regénération du certificat TLS pour : ${APPLIANCE_FQDN}"
        openssl req -x509 -newkey rsa:4096 \
            -keyout "${APPLIANCE_HOME}/ssl/key.pem" \
            -out    "${APPLIANCE_HOME}/ssl/cert.pem" \
            -days 3650 -nodes \
            -subj "/CN=${APPLIANCE_FQDN}/O=${ORG_NAME}/C=FR" 2>/dev/null
        chown "${APPLIANCE_USER}:${APPLIANCE_USER}" \
            "${APPLIANCE_HOME}/ssl/cert.pem" \
            "${APPLIANCE_HOME}/ssl/key.pem"
        chmod 600 "${APPLIANCE_HOME}/ssl/key.pem"
        systemctl reload nginx
        info "Certificat TLS regeneré"
    fi
}

# ── Étape 3 : Administrateur ──────────────────────────────────────────────────
wizard_step3() {
    step 3 10 "Compte administrateur"
    prompt "Nom d'utilisateur admin"  ADMIN_USER  "admin"
    prompt "Email administrateur"     ADMIN_EMAIL
    while true; do
        prompt_secret "Mot de passe (min 12 caractères)" ADMIN_PASS
        if [[ ${#ADMIN_PASS} -lt 12 ]]; then
            warn "Mot de passe trop court (minimum 12 caractères). Réessayer."
        else
            local confirm_pass=""
            prompt_secret "Confirmer le mot de passe" confirm_pass
            if [[ "${ADMIN_PASS}" == "${confirm_pass}" ]]; then
                break
            else
                warn "Les mots de passe ne correspondent pas. Réessayer."
            fi
        fi
    done
    info "Administrateur : ${ADMIN_USER} <${ADMIN_EMAIL}>"
}

# ── Étape 4 : PostgreSQL ──────────────────────────────────────────────────────
wizard_step4() {
    step 4 10 "Configuration PostgreSQL"
    prompt "Hôte PostgreSQL" PG_HOST "localhost"

    # Lire le mot de passe généré à l'installation
    if [[ -f "${APPLIANCE_HOME}/config/.pg_credentials" ]]; then
        source "${APPLIANCE_HOME}/config/.pg_credentials"
        info "Mot de passe PostgreSQL : chargé depuis l'installation"
    else
        prompt_secret "Mot de passe PostgreSQL (utilisateur 'audit')" PG_PASS
    fi
}

# ── Étape 5 : Oracle ──────────────────────────────────────────────────────────
wizard_step5() {
    step 5 10 "Connexion Oracle (source CDC)"
    echo "  Configuration de la connexion à la base Oracle à auditer."
    echo ""
    prompt "Hôte Oracle"           ORA_HOST
    prompt "Port Oracle"           ORA_PORT "1521"
    prompt "Service name Oracle"   ORA_SERVICE
    prompt "Utilisateur Oracle CDC" ORA_USER "audit_cdc"
    prompt_secret "Mot de passe Oracle CDC" ORA_PASS

    # Test de connectivité (si nc disponible)
    if command -v nc &>/dev/null && [[ -n "${ORA_HOST}" ]]; then
        if nc -z -w3 "${ORA_HOST}" "${ORA_PORT}" 2>/dev/null; then
            info "Connectivité Oracle ${ORA_HOST}:${ORA_PORT} : OK"
        else
            warn "Impossible de joindre ${ORA_HOST}:${ORA_PORT} — vérifier réseau/firewall"
        fi
    fi
}

# ── Étape 6 : CDC ─────────────────────────────────────────────────────────────
wizard_step6() {
    step 6 10 "Configuration CDC (SynchDB)"
    echo "  SynchDB est le connecteur CDC qui lit les REDO logs Oracle."
    echo ""
    prompt "URL SynchDB"               SYNCHDB_URL "http://synchdb-host:8080"
    prompt "Intervalle de poll (ms)"   POLL_MS     "500"
    prompt "Taille des batches"        BATCH_SIZE  "100"

    # Test de connectivité SynchDB
    if command -v curl &>/dev/null && [[ "${SYNCHDB_URL}" != "http://synchdb-host:8080" ]]; then
        if curl -sf "${SYNCHDB_URL}/health" &>/dev/null; then
            info "SynchDB accessible : ${SYNCHDB_URL}"
        else
            warn "SynchDB non accessible à ${SYNCHDB_URL} — configurer après le wizard"
        fi
    fi
}

# ── Étape 7 : Tables à auditer ────────────────────────────────────────────────
wizard_step7() {
    step 7 10 "Tables à auditer"
    echo "  Saisir les tables à inclure au format SCHEMA.TABLE"
    echo "  Laisser vide pour terminer."
    echo ""
    while true; do
        local tbl=""
        read -rp "  Table (ou Entrée pour terminer): " tbl
        [[ -z "${tbl}" ]] && break
        # Valider le format
        if [[ "${tbl}" =~ ^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            TABLES+=("${tbl}")
            info "Ajouté : ${tbl}"
        else
            warn "Format invalide. Utiliser SCHEMA.TABLE (ex: BANK.CUSTOMER)"
        fi
    done

    if [[ ${#TABLES[@]} -eq 0 ]]; then
        warn "Aucune table configurée — ajouter via l'interface Web après le wizard"
    else
        info "${#TABLES[@]} table(s) configurée(s)"
    fi
}

# ── Étape 8 : Colonnes sensibles ──────────────────────────────────────────────
wizard_step8() {
    step 8 10 "Colonnes sensibles (masquage)"
    echo "  Format : SCHEMA.TABLE.COLUMN=POLITIQUE"
    echo "  Politiques : FULL | PARTIAL | HASH | REDACT"
    echo "  Exemple  : BANK.CUSTOMER.CARD_NUMBER=PARTIAL"
    echo ""
    while true; do
        local mc=""
        read -rp "  Masquage (ou Entrée pour terminer): " mc
        [[ -z "${mc}" ]] && break
        if [[ "${mc}" =~ ^[A-Za-z_.]+=(FULL|PARTIAL|HASH|REDACT)$ ]]; then
            MASKED_COLS+=("${mc}")
            info "Masquage : ${mc}"
        else
            warn "Format invalide. Ex: BANK.CUSTOMER.CARD_NUMBER=PARTIAL"
        fi
    done
}

# ── Étape 9 : Rétention ───────────────────────────────────────────────────────
wizard_step9() {
    step 9 10 "Politique de rétention des données"
    echo ""
    echo "  Tier HOT  : PostgreSQL actif — recherche temps réel"
    echo "  Tier WARM : PostgreSQL partitions détachées — accès lent"
    echo "  Tier COLD : Archive Parquet/JSONL — accès hors ligne"
    echo ""
    prompt "Durée tier HOT  (jours)" HOT_DAYS  "90"
    prompt "Durée tier WARM (jours)" WARM_DAYS "365"
    prompt "Durée tier COLD (jours)" COLD_DAYS "2555"

    echo ""
    echo "  Stockage d'archivage :"
    echo "  1) Filesystem local (/var/lib/audit-appliance/archive)"
    echo "  2) NFS"
    echo "  3) S3 / MinIO"
    local archive_choice=""
    prompt "Choix (1/2/3)" archive_choice "1"

    case "${archive_choice}" in
        2)
            BACKUP_DEST="nfs"
            prompt "Chemin NFS monté" BACKUP_PATH "/mnt/archive"
            ;;
        3)
            BACKUP_DEST="s3"
            prompt "URL S3/MinIO (ex: http://minio:9000)" S3_ENDPOINT "http://minio:9000"
            prompt "Bucket S3"                             S3_BUCKET   "audit-archive"
            prompt "Access Key"                            S3_KEY
            prompt_secret "Secret Key"                     S3_SECRET
            ;;
        *)
            BACKUP_DEST="local"
            BACKUP_PATH="/var/lib/audit-appliance/archive"
            ;;
    esac
    info "Rétention : HOT=${HOT_DAYS}j / WARM=${WARM_DAYS}j / COLD=${COLD_DAYS}j"
}

# ── Étape 10 : Alertes ────────────────────────────────────────────────────────
wizard_step10() {
    step 10 10 "Configuration des alertes"
    echo ""
    prompt "Email de destination alertes"  ALERT_EMAIL
    prompt "Hôte SMTP"                     SMTP_HOST
    prompt "Port SMTP"                     SMTP_PORT "587"
    local smtp_user="" smtp_pass=""
    prompt        "Utilisateur SMTP (optionnel)" smtp_user ""
    prompt_secret "Mot de passe SMTP (optionnel)" smtp_pass

    echo ""
    prompt "URL Webhook (Teams/Slack/ntfy, optionnel)" WEBHOOK_URL ""

    info "Alertes configurées"
}

# ── Écriture de la configuration ──────────────────────────────────────────────
write_configuration() {
    section_print() { echo -e "\n${BLUE}══ $* ══${NC}"; }
    section_print "Génération de la configuration"

    # Lire le mot de passe PostgreSQL
    local pg_password="${PG_PASS:-}"
    if [[ -f "${APPLIANCE_HOME}/config/.pg_credentials" ]]; then
        source "${APPLIANCE_HOME}/config/.pg_credentials"
        pg_password="${PG_PASSWORD:-${pg_password}}"
    fi

    # Générer les secrets cryptographiques
    local jwt_secret
    jwt_secret=$(openssl rand -hex 64)
    local backup_key
    backup_key=$(openssl rand -base64 32)

    # Écrire le fichier de configuration principal
    cat > "${CONFIG_FILE}" << EOF
# =============================================================================
# Oracle Data Audit & Forensics Appliance — Configuration
# Généré le $(date -u +%FT%TZ) par setup-wizard.sh
# =============================================================================

# Identité
APPLIANCE_NAME=${APPLIANCE_NAME}
ORG_NAME=${ORG_NAME}
APPLIANCE_FQDN=${APPLIANCE_FQDN}
APPLIANCE_VERSION=1.0.0

# Base de données
DATABASE_URL=postgresql+asyncpg://audit:${pg_password}@${PG_HOST}/audit
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=10

# API
API_HOST=127.0.0.1
API_PORT=8000
API_WORKERS=2

# Authentification
JWT_SECRET=${jwt_secret}
JWT_EXPIRE_MINUTES=480
JWT_ALGORITHM=HS256
MFA_ENABLED=false

# CDC
CDC_ADAPTER=synchdb
SYNCHDB_URL=${SYNCHDB_URL}
CDC_POLL_INTERVAL_MS=${POLL_MS}
CDC_BATCH_SIZE=${BATCH_SIZE:-100}

# Oracle
ORACLE_HOST=${ORA_HOST}
ORACLE_PORT=${ORA_PORT}
ORACLE_SERVICE=${ORA_SERVICE}

# Rétention
RETENTION_HOT_DAYS=${HOT_DAYS}
RETENTION_WARM_DAYS=${WARM_DAYS}
RETENTION_COLD_DAYS=${COLD_DAYS}
RETENTION_MIN_RISK_KEEP=HIGH

# Archive
ARCHIVE_FORMAT=parquet
ARCHIVE_BACKEND=${BACKUP_DEST}
ARCHIVE_LOCAL_PATH=${BACKUP_PATH}
${BACKUP_DEST:+ARCHIVE_S3_ENDPOINT=${S3_ENDPOINT:-}}
${BACKUP_DEST:+ARCHIVE_S3_BUCKET=${S3_BUCKET:-}}
${BACKUP_DEST:+ARCHIVE_S3_ACCESS_KEY=${S3_KEY:-}}
${BACKUP_DEST:+ARCHIVE_S3_SECRET_KEY=${S3_SECRET:-}}

# Alertes email
ALERT_EMAIL_ENABLED=${ALERT_EMAIL:+true}
ALERT_EMAIL_ENABLED=${ALERT_EMAIL:-false}
ALERT_EMAIL_TO=${ALERT_EMAIL:-}
ALERT_EMAIL_FROM=audit-appliance@${APPLIANCE_FQDN}
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${smtp_user:-}
SMTP_TLS=true

# Webhook
ALERT_WEBHOOK_ENABLED=${WEBHOOK_URL:+true}
ALERT_WEBHOOK_ENABLED=${WEBHOOK_URL:-false}
ALERT_WEBHOOK_URL=${WEBHOOK_URL:-}

# Backup
BACKUP_DEST=${BACKUP_DEST}
BACKUP_LOCAL_PATH=${BACKUP_PATH}
BACKUP_ENCRYPT_KEY=${backup_key}

# Monitoring
DISK_ALERT_THRESHOLD_GB=20
DISK_CRITICAL_THRESHOLD_GB=5
CDC_LAG_ALERT_SECONDS=30
CDC_LAG_CRITICAL_SECONDS=300

# Logs
LOG_LEVEL=INFO
LOG_FORMAT=json

# Intégrité
INTEGRITY_CHECKPOINT_EVERY_N_EVENTS=1000
INTEGRITY_AUTO_VERIFY=true
INTEGRITY_VERIFY_INTERVAL_HOURS=6
EOF

    chmod 600 "${CONFIG_FILE}"
    chown "${APPLIANCE_USER}:${APPLIANCE_USER}" "${CONFIG_FILE}"

    # Secrets Oracle séparément
    cat > "${SECRETS_FILE}" << EOF
# Credentials Oracle — NE PAS PARTAGER
ORACLE_USER=${ORA_USER}
ORACLE_PASS=${ORA_PASS}
EOF
    chmod 600 "${SECRETS_FILE}"
    chown "${APPLIANCE_USER}:${APPLIANCE_USER}" "${SECRETS_FILE}"

    # Mot de passe SMTP si fourni
    if [[ -n "${smtp_pass:-}" ]]; then
        echo "SMTP_PASSWORD=${smtp_pass}" >> "${CONFIG_FILE}"
    fi

    info "Configuration écrite dans ${CONFIG_FILE}"

    # Enregistrer la clé de backup (CRITIQUE)
    echo "${backup_key}" > "${APPLIANCE_HOME}/config/.backup_key"
    chmod 600 "${APPLIANCE_HOME}/config/.backup_key"
    chown "${APPLIANCE_USER}:${APPLIANCE_USER}" "${APPLIANCE_HOME}/config/.backup_key"

    # Retourner la clé pour affichage
    BACKUP_KEY_DISPLAY="${backup_key}"
}

# ── Enregistrement des tables dans la base ────────────────────────────────────
configure_database_tables() {
    if [[ ${#TABLES[@]} -eq 0 ]]; then
        return
    fi

    info "Enregistrement des tables dans la base..."

    # Enregistrer la base Oracle
    PGPASSFILE="${APPLIANCE_HOME}/config/.pgpass" \
    sudo -u "${APPLIANCE_USER}" psql -h "${PG_HOST}" -d audit -c \
        "INSERT INTO audit_database (name, host, port, service_name, is_active)
         VALUES ('${ORA_SERVICE}', '${ORA_HOST}', ${ORA_PORT}, '${ORA_SERVICE}', TRUE)
         ON CONFLICT (name) DO UPDATE SET host = EXCLUDED.host, port = EXCLUDED.port;"

    # Enregistrer chaque table
    for tbl in "${TABLES[@]}"; do
        local schema="${tbl%%.*}"
        local table="${tbl##*.}"
        PGPASSFILE="${APPLIANCE_HOME}/config/.pgpass" \
        sudo -u "${APPLIANCE_USER}" psql -h "${PG_HOST}" -d audit -c \
            "INSERT INTO audit_table_config (database_id, schema_name, table_name, is_active)
             SELECT id, '${schema}', '${table}', TRUE FROM audit_database
             WHERE name = '${ORA_SERVICE}'
             ON CONFLICT (database_id, schema_name, table_name) DO NOTHING;"
        info "Table configurée : ${schema}.${table}"
    done
}

# ── Création de l'administrateur ──────────────────────────────────────────────
create_admin_user() {
    info "Création du compte administrateur..."
    source "${CONFIG_FILE}"

    sudo -u "${APPLIANCE_USER}" "${VENV}/bin/python3" << PYEOF
import asyncio, bcrypt, sys
sys.path.insert(0, '${APPLIANCE_HOME}/src')

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy import text

    engine = create_async_engine('${DATABASE_URL}', echo=False)
    async with AsyncSession(engine) as session:
        h = bcrypt.hashpw('${ADMIN_PASS}'.encode(), bcrypt.gensalt()).decode()
        await session.execute(text("""
            INSERT INTO appliance_user (username, email, full_name, role, password_hash)
            VALUES (:u, :e, :f, 'ADMIN', :h)
            ON CONFLICT (username) DO UPDATE
                SET password_hash = EXCLUDED.password_hash,
                    email         = EXCLUDED.email
        """), {'u': '${ADMIN_USER}', 'e': '${ADMIN_EMAIL}', 'f': 'Administrator', 'h': h})
        await session.commit()

asyncio.run(main())
PYEOF
    info "Administrateur créé : ${ADMIN_USER}"
}

# ── Démarrage des services ────────────────────────────────────────────────────
start_services() {
    info "Démarrage des services..."
    systemctl restart audit-api
    sleep 3
    systemctl restart audit-engine
    sleep 3

    if [[ -n "${SYNCHDB_URL}" ]] && [[ "${SYNCHDB_URL}" != "http://synchdb-host:8080" ]]; then
        systemctl start audit-cdc
        info "CDC démarré"
    else
        warn "CDC non démarré — configurer SYNCHDB_URL dans ${CONFIG_FILE} puis : systemctl start audit-cdc"
    fi

    # Activer les timers
    systemctl start audit-archive.timer audit-backup.timer \
                    audit-partition.timer audit-integrity.timer \
                    audit-idempotency-cleanup.timer
    info "Timers démarrés"
}

# ── Affichage du résumé ───────────────────────────────────────────────────────
print_final_summary() {
    local ip
    ip=$(hostname -I | awk '{print $1}')
    local url="https://${APPLIANCE_FQDN:-${ip}}"

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   Configuration terminée avec succès                        ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   Interface : ${url}                        ║${NC}"
    echo -e "${GREEN}║   Login    : ${ADMIN_USER}                                             ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║   ⚠  CLÉ DE CHIFFREMENT BACKUP (sauvegarder en lieu sûr)   ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${YELLOW}║   ${BACKUP_KEY_DISPLAY:0:50}  ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   Sans cette clé, les backups ne peuvent pas être restaurés ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║   Documentation : ${APPLIANCE_HOME}/docs/                       ║${NC}"
    echo -e "${GREEN}║   Statut       : make status                                ║${NC}"
    echo -e "${GREEN}║   Logs         : make logs                                  ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    header
    echo "  Cet assistant configure l'appliance en 10 étapes."
    echo "  Durée estimée : 5 minutes."
    echo ""
    read -rp "  Appuyer sur Entrée pour commencer..." _

    wizard_step1
    wizard_step2
    wizard_step3
    wizard_step4
    wizard_step5
    wizard_step6
    wizard_step7
    wizard_step8
    wizard_step9
    wizard_step10

    echo ""
    echo -e "${BLUE}══ Application de la configuration ══${NC}"
    write_configuration
    configure_database_tables
    create_admin_user
    start_services
    print_final_summary
}

main "$@"
