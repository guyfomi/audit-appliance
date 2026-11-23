#!/usr/bin/env bash
# =============================================================================
# Oracle Data Audit & Forensics Appliance
# Installation et build de l'interface Web React
# Usage : sudo bash install/install-ui.sh
# =============================================================================

set -euo pipefail

APPLIANCE_HOME="/opt/audit-appliance"
UI_DIR="${APPLIANCE_HOME}/ui"
DIST_DIR="${APPLIANCE_HOME}/ui/dist"
NODE_MIN_VERSION=18

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
section() { echo -e "\n${BLUE}══ $* ══${NC}"; }

[[ $EUID -ne 0 ]] && error "Exécuter en tant que root"

# ── Node.js ───────────────────────────────────────────────────────────────────
install_nodejs() {
    section "Node.js ${NODE_MIN_VERSION}+"

    if command -v node &>/dev/null; then
        local ver
        ver=$(node --version | grep -oP '(?<=v)\d+')
        if [[ ${ver:-0} -ge ${NODE_MIN_VERSION} ]]; then
            info "Node.js v$(node --version) déjà installé"
            return
        fi
        warn "Node.js $(node --version) trop ancien — mise à jour nécessaire"
    fi

    info "Installation de Node.js ${NODE_MIN_VERSION} LTS via NodeSource..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_VERSION}.x" | bash -
    apt-get install -y nodejs
    info "Node.js $(node --version) installé"
}

# ── Dépendances npm ───────────────────────────────────────────────────────────
install_dependencies() {
    section "Installation des dépendances npm"
    cd "${UI_DIR}"

    info "npm install..."
    npm ci --prefer-offline 2>&1 | tail -5 || npm install
    info "Dépendances installées"
}

# ── Build production ──────────────────────────────────────────────────────────
build_ui() {
    section "Build production React"
    cd "${UI_DIR}"

    # Variables d'environnement pour le build
    export VITE_API_BASE_URL=/api/v1
    export VITE_APP_TITLE="Oracle Data Audit"
    export VITE_APP_VERSION=1.0.0
    export NODE_ENV=production

    info "Compilation TypeScript + Vite..."
    npm run build

    local size
    size=$(du -sh "${DIST_DIR}" | cut -f1)
    info "Build terminé : ${DIST_DIR} (${size})"
}

# ── Déploiement dans Nginx ────────────────────────────────────────────────────
deploy_to_nginx() {
    section "Déploiement vers Nginx"

    # Créer le répertoire de destination s'il n'existe pas
    mkdir -p "${DIST_DIR}"

    # Vérifier que le build existe
    [[ -f "${DIST_DIR}/index.html" ]] || error "Build introuvable — vérifier npm run build"

    # Nginx lit directement depuis ui/dist via la config
    # Vérifier que la config Nginx pointe vers le bon répertoire
    if grep -q "${DIST_DIR}" /etc/nginx/sites-available/audit-appliance 2>/dev/null; then
        info "Configuration Nginx déjà correcte"
    else
        warn "Vérifier que /etc/nginx/sites-available/audit-appliance pointe vers ${DIST_DIR}"
    fi

    # Recharger Nginx
    nginx -t && systemctl reload nginx
    info "Nginx rechargé — UI déployée"
}

# ── Vérification ──────────────────────────────────────────────────────────────
verify_ui() {
    section "Vérification"
    sleep 2

    local http_code
    http_code=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost/ 2>/dev/null || echo "000")

    if [[ "${http_code}" == "200" ]]; then
        info "Interface Web accessible : https://localhost (HTTP ${http_code})"
    else
        warn "Interface Web : HTTP ${http_code} — vérifier les logs Nginx"
        warn "journalctl -u nginx --since '5 minutes ago'"
    fi

    # Vérifier que l'API répond aussi
    local api_code
    api_code=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost/api/v1/health 2>/dev/null || echo "000")
    if [[ "${api_code}" == "200" ]]; then
        info "API health check : OK (HTTP ${api_code})"
    else
        warn "API health check : HTTP ${api_code}"
    fi
}

# ── Développement local (sans build) ─────────────────────────────────────────
dev_server() {
    section "Serveur de développement"
    cd "${UI_DIR}"

    info "Démarrage du serveur Vite sur http://localhost:3000"
    info "Proxy API → http://localhost:8000"
    info "Arrêter avec Ctrl+C"
    echo ""

    npm run dev
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║   Oracle Data Audit — Interface Web React                   ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    local mode="${1:---production}"

    case "${mode}" in
        --dev)
            install_nodejs
            install_dependencies
            dev_server
            ;;
        --production|*)
            install_nodejs
            install_dependencies
            build_ui
            deploy_to_nginx
            verify_ui
            echo ""
            echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${GREEN}║   Interface Web déployée avec succès                        ║${NC}"
            echo -e "${GREEN}║   URL : https://$(hostname -I | awk '{print $1}')                        ║${NC}"
            echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
            ;;
    esac
}

main "$@"
