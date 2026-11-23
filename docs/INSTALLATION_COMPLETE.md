# Guide d'installation complet

Ce guide décrit l'installation dans l'ordre chronologique exact.

---

## Ordre d'installation recommandé

```
Étape 1  → Préparer la VM
Étape 2  → Installer l'appliance (install.sh)
Étape 3  → Installer SynchDB (install-synchdb.sh)
Étape 4  → Installer l'interface Web (install-ui.sh)
Étape 5  → Configurer l'appliance (setup-wizard.sh)
Étape 6  → Vérifier et démarrer
```

---

## Étape 1 — Préparer la VM

### Spécifications

| Ressource | Minimum | Production |
|-----------|---------|------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disque | 50 GB | 200 GB |
| Réseau | 100 Mbit/s | 1 Gbit/s |

### Import OVA (VMware)

```
vSphere Client → File → Deploy OVF Template
Sélectionner : oracle-audit-appliance-1.0.0.ova
Allouer : 8 GB RAM, 4 vCPU, 100 GB disque
```

### Import QCOW2 (Proxmox)

```bash
qm create 200 --name audit-appliance --memory 8192 --cores 4 --net0 virtio,bridge=vmbr0
qm importdisk 200 oracle-audit-appliance-1.0.0.qcow2 local-lvm
qm set 200 --scsihw virtio-scsi-pci --scsi0 local-lvm:vm-200-disk-0
qm set 200 --boot c --bootdisk scsi0
qm start 200
```

### Configuration réseau

```bash
# Ubuntu 22.04/24.04 — Netplan
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    ens192:
      addresses: [10.10.1.50/24]
      routes:
        - to: default
          via: 10.10.1.1
      nameservers:
        addresses: [8.8.8.8]
      dhcp4: false
```

```bash
sudo netplan apply
```

---

## Étape 2 — Installer l'appliance

```bash
# Cloner ou décompresser l'appliance
git clone https://github.com/votre-org/audit-appliance.git /opt/audit-appliance
cd /opt/audit-appliance

# Lancer l'installation (10–15 minutes)
sudo bash install/install.sh

# Vérifier
sudo systemctl status postgresql nginx audit-api audit-engine
```

**Ce que fait `install.sh` :**
- Installe Java 17, Python 3.12, PostgreSQL 16, Nginx
- Crée l'utilisateur système `audit`
- Configure PostgreSQL (tuning, archivage WAL)
- Génère un certificat TLS auto-signé
- Configure Nginx (HTTPS, rate limiting, headers sécurité)
- Installe les 7 services systemd et 5 timers
- Crée le schéma de base de données complet

---

## Étape 3 — Installer SynchDB

### Option A — Mode production (SynchDB réel)

```bash
sudo bash /opt/audit-appliance/synchdb/install/install-synchdb.sh
```

**Prérequis Oracle avant de démarrer SynchDB :**

```sql
-- Sur le serveur Oracle (en tant que SYSDBA)
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;

CREATE USER audit_cdc IDENTIFIED BY "MotDePasseFort123!";
GRANT CREATE SESSION TO audit_cdc;
GRANT LOGMINING      TO audit_cdc;
GRANT SELECT ON V_$DATABASE         TO audit_cdc;
GRANT SELECT ON V_$LOG              TO audit_cdc;
GRANT SELECT ON V_$LOGFILE          TO audit_cdc;
GRANT SELECT ON V_$LOGMNR_CONTENTS  TO audit_cdc;
GRANT SELECT ON V_$ARCHIVED_LOG     TO audit_cdc;
GRANT EXECUTE ON DBMS_LOGMNR        TO audit_cdc;
GRANT EXECUTE ON DBMS_LOGMNR_D      TO audit_cdc;
```

**Démarrer SynchDB :**

```bash
sudo systemctl start synchdb
sudo systemctl status synchdb

# Vérifier la connexion Oracle
curl http://localhost:8080/health | jq .
```

### Option B — Mode développement/test (mock)

