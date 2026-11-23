#!/usr/bin/env bash
# =============================================================================
# Oracle Data Audit & Forensics Appliance
# Script de backup — PostgreSQL + Configuration
# Usage : sudo bash appliance-backup.sh [--dest local|nfs|s3]
# =============================================================================

set -euo pipefail

APPLIANCE_HOME="/opt/audit-appliance"
BACKUP_WORK_DIR="/var/lib/audit-appliance/backup-work"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_COMPONENT="backup"

# Chargement de la configuration
[[ -f "${APPLIANCE_HOME}/config/appliance.env" ]] \
    && source "${APPLIANCE_HOME}/config/appliance.env" \
    || { echo "Configuration introuvable"; exit 1; }

# Surcharge éventuelle de la destination
[[ "${1:-}" == "--dest" ]] && BACKUP_DEST="${2}"

# ── Logging structuré JSON ────────────────────────────────────────────────────
log() {
    local level="$1" msg="$2"
    echo "{\"timestamp\":\"$(date -u +%FT%TZ)\",\"level\":\"${level}\",\"component\":\"${LOG_COMPONENT}\",\"message\":\"${msg}\"}"
}
info()  { log "INFO"  "$*"; }
warn()  { log "WARN"  "$*" >&2; }
fail()  { log "ERROR" "$*" >&2; exit 1; }

# ── Prérequis ─────────────────────────────────────────────────────────────────
check_prereqs() {
    command -v pg_basebackup &>/dev/null || fail "pg_basebackup non trouvé"
    command -v openssl       &>/dev/null || fail "openssl non trouvé"
    [[ -n "${BACKUP_ENCRYPT_KEY:-}" ]]   || fail "BACKUP_ENCRYPT_KEY non défini"
    [[ -n "${BACKUP_API_TOKEN:-}" ]]     || fail "BACKUP_API_TOKEN non défini"
}

# ── Répertoire de travail ─────────────────────────────────────────────────────
init_work_dir() {
    mkdir -p "${BACKUP_WORK_DIR}/${TIMESTAMP}"
    WORK="${BACKUP_WORK_DIR}/${TIMESTAMP}"
    info "Répertoire de travail : ${WORK}"
}

