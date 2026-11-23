# Guide opérationnel

## Table des matières

1. [Démarrage et arrêt](#1-démarrage-et-arrêt)
2. [Surveillance quotidienne](#2-surveillance-quotidienne)
3. [Gestion du CDC](#3-gestion-du-cdc)
4. [Gestion des alertes](#4-gestion-des-alertes)
5. [Gestion des règles de risque](#5-gestion-des-règles-de-risque)
6. [Archivage et rétention](#6-archivage-et-rétention)
7. [Backup et restauration](#7-backup-et-restauration)
8. [Résolution des problèmes courants](#8-résolution-des-problèmes-courants)
9. [Logs et traces](#9-logs-et-traces)
10. [Capacité et dimensionnement](#10-capacité-et-dimensionnement)

---

## 1. Démarrage et arrêt

### Démarrage complet

```bash
# Ordre recommandé
sudo systemctl start postgresql
sleep 3
sudo systemctl start audit-engine audit-api
sleep 5
sudo systemctl start audit-cdc
sudo systemctl start nginx

# Vérification
sudo systemctl status audit-cdc audit-engine audit-api postgresql nginx
```

### Arrêt propre

```bash
# Arrêter le CDC en premier (finalise le checkpoint en cours)
sudo systemctl stop audit-cdc
sleep 5
sudo systemctl stop audit-engine audit-api
sudo systemctl stop nginx
# PostgreSQL : arrêt uniquement si nécessaire
sudo systemctl stop postgresql
```

### Redémarrage d'urgence

```bash
sudo systemctl restart audit-cdc audit-engine audit-api
```

---

## 2. Surveillance quotidienne

### Dashboard de santé

```bash
# Santé globale
curl -sk https://localhost/api/v1/health/detail | jq '{
    overall: .status,
    cdc_lag: .checks.cdc_lag_seconds,
    disk_free_gb: .checks.disk_free_gb,
    postgresql: .checks.postgresql,
    integrity: .checks.integrity_ok
}'
```

### Métriques clés à surveiller

| Métrique | Seuil alerte | Seuil critique |
|----------|-------------|----------------|
| CDC lag | > 30 s | > 300 s |
| Disque libre | < 20 GB | < 5 GB |
| RAM utilisée | > 85 % | > 95 % |
| Événements échoués | > 10/h | > 100/h |
| Alertes ouvertes | > 20 | > 100 |

### Rapport quotidien automatique

Le rapport quotidien est généré chaque matin à 06:00 par le timer systemd
et envoyé à l'email configuré. Pour le déclencher manuellement :

```bash
TOKEN=$(curl -ks -X POST https://localhost/api/v1/auth/token \
    -d "username=admin&password=VotreMotDePasse" | jq -r .access_token)

curl -ks -X POST https://localhost/api/v1/reports/run \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"report_type":"DAILY_AUDIT","format":"PDF"}'
```

---

## 3. Gestion du CDC

### Vérifier l'état du CDC

```bash
curl -ks -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/cdc/status | jq '.[] | {
        database: .database_name,
        status: .status,
        lag_s: .lag_seconds,
        last_scn: .last_commit_scn,
        updated: .updated_at
    }'
```

### Mettre le CDC en pause (maintenance Oracle)

```bash
# Pause — le checkpoint est conservé, reprise depuis le dernier SCN
curl -ks -X POST "https://localhost/api/v1/cdc/pause?database_id=1" \
    -H "Authorization: Bearer $TOKEN"

# Vérifier la pause
curl -ks -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/cdc/status | jq '.[0].status'
# Attendu : "PAUSED"
```

### Reprendre le CDC

```bash
curl -ks -X POST "https://localhost/api/v1/cdc/resume?database_id=1" \
    -H "Authorization: Bearer $TOKEN"
```

### Réinitialiser le checkpoint (après perte de REDO logs)

> ⚠️ **Attention :** cette opération peut provoquer des événements manqués
> si les REDO logs ont été purgés avant d'être capturés.

```bash
# Arrêter le CDC
sudo systemctl stop audit-cdc

# Réinitialiser le checkpoint dans PostgreSQL
sudo -u audit psql -d audit -c "
    UPDATE cdc_checkpoint
    SET last_scn = NULL, last_commit_scn = NULL, status = 'STOPPED'
    WHERE database_id = 1;
"

# Supprimer le fichier local de checkpoint
rm -f /var/lib/audit-appliance/checkpoints/checkpoint_1_synchdb.json

# Redémarrer (reprise depuis le SCN courant)
sudo systemctl start audit-cdc
```

### Lag CDC élevé — procédure de rattrapage

```bash
# 1. Vérifier la cause
journalctl -u audit-cdc --since "1 hour ago" | grep -E "(ERROR|WARN)"

# 2. Vérifier la consommation réseau Oracle → SynchDB
ss -s

# 3. Augmenter temporairement la taille des batches
# Dans /opt/audit-appliance/config/appliance.env :
# CDC_BATCH_SIZE=500   (défaut: 100)
sudo systemctl restart audit-cdc

# 4. Surveiller le rattrapage
watch -n5 'curl -sk -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/cdc/status | jq ".[0].lag_seconds"'
```

---

## 4. Gestion des alertes

### Lister les alertes ouvertes

```bash
curl -ks -H "Authorization: Bearer $TOKEN" \
    "https://localhost/api/v1/alerts?status=OPEN&sort_by=alert_time&sort_dir=desc" \
    | jq '.items[] | {id, severity, title, alert_time}'
```

### Acquitter une alerte

```bash
curl -ks -X PATCH "https://localhost/api/v1/alerts/42" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"ACKNOWLEDGED","notes":"Vérifié avec le responsable applicatif — changement autorisé"}'
```

### Statuts d'alerte disponibles

| Statut | Usage |
|--------|-------|
| `OPEN` | Alerte créée, non traitée |
| `ACKNOWLEDGED` | Prise en compte, en cours d'investigation |
| `RESOLVED` | Traitée et clôturée |
| `FALSE_POSITIVE` | Alerte non pertinente — règle à affiner |

---

## 5. Gestion des règles de risque

### Lister les règles actives

```bash
curl -ks -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/rules | jq '.[] | {id, name, risk_score_add, risk_level_min}'
```

### Créer une nouvelle règle

```bash
# Exemple : alerte sur modification du salaire > 20%
curl -ks -X POST https://localhost/api/v1/rules \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "name": "Augmentation salaire > 20%",
        "description": "Toute modification du salaire supérieure à 20%",
        "rule_type": "VALUE_CHANGE",
        "conditions": {
            "type": "VALUE_CHANGE",
            "column": "SALARY",
            "threshold_pct": 20,
            "direction": "increase"
        },
        "risk_score_add": 50,
        "risk_level_min": "HIGH",
        "generate_alert": true,
        "priority": 15
    }'
```

### Désactiver une règle temporairement

```bash
curl -ks -X PUT https://localhost/api/v1/rules/5 \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"is_active": false}'
```

### Recharger les règles sans redémarrage

Les règles sont rechargées automatiquement toutes les 60 secondes.
Pour un rechargement immédiat :

```bash
curl -ks -X POST https://localhost/api/v1/rules/reload \
    -H "Authorization: Bearer $TOKEN"
```

---

## 6. Archivage et rétention

### État de l'archivage

```bash
curl -ks -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/archive/jobs | jq '.[-5:] | .[] | {
        partition: .partition_name,
        status: .status,
        events: .event_count,
        path: .archive_path,
        started: .started_at
    }'
```

### Déclencher un archivage manuel

```bash
curl -ks -X POST https://localhost/api/v1/archive/run \
    -H "Authorization: Bearer $TOKEN"
```

### Vérifier un fichier archive

```bash
# Télécharger et vérifier l'intégrité d'un fichier Parquet archivé
sha256sum /mnt/archive/2026/09/audit_event_2026_09.parquet
# Comparer avec audit_archive_job.archive_hash dans PostgreSQL

# Lire le contenu d'un fichier archive
python3 -c "
import pyarrow.parquet as pq
table = pq.read_table('/mnt/archive/2026/09/audit_event_2026_09.parquet')
print(f'Rows: {table.num_rows}')
print(table.schema)
print(table.to_pandas().head())
"
```

### Politique de rétention par table

```bash
# Modifier la rétention d'une table spécifique
sudo -u audit psql -d audit -c "
    INSERT INTO audit_retention_policy
        (policy_name, database_id, schema_name, table_name, hot_days, warm_days, cold_days)
    VALUES
        ('TRANSACTION_EXTENDED', 1, 'BANK', 'TRANSACTION', 180, 730, 3650)
    ON CONFLICT DO NOTHING;
"
```

---

## 7. Backup et restauration

### Backup manuel

```bash
sudo bash /opt/audit-appliance/bin/appliance-backup.sh
```

### Vérifier les backups existants

```bash
# Backups locaux
ls -lh /mnt/backup/

# Vérifier l'intégrité d'un backup
cd /mnt/backup/20261120_010000
sha256sum --check postgresql/SHA256SUMS
```

### Restauration complète

Voir [BACKUP_RESTORE.md](BACKUP_RESTORE.md) pour la procédure détaillée.

```bash
# Sur une nouvelle VM après installation du système de base
sudo bash /opt/audit-appliance/bin/appliance-restore.sh \
    --source /mnt/backup/20261120_010000 \
    --key "dK7mP2xQnR9vL4hT8yF1wS6cA3bN5uE0..."
```

---

## 8. Résolution des problèmes courants

### Le CDC ne se connecte pas à SynchDB

```bash
# Vérifier la connectivité
curl -v http://synchdb-host:8080/health

# Vérifier les logs CDC
journalctl -u audit-cdc --since "30 min ago" | grep -E "(ERROR|CDCConnectionError)"

# Vérifier la configuration
cat /opt/audit-appliance/config/appliance.env | grep SYNCHDB
```

### L'interface web ne répond pas

```bash
# Vérifier Nginx
sudo systemctl status nginx
sudo nginx -t

# Vérifier l'API
sudo systemctl status audit-api
curl -v http://localhost:8000/api/v1/health

# Vérifier les ports
ss -tlnp | grep -E "(443|8000)"
```

### PostgreSQL : connexions refusées

```bash
# Vérifier l'état de PostgreSQL
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT COUNT(*) FROM pg_stat_activity;"

# Vérifier la saturation des connexions
sudo -u postgres psql -c "
    SELECT state, COUNT(*)
    FROM pg_stat_activity
    GROUP BY state;
"

# Si max_connections atteint :
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE state = 'idle'
    AND query_start < now() - interval '10 minutes';"
```

### Disque plein

```bash
# Identifier ce qui consomme de l'espace
du -sh /var/lib/postgresql /var/lib/audit-appliance /opt/audit-appliance

# Libérer l'espace des REDO WAL archivés anciens (si PostgreSQL)
find /var/lib/audit-appliance/pg_archive -mtime +7 -delete

# Déclencher l'archivage immédiat des anciennes partitions PostgreSQL
curl -ks -X POST https://localhost/api/v1/archive/run \
    -H "Authorization: Bearer $TOKEN"

# Vérifier la taille des tables PostgreSQL
sudo -u audit psql -d audit -c "
    SELECT schemaname, tablename,
           pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    LIMIT 20;
"
```

### Vérification d'intégrité échouée

```bash
# Identifier l'événement corrompu
curl -ks -X POST https://localhost/api/v1/integrity/verify \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"database_id":1,"schema_name":"BANK","table_name":"CUSTOMER"}' | jq '{
        ok,
        error_at_id,
        error_message,
        events_checked
    }'

# En cas d'échec : NE PAS modifier les données
# Contacter l'équipe sécurité et déclencher la procédure forensique
# Les backups pre-incident permettront de dater la compromission
```

### Événements dupliqués excessifs

```bash
# Vérifier le checkpoint CDC
sudo -u audit psql -d audit -c "
    SELECT last_scn, last_commit_scn, status, updated_at
    FROM cdc_checkpoint;
"

# Si le checkpoint n'est pas à jour : forcer un redémarrage propre du CDC
sudo systemctl stop audit-cdc
sleep 10
sudo systemctl start audit-cdc

# Surveiller le compteur de doublons
watch -n10 'curl -sk -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/health/detail | jq .events_duplicated'
```

---

## 9. Logs et traces

### Accéder aux logs

```bash
# Logs en temps réel
journalctl -u audit-api    -f --output=json | jq .
journalctl -u audit-engine -f --output=json | jq .
journalctl -u audit-cdc    -f --output=json | jq .

# Logs des dernières 24h avec filtre erreur
journalctl -u audit-engine --since "24 hours ago" \
    --output=json | jq 'select(.PRIORITY <= "3")' | jq .MESSAGE
```

### Rotation des logs

Les logs systemd (journald) sont configurés pour conserver :
- Maximum 500 MB de logs
- Maximum 30 jours d'historique

Configuration dans `/etc/systemd/journald.conf` :

```ini
[Journal]
SystemMaxUse=500M
MaxRetentionSec=2592000
```

### Exporter les logs pour analyse externe

```bash
# Export JSON des logs du moteur d'audit (1h)
journalctl -u audit-engine --since "1 hour ago" --output=json \
    > /tmp/audit-engine-$(date +%Y%m%d_%H%M).jsonl

# Exporter vers un SIEM
journalctl -u audit-engine -f --output=json | \
    nc siem-host 5044   # exemple Logstash/Beats
```

---

## 10. Capacité et dimensionnement

### Estimation du volume de stockage

```
Volume PostgreSQL (hot tier, 90 jours) :
  = events/jour × 90 × 2 KB (taille moyenne par événement)

Exemple : 1 million d'événements/jour
  = 1 000 000 × 90 × 2 KB = ~180 GB

Volume archive Parquet (compression ~8:1 vs JSON) :
  = 180 GB / 8 × (nombre_années × 12 mois / 3)
  = ~7.5 GB/an pour 1M events/jour
```

### Surveiller la croissance du stockage

```bash
# Croissance quotidienne
sudo -u audit psql -d audit -c "
    SELECT
        date_trunc('day', event_time) AS day,
        COUNT(*) AS events,
        pg_size_pretty(SUM(pg_column_size(before_data) +
                           pg_column_size(after_data))) AS data_size
    FROM audit_event
    WHERE event_time >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY 1 ORDER BY 1;
"
```

### Alertes de capacité

Configurer des alertes automatiques dans le fichier de configuration :

```bash
# Dans /opt/audit-appliance/config/appliance.env
DISK_ALERT_THRESHOLD_GB=20     # Alerte si espace libre < 20 GB
DISK_CRITICAL_THRESHOLD_GB=5   # Critique si < 5 GB
CDC_LAG_ALERT_SECONDS=30       # Alerte si lag CDC > 30s
CDC_LAG_CRITICAL_SECONDS=300   # Critique si lag > 5 min
```
