#!/usr/bin/env bash
# =============================================================================
# Oracle Data Audit & Forensics Appliance — Smoke Test
# Vérifie que tous les composants sont opérationnels après installation.
# Usage : bash tests/smoke_test.sh [--host <ip>] [--user admin] [--pass <pwd>]
# =============================================================================

set -euo pipefail

HOST="${HOST:-https://localhost}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-}"
SKIP_TLS="--insecure"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0; WARN=0

pass()  { echo -e "${GREEN}  ✓${NC} $*";  ((PASS++)); }
fail()  { echo -e "${RED}  ✗${NC} $*";   ((FAIL++)); }
warn()  { echo -e "${YELLOW}  ⚠${NC}  $*"; ((WARN++)); }
section(){ echo -e "\n${YELLOW}── $* ──${NC}"; }

# Lecture du mot de passe si absent
if [[ -z "${ADMIN_PASS}" ]]; then
    read -rsp "  Mot de passe admin: " ADMIN_PASS; echo ""
fi

# ── 1. Ping HTTP ──────────────────────────────────────────────────────────────
section "Connectivité réseau"
if curl ${SKIP_TLS} -sf "${HOST}/" -o /dev/null 2>/dev/null; then
    pass "Interface Web accessible : ${HOST}"
else
    fail "Interface Web inaccessible : ${HOST}"
fi

# ── 2. Health check simple ────────────────────────────────────────────────────
section "Health checks"
HEALTH=$(curl ${SKIP_TLS} -sf "${HOST}/api/v1/health" 2>/dev/null || echo '{"status":"error"}')
STATUS=$(echo "${HEALTH}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','error'))" 2>/dev/null || echo "error")
if [[ "${STATUS}" == "ok" ]]; then
    pass "Health simple : OK"
else
    fail "Health simple : ${STATUS}"
fi

# ── 3. Authentification ───────────────────────────────────────────────────────
section "Authentification JWT"
TOKEN_RESP=$(curl ${SKIP_TLS} -sf -X POST "${HOST}/api/v1/auth/token" \
    -d "username=${ADMIN_USER}&password=${ADMIN_PASS}" 2>/dev/null || echo '{}')
