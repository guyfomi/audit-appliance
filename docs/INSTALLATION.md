# Guide d'installation

## Table des matières

1. [Prérequis](#1-prérequis)
2. [Préparation de la VM](#2-préparation-de-la-vm)
3. [Installation du logiciel](#3-installation-du-logiciel)
4. [Assistant de configuration](#4-assistant-de-configuration-10-étapes)
5. [Configuration Oracle côté source](#5-configuration-oracle-côté-source)
6. [Vérification post-installation](#6-vérification-post-installation)
7. [Mise à jour](#7-mise-à-jour)
8. [Désinstallation](#8-désinstallation)

---

## 1. Prérequis

### 1.1 Système hôte

| Ressource | Minimum | Production |
|-----------|---------|------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disque système | 50 GB | 100 GB |
| Disque archive | — | 500 GB+ (selon volume) |
| Réseau | 100 Mbit/s | 1 Gbit/s |

### 1.2 Réseau

Les ports suivants doivent être ouverts **depuis les postes administrateurs** vers l'appliance :

| Port | Protocole | Usage |
|------|-----------|-------|
| 443 | HTTPS | Interface Web + API |
| 22 | SSH | Administration (optionnel) |

L'appliance doit pouvoir joindre **en sortie** :

| Destination | Port | Usage |
|-------------|------|-------|
| Oracle DB host | 1521 | JDBC / SynchDB |
| SynchDB host | 8080 | CDC API (si SynchDB séparé) |
| SMTP host | 587 | Alertes email |
| MinIO / S3 | 9000 / 443 | Archive (optionnel) |

### 1.3 Oracle côté source

```sql
-- Activer le supplemental logging (niveau minimal)
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;

-- Vérifier
SELECT SUPPLEMENTAL_LOG_DATA_MIN FROM V$DATABASE;
-- Doit retourner : YES

-- Créer l'utilisateur CDC (Oracle 12c+)
CREATE USER audit_cdc IDENTIFIED BY "MotDePasseFort123!";
GRANT CREATE SESSION TO audit_cdc;
GRANT SELECT ON V_$DATABASE TO audit_cdc;
GRANT SELECT ON V_$LOG TO audit_cdc;
GRANT SELECT ON V_$LOGFILE TO audit_cdc;
GRANT SELECT ON V_$LOGMNR_CONTENTS TO audit_cdc;
GRANT SELECT ON V_$ARCHIVED_LOG TO audit_cdc;
GRANT EXECUTE ON DBMS_LOGMNR TO audit_cdc;
GRANT EXECUTE ON DBMS_LOGMNR_D TO audit_cdc;
GRANT LOGMINING TO audit_cdc;  -- Oracle 12.2+
```

---

## 2. Préparation de la VM

### 2.1 Import OVA (VMware ESXi / vSphere)

```bash
# Depuis vSphere Client :
# File → Deploy OVF Template
# Sélectionner : oracle-audit-appliance-1.0.0.ova
# Allouer : 4 vCPU, 8 GB RAM, 50 GB disque
# Réseau : VLAN de management approprié
```

### 2.2 Import QCOW2 (Proxmox)

```bash
# Sur le nœud Proxmox
qm create 200 --name audit-appliance --memory 8192 --cores 4 \
    --net0 virtio,bridge=vmbr0

qm importdisk 200 oracle-audit-appliance-1.0.0.qcow2 local-lvm

qm set 200 --scsihw virtio-scsi-pci --scsi0 local-lvm:vm-200-disk-0
qm set 200 --boot c --bootdisk scsi0
qm set 200 --serial0 socket --vga serial0

qm start 200
```

### 2.3 Configuration réseau post-import

```bash
# Se connecter à la console VM
# Login : audit / audit (mot de passe temporaire — changé par le wizard)

# Configurer l'IP statique (Ubuntu 22.04/24.04 — netplan)
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    ens192:
      addresses:
        - 10.10.1.50/24
      routes:
        - to: default
          via: 10.10.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
      dhcp4: false
```

```bash
sudo netplan apply
```

---

## 3. Installation du logiciel

### 3.1 Installation automatique

```bash
# En tant que root
cd /opt/audit-appliance
sudo bash install/install.sh 2>&1 | tee /var/log/audit-install.log
```

L'installation effectue dans l'ordre :

1. Vérification des prérequis (RAM, disque, OS)
2. Installation des paquets système (Python 3.12, PostgreSQL 16, Nginx)
3. Création de l'utilisateur système `audit`
4. Configuration du virtualenv Python et des dépendances
5. Configuration de PostgreSQL (tuning, archivage WAL)
6. Configuration de Nginx (TLS, headers sécurité, rate limiting)
7. Installation des services systemd (7 services + 3 timers)
8. Exécution des migrations Alembic

**Durée estimée :** 10–15 minutes selon la connexion réseau.

### 3.2 Vérification de l'installation

```bash
# Vérifier que les services sont démarrés
systemctl status audit-api audit-engine postgresql nginx

# Vérifier les logs
journalctl -u audit-api -f
journalctl -u audit-engine -f
```

---

## 4. Assistant de configuration (10 étapes)

```bash
sudo bash install/setup-wizard.sh
```

### Étape 1 — Identité de l'appliance

```
Appliance name (e.g. AUDIT-PROD-01): AUDIT-COREBANK-01
Organisation: Banque Nationale
```

### Étape 2 — Réseau

```
IP address (leave blank for DHCP): 10.10.1.50
FQDN or hostname: audit.internal.bank.com
```

Le wizard régénère le certificat TLS auto-signé avec le FQDN fourni.
Pour utiliser un certificat signé par votre CA :

```bash
# Remplacer après le wizard
cp votre-cert.pem /opt/audit-appliance/ssl/cert.pem
cp votre-key.pem  /opt/audit-appliance/ssl/key.pem
systemctl reload nginx
```

### Étape 3 — Administrateur

```
Admin username:  admin
Admin email:     admin@bank.com
Admin password:  [masqué — minimum 12 caractères]
```

### Étape 4 — PostgreSQL

```
PostgreSQL host (default: localhost): localhost
PostgreSQL password for user 'audit': [généré automatiquement si laissé vide]
```

### Étape 5 — Connexion Oracle

```
Oracle host:         ora-prod-01.bank.com
Oracle port:         1521
Oracle service name: COREBANK
Oracle user:         audit_cdc
Oracle password:     [masqué]
```

> ⚠️ Le mot de passe Oracle est stocké dans `/opt/audit-appliance/config/.oracle_secrets`
> avec permissions `600`. Il n'apparaît jamais dans les logs.

### Étape 6 — Configuration CDC

```
SynchDB URL: http://synchdb-host:8080
Poll interval in ms (default: 500): 500
```

### Étape 7 — Tables à auditer

```
Table (or Enter to finish): BANK.CUSTOMER
Table (or Enter to finish): BANK.ACCOUNT
Table (or Enter to finish): BANK.LOAN
Table (or Enter to finish): BANK.TRANSACTION
Table (or Enter to finish): [Entrée pour terminer]
```

### Étape 8 — Colonnes sensibles (masquage)

```
Column mask: BANK.CUSTOMER.CARD_NUMBER=PARTIAL
Column mask: BANK.CUSTOMER.PASSWORD_HASH=FULL
Column mask: BANK.CUSTOMER.SALARY=HASH
Column mask: [Entrée pour terminer]
```

Politiques disponibles :

| Politique | Exemple | Résultat |
|-----------|---------|----------|
| `PARTIAL` | 1234567890123456 | `1234********3456` |
| `FULL` | MotDePasseSecret | `***` |
| `HASH` | MotDePasseSecret | `hash:a3f8d2e1b9c4071…` |
| `REDACT` | Toute valeur | `[REDACTED]` |

### Étape 9 — Politique de rétention

```
Hot tier (days, default: 90):   90
Warm tier (days, default: 365): 365
Cold tier (days, default: 2555): 2555
```

| Tier | Durée | Stockage | Accès |
|------|-------|----------|-------|
| **Hot** | 0–90 j | PostgreSQL actif | Temps réel, recherche complète |
| **Warm** | 91–365 j | PostgreSQL (partitions détachées) | Requêtes lentes |
| **Cold** | >365 j | Parquet/JSONL + object store | Export uniquement |

### Étape 10 — Alertes

```
Alert email (SMTP to): security@bank.com
SMTP host:             smtp.bank.com
SMTP port (default: 587): 587
Webhook URL (optional): https://hooks.teams.microsoft.com/...
```

### Résultat du wizard

```
╔══════════════════════════════════════════════════════════════╗
║   Setup complete                                             ║
║                                                              ║
║   Open: https://10.10.1.50                                   ║
║   User: admin                                                ║
║                                                              ║
║   IMPORTANT: Save your backup encryption key:               ║
║   dK7mP2xQnR9vL4hT8yF1wS6cA3bN5uE0…                        ║
╚══════════════════════════════════════════════════════════════╝
```

> ⚠️ **Conserver la clé de chiffrement backup en lieu sûr.**
> Sans elle, les backups de configuration ne pourront pas être restaurés.

---

## 5. Configuration Oracle côté source

### 5.1 Supplemental logging par table

Pour une capture complète des BEFORE/AFTER :

```sql
-- Supplemental logging au niveau colonne pour les tables critiques
ALTER TABLE BANK.CUSTOMER ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE BANK.ACCOUNT  ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE BANK.LOAN     ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;

-- Vérifier
SELECT LOG_GROUP_TYPE, TABLE_NAME
FROM DBA_LOG_GROUPS
WHERE OWNER = 'BANK';
```

### 5.2 Archivage des REDO logs

SynchDB nécessite que les REDO logs soient accessibles pendant la durée du lag CDC.
Configurer une rétention suffisante :

```sql
-- Oracle 12c+
ALTER SYSTEM SET LOG_ARCHIVE_DEST_1 = 'LOCATION=/u01/archive' SCOPE=BOTH;
ALTER SYSTEM SET ARCHIVE_LAG_TARGET = 1800 SCOPE=BOTH;  -- 30 min max

-- Vérifier l'archivage
SELECT DEST_NAME, STATUS FROM V$ARCHIVE_DEST WHERE STATUS = 'VALID';
```

---

## 6. Vérification post-installation

### 6.1 Health check

```bash
curl -k https://localhost/api/v1/health
# Attendu : {"status":"ok","timestamp":...}

curl -k https://localhost/api/v1/health/detail
# Attendu : {"status":"ok","checks":{"postgresql":"ok",...}}
```

### 6.2 Vérifier le CDC

```bash
# Depuis l'interface Web : System → CDC Status
# Ou via API :
TOKEN=$(curl -ks -X POST https://localhost/api/v1/auth/token \
    -d "username=admin&password=VotreMotDePasse" | jq -r .access_token)

curl -ks -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/cdc/status | jq .
```

### 6.3 Vérifier l'intégrité

```bash
curl -ks -X POST https://localhost/api/v1/integrity/verify \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"database_id":1,"schema_name":"BANK","table_name":"CUSTOMER"}' | jq .
```

### 6.4 Checklist de démarrage

- [ ] Interface HTTPS accessible
- [ ] Login admin fonctionnel
- [ ] `GET /health/detail` → toutes les sondes `ok`
- [ ] CDC Status → `RUNNING`, lag < 60 s
- [ ] Premiers événements visibles dans l'Audit Explorer
- [ ] Dashboard affiche des métriques
- [ ] Email de test reçu (menu Administration → Test alert)

---

## 7. Mise à jour

```bash
# Arrêter les services applicatifs (PostgreSQL continue)
sudo systemctl stop audit-cdc audit-engine audit-api

# Mettre à jour le code
cd /opt/audit-appliance
sudo git pull origin main   # ou décompresser la nouvelle version

# Mettre à jour les dépendances Python
sudo -u audit /opt/audit-appliance/venv/bin/pip install \
    -r requirements.txt --upgrade --quiet

# Exécuter les nouvelles migrations
sudo -u audit /opt/audit-appliance/venv/bin/alembic \
    --config src/alembic.ini upgrade head

# Redémarrer
sudo systemctl start audit-engine audit-api
sleep 5
sudo systemctl start audit-cdc

# Vérifier
sudo systemctl status audit-cdc audit-engine audit-api
```

---

## 8. Désinstallation

```bash
# Arrêter et désactiver les services
sudo systemctl stop audit-cdc audit-engine audit-api \
    audit-archive.timer audit-backup.timer audit-partition.timer
sudo systemctl disable audit-cdc audit-engine audit-api \
    audit-archive.timer audit-backup.timer audit-partition.timer

# Supprimer les fichiers systemd
sudo rm -f /etc/systemd/system/audit-*.service
sudo rm -f /etc/systemd/system/audit-*.timer
sudo systemctl daemon-reload

# Supprimer Nginx vhost
sudo rm -f /etc/nginx/sites-enabled/audit-appliance
sudo rm -f /etc/nginx/sites-available/audit-appliance
sudo systemctl reload nginx

# Supprimer la base de données (ATTENTION : données perdues)
sudo -u postgres psql -c "DROP DATABASE audit;"
sudo -u postgres psql -c "DROP USER audit;"
sudo -u postgres psql -c "DROP USER audit_backup;"

# Supprimer les fichiers applicatifs
sudo rm -rf /opt/audit-appliance
sudo rm -rf /var/lib/audit-appliance
sudo userdel -r audit
```
