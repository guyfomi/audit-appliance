# SynchDB — Installation et configuration

## Qu'est-ce que SynchDB ?

SynchDB est un connecteur CDC (Change Data Capture) léger qui lit les REDO logs
Oracle et expose les changements via une API HTTP. Il remplace Kafka/Debezium
dans l'architecture standard de l'appliance.

```
Oracle REDO logs
      │
      ▼  LogMiner / Supplemental logging
   SynchDB
      │  GET /changes?after_scn=...
      ▼
CDC Adapter (SynchDBAdapter)
      │  CDCEvent normalisé
      ▼
Audit Engine
```

**Rôle dans l'appliance :** transport léger des changements Oracle vers le moteur
d'audit. Le moteur d'audit ne dépend pas du format interne de SynchDB — il
utilise uniquement l'interface `CDCAdapter`.

---

## 1. Prérequis SynchDB

### Côté SynchDB (peut être installé sur la même VM ou une VM dédiée)

| Ressource | Minimum |
|-----------|---------|
| Java | JDK 17+ |
| RAM | 1 GB |
| Réseau | Accès TCP port 1521 vers Oracle |

### Côté Oracle (obligatoire)

```sql
-- 1. Activer l'archivage des REDO logs
ARCHIVE LOG LIST;  -- vérifier que c'est déjà en mode ARCHIVELOG

-- Si en mode NOARCHIVELOG :
SHUTDOWN IMMEDIATE;
STARTUP MOUNT;
ALTER DATABASE ARCHIVELOG;
ALTER DATABASE OPEN;

-- 2. Supplemental logging minimal (obligatoire)
ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;

-- 3. Supplemental logging ALL COLUMNS (recommandé pour BEFORE/AFTER complet)
-- Par table critique :
ALTER TABLE BANK.CUSTOMER    ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE BANK.ACCOUNT     ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE BANK.LOAN        ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;
ALTER TABLE BANK.TRANSACTION ADD SUPPLEMENTAL LOG DATA (ALL) COLUMNS;

-- 4. Créer l'utilisateur CDC
CREATE USER audit_cdc IDENTIFIED BY "MotDePasseFort123!";
GRANT CREATE SESSION   TO audit_cdc;
GRANT LOGMINING        TO audit_cdc;   -- Oracle 12.2+
GRANT SELECT ON V_$DATABASE            TO audit_cdc;
GRANT SELECT ON V_$LOG                 TO audit_cdc;
GRANT SELECT ON V_$LOGFILE             TO audit_cdc;
GRANT SELECT ON V_$LOGMNR_CONTENTS     TO audit_cdc;
GRANT SELECT ON V_$ARCHIVED_LOG        TO audit_cdc;
GRANT SELECT ON V_$LOGMNR_LOGS        TO audit_cdc;
GRANT EXECUTE ON DBMS_LOGMNR           TO audit_cdc;
GRANT EXECUTE ON DBMS_LOGMNR_D         TO audit_cdc;

-- Pour Oracle 11g (sans LOGMINING) :
-- GRANT SELECT ANY TRANSACTION TO audit_cdc;
-- GRANT SELECT ANY DICTIONARY  TO audit_cdc;
-- GRANT EXECUTE_CATALOG_ROLE   TO audit_cdc;

-- 5. Vérifier
SELECT SUPPLEMENTAL_LOG_DATA_MIN FROM V$DATABASE;
-- Doit retourner : YES
```

---

## 2. Installation de SynchDB

### Option A — Installation sur la même VM que l'appliance

```bash
# Installer Java 17
sudo apt-get install -y openjdk-17-jdk

# Créer le répertoire SynchDB
sudo mkdir -p /opt/synchdb/{bin,config,logs,checkpoint}
sudo useradd --system --home /opt/synchdb --shell /bin/false synchdb

# Télécharger SynchDB
# (remplacer par l'URL de téléchargement réelle de votre distribution SynchDB)
cd /opt/synchdb/bin
sudo wget https://releases.synchdb.io/synchdb-oracle-1.4.2.jar
sudo ln -s synchdb-oracle-1.4.2.jar synchdb.jar

sudo chown -R synchdb:synchdb /opt/synchdb
```

### Option B — Nœud CDC dédié (recommandé en production)

Installer SynchDB sur une VM séparée avec accès direct à Oracle.
L'appliance se connecte ensuite à SynchDB via HTTP depuis le réseau interne.

```
VM Oracle DB ──1521──▶ VM SynchDB ──8080──▶ VM Appliance
```