# ── 1. Backup PostgreSQL ──────────────────────────────────────────────────────
backup_postgresql() {
    info "Démarrage du backup PostgreSQL..."
    local dest="${WORK}/postgresql"
    mkdir -p "${dest}"

    PGPASSFILE="${APPLIANCE_HOME}/config/.pgpass" \
    pg_basebackup \
        --host=localhost \
        --port=5432 \
        --username=audit_backup \
        --pgdata="${dest}" \
        --format=tar \
        --gzip \
        --compress=9 \
        --checkpoint=fast \
        --wal-method=stream \
        --progress \
        --verbose \
        2>&1 | while IFS= read -r line; do
            info "pg_basebackup: ${line}"
        done

    # Générer les hashs de vérification
    (cd "${dest}" && sha256sum ./*.tar.gz > SHA256SUMS)

    local size_mb
    size_mb=$(du -sm "${dest}" | cut -f1)
    info "Backup PostgreSQL terminé : ${size_mb} MB"
}

# ── 2. Backup configuration ───────────────────────────────────────────────────
backup_configuration() {
    info "Backup de la configuration..."
    local tmp_cfg="${WORK}/config_plain_${TIMESTAMP}.json"
    local enc_cfg="${WORK}/config_${TIMESTAMP}.enc"

    # Export via l'API
    if ! curl -sf \
        -H "Authorization: Bearer ${BACKUP_API_TOKEN}" \
        "https://localhost/api/v1/admin/config/export" \
        --insecure \
        -o "${tmp_cfg}" 2>/dev/null; then
        warn "Export API échoué — tentative directe PostgreSQL..."
        # Fallback : export direct PostgreSQL
        PGPASSFILE="${APPLIANCE_HOME}/config/.pgpass" \
        psql -h localhost -U audit -d audit -c \
            "SELECT row_to_json(row(
                (SELECT json_agg(row_to_json(t)) FROM audit_database t),
                (SELECT json_agg(row_to_json(t)) FROM audit_table_config t),
                (SELECT json_agg(row_to_json(t)) FROM audit_rule t)
             ))" -t > "${tmp_cfg}"
    fi

    # Chiffrement AES-256-CBC avec PBKDF2 (600 000 itérations)
    openssl enc -aes-256-cbc -pbkdf2 -iter 600000 \
        -pass "pass:${BACKUP_ENCRYPT_KEY}" \
        -in  "${tmp_cfg}" \
        -out "${enc_cfg}"

    # Supprimer la version en clair
    shred -u "${tmp_cfg}"

    # Hash de vérification
    sha256sum "${enc_cfg}" > "${enc_cfg}.sha256"
    info "Configuration chiffrée et sauvegardée"
}

# ── 3. Vérification ───────────────────────────────────────────────────────────
verify_backup() {
    info "Vérification de l'intégrité du backup..."
    local pg_dir="${WORK}/postgresql"
    if ! sha256sum --check "${pg_dir}/SHA256SUMS" --quiet 2>/dev/null; then
        fail "Vérification du backup PostgreSQL échouée — backup corrompu"
    fi
    info "Intégrité vérifiée"
}

# ── 4. Upload ─────────────────────────────────────────────────────────────────
upload_backup() {
    info "Upload vers ${BACKUP_DEST}..."

    case "${BACKUP_DEST:-local}" in
        local|nfs)
            local dest_path="${BACKUP_LOCAL_PATH:-/mnt/backup}/${TIMESTAMP}"
            mkdir -p "${dest_path}"
            rsync -av --checksum "${WORK}/" "${dest_path}/"
            info "Backup copié dans ${dest_path}"
            # Rotation : garder les 30 derniers backups
            ls -1dt "${BACKUP_LOCAL_PATH:-/mnt/backup}"/20* 2>/dev/null \
                | tail -n +31 | xargs -r rm -rf
            info "Anciens backups purgés (rétention: 30 jours)"
            ;;
        s3)
            AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:-}" \
            AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:-}" \
            aws s3 sync \
                --endpoint-url "${BACKUP_S3_ENDPOINT:-}" \
                "${WORK}/" \
                "s3://${BACKUP_S3_BUCKET:-audit-backup}/backups/${TIMESTAMP}/" \
                --no-progress
            info "Backup uploadé sur S3/${BACKUP_S3_BUCKET:-audit-backup}"
            ;;
        *)
            fail "Destination inconnue : ${BACKUP_DEST}"
            ;;
    esac
}

# ── 5. Enregistrement ─────────────────────────────────────────────────────────
record_job() {
    local status="$1"
    local size_bytes
    size_bytes=$(du -sb "${WORK}" 2>/dev/null | cut -f1 || echo 0)

    PGPASSFILE="${APPLIANCE_HOME}/config/.pgpass" \
    psql -h localhost -U audit -d audit -qc \
        "INSERT INTO audit_backup_job
             (started_at, completed_at, destination, size_bytes, status)
         VALUES (now() - interval '${SECONDS} seconds', now(),
                 '${BACKUP_DEST:-local}', ${size_bytes}, '${status}')" \
        2>/dev/null || warn "Enregistrement du job échoué"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    info "=== Backup démarré : ${TIMESTAMP} ==="
    trap 'record_job FAILED; rm -rf "${WORK:-}"; fail "Backup interrompu"' ERR

    check_prereqs
    init_work_dir
    backup_postgresql
    backup_configuration
    verify_backup
    upload_backup
    record_job SUCCESS

    local size_mb
    size_mb=$(du -sm "${WORK}" | cut -f1)
    rm -rf "${WORK}"
    info "=== Backup terminé avec succès : ${size_mb} MB ==="
}

main "$@"
