#!/usr/bin/env bash
# =============================================================================
# Oracle Data Audit & Forensics Appliance
# Script de restauration complète
# Usage : sudo bash appliance-restore.sh --source <path|s3://...> --key <clé>
# =============================================================================

set -euo pipefail

APPLIANCE_HOME="/opt/audit-appliance"
RESTORE_WORK="/var/lib/audit-appliance/restore-work"
PG_VERSION="16"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

log() {
    local level="$1" msg="$2"
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"${level}\",\"component\":\"restore\",\"message\":\"${msg}\"}"
}
info()  { log "INFO"  "$*"; echo -e "  ${GREEN}[INFO]${NC} $*"; }
warn()  { log "WARN"  "$*"; echo -e "  ${YELLOW}[WARN]${NC} $*" >&2; }
fail()  { log "ERROR" "$*"; echo -e "  ${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${BLUE}══ $* ══${NC}"; }

# ── Arguments ─────────────────────────────────────────────────────────────────
BACKUP_SOURCE=""
ENCRYPT_KEY=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source|-s) BACKUP_SOURCE="$2"; shift 2 ;;
        --key|-k)    ENCRYPT_KEY="$2";   shift 2 ;;
        --help|-h)
            echo "Usage: $0 --source <path|s3://bucket/prefix> --key <encrypt_key>"
            exit 0 ;;
        *) fail "Argument inconnu : $1" ;;
    esac
done

[[ -z "${BACKUP_SOURCE}" ]] && fail "--source est requis"
[[ -z "${ENCRYPT_KEY}" ]]   && fail "--key est requis"
[[ $EUID -ne 0 ]] && fail "Exécuter en tant que root (sudo)"

# ── Affichage du plan ─────────────────────────────────────────────────────────
print_plan() {
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                 ⚠  RESTAURATION COMPLÈTE  ⚠                 ║${NC}"
    echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║  Source   : ${BACKUP_SOURCE:0:50}  ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║  Cette opération va :                                        ║${NC}"
    echo -e "${RED}║  1. Arrêter tous les services                                ║${NC}"
    echo -e "${RED}║  2. EFFACER le répertoire de données PostgreSQL              ║${NC}"
    echo -e "${RED}║  3. Restaurer depuis le backup                               ║${NC}"
    echo -e "${RED}║  4. Redémarrer les services                                  ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║  Les données actuelles seront PERDUES.                       ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    read -rp "  Taper 'RESTAURER' pour confirmer (ou Ctrl+C pour annuler) : " confirm
    [[ "${confirm}" != "RESTAURER" ]] && { info "Restauration annulée"; exit 0; }
}