```bash
# Utiliser le mock Python intégré (ne nécessite pas Oracle)
sudo systemctl start synchdb-mock
sudo systemctl status synchdb-mock

# Vérifier
curl http://localhost:8080/health
# → {"status":"UP","oracle":"connected","lag_seconds":0.4,...}

# Voir les événements générés
curl "http://localhost:8080/changes?limit=3" | python3 -m json.tool
```

Le mock génère des événements CDC synthétiques à 20 événements/seconde
sur les tables BANK.CUSTOMER, BANK.ACCOUNT, BANK.LOAN, etc.

---

## Étape 4 — Installer l'interface Web

```bash
# Build React + déploiement Nginx (5–10 minutes)
sudo bash /opt/audit-appliance/install/install-ui.sh

# Ou en mode développement (serveur Vite)
sudo bash /opt/audit-appliance/install/install-ui.sh --dev
```

**Ce que fait `install-ui.sh` :**
- Installe Node.js 18 LTS
- Exécute `npm ci` (installation des dépendances)
- Lance `npm run build` (compilation TypeScript + Vite)
- Recharge Nginx pour servir le build

**Build manuel si nécessaire :**

```bash
cd /opt/audit-appliance/ui
npm ci
NODE_ENV=production npm run build

# Vérifier que le build est présent
ls -lh dist/
# → index.html, assets/

sudo systemctl reload nginx
```

---

## Étape 5 — Configurer l'appliance

```bash
sudo bash /opt/audit-appliance/install/setup-wizard.sh
```

L'assistant pose 10 questions :

```
[ Étape 1/10 ] Identité de l'appliance
  Appliance name: AUDIT-PROD-01
  Organisation:   Banque Nationale

[ Étape 2/10 ] Configuration réseau
  IP address:  10.10.1.50
  FQDN:        audit.bank.internal

[ Étape 3/10 ] Compte administrateur
  Admin username: admin
  Admin email:    admin@bank.com
  Admin password: [masqué — min 12 caractères]

[ Étape 4/10 ] PostgreSQL
  PostgreSQL host: localhost   (auto-rempli)

[ Étape 5/10 ] Connexion Oracle
  Oracle host:         ora-prod-01.bank.com
  Oracle port:         1521
  Oracle service name: COREBANK
  Oracle user:         audit_cdc
  Oracle password:     [masqué]

[ Étape 6/10 ] Configuration CDC (SynchDB)
  SynchDB URL:        http://localhost:8080
  Intervalle de poll: 500 ms

[ Étape 7/10 ] Tables à auditer
  Table: BANK.CUSTOMER
  Table: BANK.ACCOUNT
  Table: BANK.LOAN
  Table: BANK.TRANSACTION
  Table: [Entrée pour terminer]

[ Étape 8/10 ] Colonnes sensibles
  Masquage: BANK.CUSTOMER.CARD_NUMBER=PARTIAL
  Masquage: BANK.CUSTOMER.PASSWORD_HASH=FULL
  Masquage: [Entrée pour terminer]

[ Étape 9/10 ] Rétention
  HOT:  90 jours
  WARM: 365 jours
  COLD: 2555 jours (7 ans)

[ Étape 10/10 ] Alertes
  Email:   security@bank.com
  SMTP:    smtp.bank.com:587
  Webhook: https://hooks.teams.microsoft.com/...
```

**Résultat :**

```
╔══════════════════════════════════════════════════════════════╗
║   Configuration terminée avec succès                        ║
║                                                              ║
║   Interface : https://10.10.1.50                            ║
║   Login    : admin                                          ║
║                                                              ║
║   ⚠  CLÉ DE CHIFFREMENT BACKUP (sauvegarder en lieu sûr)   ║
║   dK7mP2xQnR9vL4hT8yF1wS6cA3bN5uE0...                      ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Étape 6 — Vérifier et démarrer

### Checklist de démarrage

```bash
# 1. Vérifier tous les services
make status
# ou
systemctl is-active audit-cdc audit-engine audit-api postgresql nginx synchdb