TOKEN=$(echo "${TOKEN_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || echo "")
if [[ -n "${TOKEN}" ]]; then
    pass "Login JWT : OK (rôle=$(echo "${TOKEN_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('role','?'))" 2>/dev/null))"
else
    fail "Login JWT : ÉCHEC — vérifier les identifiants"
    echo "  Réponse: ${TOKEN_RESP}"
    exit 1
fi
AUTH="-H \"Authorization: Bearer ${TOKEN}\""

curl_auth() { curl ${SKIP_TLS} -sf -H "Authorization: Bearer ${TOKEN}" "$@" 2>/dev/null || echo '{}'; }

# ── 4. Health détaillé ────────────────────────────────────────────────────────
section "Health détaillé"
DETAIL=$(curl_auth "${HOST}/api/v1/health/detail")
PG=$(echo "${DETAIL}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('checks',{}).get('postgresql','?'))" 2>/dev/null || echo "?")
if [[ "${PG}" == "ok" ]]; then
    pass "PostgreSQL : connecté"
else
    fail "PostgreSQL : ${PG}"
fi

DISK_GB=$(echo "${DETAIL}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('checks',{}).get('disk_free_gb',0))" 2>/dev/null || echo "0")
DISK_OK=$(python3 -c "print('ok' if float('${DISK_GB}') > 5 else 'warn')" 2>/dev/null || echo "warn")
if [[ "${DISK_OK}" == "ok" ]]; then
    pass "Disque libre : ${DISK_GB} GB"
else
    warn "Disque libre faible : ${DISK_GB} GB (< 5 GB)"
fi

# ── 5. Dashboard ──────────────────────────────────────────────────────────────
section "Dashboard API"
DASH=$(curl_auth "${HOST}/api/v1/dashboard")
TOTAL=$(echo "${DASH}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_events',0))" 2>/dev/null || echo "0")
pass "Dashboard : ${TOTAL} événements au total"

# ── 6. CDC ────────────────────────────────────────────────────────────────────
section "CDC (Change Data Capture)"
CDC=$(curl_auth "${HOST}/api/v1/cdc/status")
CDC_STATUS=$(echo "${CDC}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['status'] if d else 'NO_DATA')" 2>/dev/null || echo "ERROR")
CDC_LAG=$(echo "${CDC}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('lag_seconds','N/A') if d else 'N/A')" 2>/dev/null || echo "N/A")
if [[ "${CDC_STATUS}" == "RUNNING" ]]; then
    pass "CDC : RUNNING (lag: ${CDC_LAG}s)"
elif [[ "${CDC_STATUS}" == "PAUSED" ]]; then
    warn "CDC : PAUSED — démarrer avec : systemctl start audit-cdc"
else
    fail "CDC : ${CDC_STATUS}"
fi

# ── 7. Règles de risque ───────────────────────────────────────────────────────
section "Règles de risque"
RULES=$(curl_auth "${HOST}/api/v1/rules")
RULE_COUNT=$(echo "${RULES}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [[ "${RULE_COUNT}" -gt 0 ]]; then
    pass "Règles de risque : ${RULE_COUNT} règles chargées"
else
    warn "Aucune règle de risque — les événements ne seront pas scorés"
fi

# ── 8. Intégrité ──────────────────────────────────────────────────────────────
section "Intégrité SHA-256"
INTEGRITY=$(curl_auth "${HOST}/api/v1/integrity/status")
INT_OK=$(echo "${INTEGRITY}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('last_verified_ok','null'))" 2>/dev/null || echo "null")
if [[ "${INT_OK}" == "True" ]]; then
    pass "Chaîne d'intégrité : vérifiée"
elif [[ "${INT_OK}" == "null" ]]; then
    warn "Chaîne d'intégrité : non encore vérifiée (normal au démarrage)"
else
    fail "Chaîne d'intégrité : ERREUR"
fi

# ── 9. SynchDB ───────────────────────────────────────────────────────────────
section "SynchDB"
SYNCHDB_URL=$(grep "^SYNCHDB_URL=" /opt/audit-appliance/config/appliance.env 2>/dev/null | cut -d= -f2 || echo "http://localhost:8080")
SYNCHDB_HEALTH=$(curl -sf "${SYNCHDB_URL}/health" 2>/dev/null || echo '{"status":"DOWN"}')
SYNCHDB_STATUS=$(echo "${SYNCHDB_HEALTH}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','ERROR'))" 2>/dev/null || echo "ERROR")
if [[ "${SYNCHDB_STATUS}" == "UP" ]]; then
    SYNCHDB_LAG=$(echo "${SYNCHDB_HEALTH}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lag_seconds','?'))" 2>/dev/null || echo "?")
    pass "SynchDB : UP (lag: ${SYNCHDB_LAG}s)"
else
    warn "SynchDB : ${SYNCHDB_STATUS} — vérifier systemctl status synchdb"
fi

# ── 10. Interface Web ─────────────────────────────────────────────────────────
section "Interface Web React"
UI_RESP=$(curl ${SKIP_TLS} -sf "${HOST}/" -o /tmp/audit_index.html 2>/dev/null && echo "ok" || echo "error")
if [[ "${UI_RESP}" == "ok" ]] && grep -q "Oracle Data Audit" /tmp/audit_index.html 2>/dev/null; then
    pass "Interface Web : accessible et correctement construite"
else
    warn "Interface Web : accessible mais index.html non trouvé — relancer install-ui.sh"
fi
rm -f /tmp/audit_index.html

# ── Résumé ────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "  Smoke Test — Résumé"
echo "════════════════════════════════════════"
echo -e "  ${GREEN}✓ Succès :${NC}        ${PASS}"
echo -e "  ${YELLOW}⚠ Avertissements :${NC} ${WARN}"
echo -e "  ${RED}✗ Échecs :${NC}        ${FAIL}"
echo "════════════════════════════════════════"

if [[ "${FAIL}" -eq 0 ]]; then
    echo -e "\n  ${GREEN}✓ Appliance opérationnelle${NC}"
    exit 0
else
    echo -e "\n  ${RED}✗ ${FAIL} vérification(s) en échec — voir ci-dessus${NC}"
    exit 1
fi