---

## 3. Configuration de SynchDB

### Fichier de configuration principal

```bash
sudo cat > /opt/synchdb/config/synchdb.yml << 'EOF'
# =============================================================================
# SynchDB Oracle CDC Connector — Configuration
# =============================================================================

server:
  port: 8080
  host: 0.0.0.0
  # Activer l'authentification par token
  api_key: "CHANGE_ME_GENERATE_SECURE_TOKEN"

oracle:
  host: "oracle-host.internal"
  port: 1521
  service: "COREBANK"
  user: "audit_cdc"
  password: "MotDePasseFort123!"
  # Connexion via TNS (alternative)
  # tns_name: "COREBANK"
  # tns_admin: "/opt/oracle/network/admin"

cdc:
  # SCN de démarrage (null = SCN courant au premier démarrage)
  start_scn: null
  # Nombre maximum de changements par appel
  batch_size: 500
  # Délai minimum entre deux polls (ms)
  poll_delay_ms: 100
  # Durée de rétention du checkpoint local (jours)
  checkpoint_retention_days: 7
  # Fichier de checkpoint local
  checkpoint_file: "/opt/synchdb/checkpoint/synchdb.checkpoint"
  # Inclure le contexte de session Oracle (V$SESSION)
  include_session_context: true
  # Inclure les colonnes BEFORE pour UPDATE
  include_before: true
  # Délai avant de considérer un SCN comme "stable" (secondes)
  scn_stability_delay_seconds: 2

tables:
  # Filtrage des tables (vide = toutes les tables)
  include:
    - "BANK.CUSTOMER"
    - "BANK.ACCOUNT"
    - "BANK.LOAN"
    - "BANK.TRANSACTION"
    - "BANK.COLLATERAL"
  exclude:
    - "BANK.TEMP_%"
    - "BANK.LOG_%"
    - "BANK.STAGING_%"

logging:
  level: INFO
  format: json
  file: "/opt/synchdb/logs/synchdb.log"
  max_size_mb: 100
  max_files: 10

health:
  enabled: true
  endpoint: "/health"
  lag_endpoint: "/lag"
  status_endpoint: "/status"
EOF

sudo chmod 600 /opt/synchdb/config/synchdb.yml
sudo chown synchdb:synchdb /opt/synchdb/config/synchdb.yml
```

---

## 4. Service systemd SynchDB

```bash
sudo cat > /etc/systemd/system/synchdb.service << 'EOF'
[Unit]
Description=SynchDB Oracle CDC Connector
After=network.target
Documentation=https://docs.synchdb.io

[Service]
Type=exec
User=synchdb
Group=synchdb
WorkingDirectory=/opt/synchdb

ExecStart=/usr/bin/java \
    -Xms256m -Xmx512m \
    -XX:+UseG1GC \
    -XX:MaxGCPauseMillis=100 \
    -Djava.security.egd=file:/dev/./urandom \
    -Dlogging.config=/opt/synchdb/config/logback.xml \
    -jar /opt/synchdb/bin/synchdb.jar \
    --config=/opt/synchdb/config/synchdb.yml

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
ReadWritePaths=/opt/synchdb/logs
ReadWritePaths=/opt/synchdb/checkpoint

LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable synchdb
sudo systemctl start synchdb
```

---

## 5. Vérification de SynchDB

```bash
# Health check
curl -s http://localhost:8080/health | jq .
# Attendu :
# {
#   "status": "UP",
#   "oracle": "connected",
#   "current_scn": 123456789,
#   "last_checkpoint_scn": 123456000,
#   "lag_seconds": 0.4
# }

# Statut détaillé
curl -s -H "X-API-Key: CHANGE_ME..." http://localhost:8080/status | jq .

# Lire les premiers changements
curl -s -H "X-API-Key: CHANGE_ME..." \
    "http://localhost:8080/changes?limit=5" | jq .

# Logs en temps réel
journalctl -u synchdb -f
```

### Format de réponse `/changes`