# 2. Health check API
curl -sk https://localhost/api/v1/health | jq .
# → {"status":"ok","timestamp":...}

# 3. Health check détaillé
TOKEN=$(curl -ks -X POST https://localhost/api/v1/auth/token \
    -d "username=admin&password=VotreMotDePasse" | jq -r .access_token)

curl -sk -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/health/detail | jq '{
        status,
        postgresql: .checks.postgresql,
        cdc_lag: .checks.cdc_lag_seconds,
        disk_free_gb: .checks.disk_free_gb
    }'

# 4. Vérifier le CDC
curl -sk -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/cdc/status | jq '.[0] | {status, lag_seconds}'

# 5. Vérifier les premiers événements
curl -sk -H "Authorization: Bearer $TOKEN" \
    "https://localhost/api/v1/events?page_size=5" | jq '.total'
```

### Interface Web

Ouvrir dans un navigateur : `https://<IP_APPLIANCE>`

Accepter l'exception de sécurité du certificat auto-signé
(ou installer votre certificat CA dans `/opt/audit-appliance/ssl/`).

**Première connexion :**
1. Saisir `admin` / `VotreMotDePasse`
2. Le Dashboard s'affiche avec les premières métriques
3. Vérifier que le badge CDC en haut de la sidebar est vert

---

## Résolution rapide des problèmes

### L'interface ne charge pas

```bash
# Vérifier Nginx
sudo nginx -t
sudo systemctl status nginx
journalctl -u nginx --since "5 min ago"

# Vérifier que le build existe
ls /opt/audit-appliance/ui/dist/index.html
# Si absent : sudo bash install/install-ui.sh
```

### Le CDC ne démarre pas

```bash
journalctl -u audit-cdc -f
# Si "CDCConnectionError" : SynchDB non accessible
curl http://localhost:8080/health

# Si SynchDB non démarré :
sudo systemctl start synchdb       # production
sudo systemctl start synchdb-mock  # développement
```

### L'API retourne 401

```bash
# Token expiré — se reconnecter
TOKEN=$(curl -ks -X POST https://localhost/api/v1/auth/token \
    -d "username=admin&password=VotreMotDePasse" | jq -r .access_token)
echo "Token: $TOKEN"
```

### PostgreSQL ne répond pas

```bash
sudo systemctl status postgresql
sudo systemctl restart postgresql
journalctl -u postgresql --since "10 min ago"
```

---

## Résumé des URLs et ports

| Service | URL / Port | Usage |
|---------|-----------|-------|
| Interface Web | `https://<IP>:443` | UI principale |
| API REST | `https://<IP>/api/v1` | API (via Nginx) |
| API interne | `http://localhost:8000` | FastAPI (non exposé) |
| SynchDB | `http://localhost:8080` | CDC API (non exposé) |
| PostgreSQL | `localhost:5432` | Base de données (non exposé) |

---

## Fichiers de configuration importants

| Fichier | Contenu |
|---------|---------|
| `/opt/audit-appliance/config/appliance.env` | Configuration principale |
| `/opt/audit-appliance/config/.oracle_secrets` | Credentials Oracle (600) |
| `/opt/audit-appliance/config/.pgpass` | Mot de passe PostgreSQL (600) |
| `/opt/audit-appliance/config/.backup_key` | Clé de chiffrement backup (600) |
| `/opt/audit-appliance/ssl/cert.pem` | Certificat TLS |
| `/opt/audit-appliance/ssl/key.pem` | Clé privée TLS (600) |
| `/opt/synchdb/config/synchdb.yml` | Configuration SynchDB |
| `/etc/nginx/sites-available/audit-appliance` | Vhost Nginx |

---

## Logs à consulter en cas de problème

```bash
# API
journalctl -u audit-api -f

# Moteur d'audit
journalctl -u audit-engine -f

# CDC
journalctl -u audit-cdc -f

# SynchDB
journalctl -u synchdb -f

# Nginx
tail -f /var/log/nginx/audit-appliance-error.log

# PostgreSQL
tail -f /var/log/postgresql/postgresql-16-main.log
```