# ── Étape 1 : Téléchargement ──────────────────────────────────────────────────
fetch_backup() {
    step "Étape 1/8 : Téléchargement du backup"
    mkdir -p "${RESTORE_WORK}"

    if [[ "${BACKUP_SOURCE}" == s3://* ]]; then
        info "Téléchargement depuis S3 : ${BACKUP_SOURCE}"
        # Charger les credentials S3 si disponibles
        [[ -f "${APPLIANCE_HOME}/config/appliance.env" ]] \
            && source "${APPLIANCE_HOME}/config/appliance.env"
        AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}" \
        AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}" \
        aws s3 sync \
            --endpoint-url "${BACKUP_S3_ENDPOINT:-}" \
            "${BACKUP_SOURCE}" \
            "${RESTORE_WORK}/"
    else
        info "Copie depuis : ${BACKUP_SOURCE}"
        rsync -av "${BACKUP_SOURCE}/" "${RESTORE_WORK}/"
    fi
    info "Backup récupéré dans ${RESTORE_WORK}"
}

# ── Étape 2 : Vérification ────────────────────────────────────────────────────
verify_backup() {
    step "Étape 2/8 : Vérification de l'intégrité"
    local pg_dir="${RESTORE_WORK}/postgresql"

    [[ -d "${pg_dir}" ]] || fail "Répertoire postgresql/ introuvable dans le backup"
    [[ -f "${pg_dir}/SHA256SUMS" ]] || fail "Fichier SHA256SUMS manquant"

    if ! sha256sum --check "${pg_dir}/SHA256SUMS" --quiet 2>/dev/null; then
        fail "Vérification SHA256 échouée — backup corrompu"
    fi

    # Vérifier le fichier de configuration chiffré
    local enc_file
    enc_file=$(ls "${RESTORE_WORK}"/config_*.enc 2>/dev/null | head -1)
    [[ -z "${enc_file}" ]] && fail "Fichier de configuration chiffré introuvable"

    # Test de déchiffrement
    if ! openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -d \
        -pass "pass:${ENCRYPT_KEY}" \
        -in "${enc_file}" \
        -out /dev/null 2>/dev/null; then
        fail "Déchiffrement échoué — clé incorrecte ou fichier corrompu"
    fi

    info "Intégrité vérifiée — backup valide"
}

# ── Étape 3 : Arrêt des services ─────────────────────────────────────────────
stop_services() {
    step "Étape 3/8 : Arrêt des services"
    local services=("audit-cdc" "audit-engine" "audit-api")
    for svc in "${services[@]}"; do
        if systemctl is-active --quiet "${svc}" 2>/dev/null; then
            systemctl stop "${svc}"
            info "Service arrêté : ${svc}"
        fi
    done
    sleep 3
    info "Services applicatifs arrêtés"
}

# ── Étape 4 : Restauration PostgreSQL ────────────────────────────────────────
restore_postgresql() {
    step "Étape 4/8 : Restauration PostgreSQL"

    # Arrêter PostgreSQL
    systemctl stop postgresql
    sleep 2

    # Identifier le répertoire de données
    local pg_data="/var/lib/postgresql/${PG_VERSION}/main"
    local pg_sys_user="postgres"

    # Sauvegarde de sécurité
    if [[ -d "${pg_data}" ]]; then
        local backup_dir="${pg_data}.pre-restore.$(date +%s)"
        mv "${pg_data}" "${backup_dir}"
        info "Ancienne data directory sauvegardée dans ${backup_dir}"
    fi

    mkdir -p "${pg_data}"
    chown "${pg_sys_user}:${pg_sys_user}" "${pg_data}"
    chmod 700 "${pg_data}"

    # Restaurer base.tar.gz
    local pg_src="${RESTORE_WORK}/postgresql"
    info "Extraction de base.tar.gz..."
    sudo -u "${pg_sys_user}" tar -xzf "${pg_src}/base.tar.gz" -C "${pg_data}/"

    # Restaurer WAL si disponible
    if [[ -f "${pg_src}/pg_wal.tar.gz" ]]; then
        info "Extraction des WAL..."
        sudo -u "${pg_sys_user}" tar -xzf "${pg_src}/pg_wal.tar.gz" \
            -C "${pg_data}/pg_wal/"
    fi

    chown -R "${pg_sys_user}:${pg_sys_user}" "${pg_data}"

    # Démarrer PostgreSQL
    systemctl start postgresql

    # Attendre que PostgreSQL soit prêt
    local retries=30
    info "Attente de PostgreSQL..."
    while ! pg_isready -q -h localhost 2>/dev/null && [[ ${retries} -gt 0 ]]; do
        sleep 2; retries=$((retries - 1))
    done
    [[ ${retries} -eq 0 ]] && fail "PostgreSQL n'a pas démarré dans les délais"
    info "PostgreSQL restauré et démarré"
}

# ── Étape 5 : Restauration configuration ─────────────────────────────────────
restore_configuration() {
    step "Étape 5/8 : Restauration de la configuration"

    local enc_file
    enc_file=$(ls "${RESTORE_WORK}"/config_*.enc | head -1)
    local plain_cfg="${RESTORE_WORK}/config_plain.json"

    # Déchiffrer
    openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -d \
        -pass "pass:${ENCRYPT_KEY}" \
        -in  "${enc_file}" \
        -out "${plain_cfg}"

    info "Configuration déchiffrée"

    # Restaurer les fichiers de configuration système
    if [[ -f "${RESTORE_WORK}/appliance.env" ]]; then
        cp "${RESTORE_WORK}/appliance.env" \
           "${APPLIANCE_HOME}/config/appliance.env"
        chmod 600 "${APPLIANCE_HOME}/config/appliance.env"
        info "Configuration appliance restaurée"
    fi

    shred -u "${plain_cfg}"
    info "Configuration restaurée"
}

# ── Étape 6 : Redémarrage des services ───────────────────────────────────────
start_services() {
    step "Étape 6/8 : Redémarrage des services"
    systemctl start audit-engine
    sleep 5
    systemctl start audit-api
    sleep 3
    info "Services redémarrés"
}

# ── Étape 7 : Démarrage CDC ───────────────────────────────────────────────────
start_cdc() {
    step "Étape 7/8 : Démarrage du CDC"
    # Le CDC reprendra automatiquement depuis le dernier SCN connu
    if systemctl is-enabled --quiet audit-cdc 2>/dev/null; then
        systemctl start audit-cdc
        info "CDC démarré — reprise depuis le dernier checkpoint"
    else
        warn "Service audit-cdc non activé — démarrer manuellement après vérification"
    fi
}

# ── Étape 8 : Vérification post-restauration ─────────────────────────────────
post_restore_check() {
    step "Étape 8/8 : Vérification post-restauration"
    sleep 5

    # Health check API
    local retries=15
    local health="unknown"
    while [[ ${retries} -gt 0 ]]; do
        health=$(curl -sk https://localhost/api/v1/health 2>/dev/null \
            | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','error'))" \
            2>/dev/null || echo "unreachable")
        [[ "${health}" == "ok" ]] && break
        sleep 2; retries=$((retries - 1))
    done

    if [[ "${health}" == "ok" ]]; then
        info "API health check : OK"
    else
        warn "API health check : ${health} — vérifier manuellement"
    fi

    # Compter les événements
    local event_count
    event_count=$(PGPASSFILE="${APPLIANCE_HOME}/config/.pgpass" \
        psql -h localhost -U audit -d audit -t \
        -c "SELECT COUNT(*) FROM audit_event" 2>/dev/null | xargs || echo "N/A")
    info "Événements d'audit restaurés : ${event_count}"
}

# ── Nettoyage ─────────────────────────────────────────────────────────────────
cleanup() {
    rm -rf "${RESTORE_WORK}"
    info "Répertoire de travail nettoyé"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    info "=== Restauration Oracle Data Audit Appliance ==="

    print_plan
    fetch_backup
    verify_backup
    stop_services
    restore_postgresql
    restore_configuration
    start_services
    start_cdc
    post_restore_check
    cleanup

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✓  Restauration terminée avec succès                      ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   Interface : https://$(hostname -I | awk '{print $1}')                       ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

main "$@"