```json
{
  "changes": [
    {
      "event_id": "a3f8d2e1-b9c4-0712-8e5f-1a2b3c4d5e6f",
      "operation": "UPDATE",
      "database": "COREBANK",
      "schema": "BANK",
      "table": "CUSTOMER",
      "transaction_id": "8.23.918273",
      "scn": 123456789,
      "commit_scn": 123456799,
      "event_time": "2026-11-20T15:32:18Z",
      "commit_time": "2026-11-20T15:32:18.342Z",
      "primary_key": {"CUSTOMER_ID": "123456"},
      "before": {"STATUS": "ACTIVE", "CREDIT_LIMIT": 5000000},
      "after":  {"STATUS": "ACTIVE", "CREDIT_LIMIT": 8000000},
      "db_user": "APPUSER",
      "client_identifier": "USER123",
      "module": "CORE_BANKING",
      "action": "CUSTOMER_UPDATE",
      "client_ip": "10.10.20.15",
      "hostname": "APP01"
    }
  ],
  "count": 1,
  "next_scn": 123456800,
  "query_time_ms": 12
}
```

---

## 6. Configuration côté appliance

Dans `/opt/audit-appliance/config/appliance.env` :

```bash
# CDC Adapter
CDC_ADAPTER=synchdb
SYNCHDB_URL=http://localhost:8080        # ou http://synchdb-vm:8080
SYNCHDB_API_KEY=CHANGE_ME_GENERATE_SECURE_TOKEN
CDC_POLL_INTERVAL_MS=500
CDC_BATCH_SIZE=100

# Tables à capturer (liste séparée par virgules)
CDC_TABLES_FILTER=BANK.CUSTOMER,BANK.ACCOUNT,BANK.LOAN,BANK.TRANSACTION
```

Redémarrer le CDC de l'appliance :

```bash
sudo systemctl restart audit-cdc
# Vérifier la connexion
journalctl -u audit-cdc -f
```

---

## 7. Résolution des problèmes courants

### SynchDB ne se connecte pas à Oracle

```bash
# Tester la connectivité réseau
nc -zv oracle-host.internal 1521

# Tester la connexion JDBC (si sqlplus disponible)
sqlplus audit_cdc/MotDePasseFort123!@//oracle-host:1521/COREBANK

# Vérifier les droits Oracle
sqlplus audit_cdc/MotDePasseFort123!@//oracle-host:1521/COREBANK
SQL> SELECT COUNT(*) FROM V$LOG;
SQL> SELECT CURRENT_SCN FROM V$DATABASE;
```

### SCN trop ancien (ORA-01291)

```bash
# Ce message signifie que les REDO logs archivés ont été purgés
# avant que SynchDB puisse les lire.

# 1. Réinitialiser le checkpoint SynchDB
sudo systemctl stop synchdb
sudo rm /opt/synchdb/checkpoint/synchdb.checkpoint

# 2. Réinitialiser le checkpoint de l'appliance
sudo -u audit psql -d audit -c "
    UPDATE cdc_checkpoint
    SET last_scn = NULL, last_commit_scn = NULL, status = 'STOPPED'
    WHERE database_id = 1;
"
rm -f /var/lib/audit-appliance/checkpoints/checkpoint_1_synchdb.json

# 3. Redémarrer (SynchDB reprend depuis le SCN courant)
sudo systemctl start synchdb
sleep 5
sudo systemctl start audit-cdc
```

### Lag CDC élevé

```bash
# Vérifier le lag en temps réel
watch -n5 'curl -s http://localhost:8080/health | jq .lag_seconds'

# Augmenter la taille des batches si le débit est élevé
# Dans /opt/synchdb/config/synchdb.yml :
# cdc.batch_size: 1000
sudo systemctl restart synchdb

# Vérifier les performances Oracle (redo log I/O)
# SQL> SELECT * FROM V$LOG_HISTORY ORDER BY FIRST_TIME DESC FETCH FIRST 10 ROWS ONLY;
```

---

## 8. Remplacer SynchDB par un autre CDC

L'interface `CDCAdapter` permet de remplacer SynchDB sans modifier le moteur.

### Passage à Debezium

```bash
# 1. Installer Debezium Connect (sans Kafka — mode standalone)
# 2. Créer src/cdc/debezium.py qui implémente CDCAdapter
# 3. Modifier appliance.env :
CDC_ADAPTER=debezium
DEBEZIUM_URL=http://localhost:8083

# Le moteur d'audit ne change pas — seule l'implémentation change
```

### Mapping des adaptateurs disponibles

| Adaptateur | Variable | Statut |
|-----------|----------|--------|
| SynchDB | `CDC_ADAPTER=synchdb` | v1 — intégré |
| Debezium | `CDC_ADAPTER=debezium` | Prévu v2 |
| OpenLogReplicator | `CDC_ADAPTER=openlogreplicator` | Prévu v2 |
| GoldenGate | `CDC_ADAPTER=goldengate` | Enterprise |
