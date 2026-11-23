# Backup et restauration

## Vue d'ensemble

L'appliance maintient trois flux de sauvegarde indépendants :

```
PostgreSQL (audit data)   →  pg_basebackup quotidien   →  Backup storage
Configuration (settings)  →  Export JSON chiffré AES-256 →  Backup storage
Archives Parquet           →  rsync / S3 sync continu    →  Object storage
```

Une restauration complète nécessite les trois composants
**plus** la clé de chiffrement backup (générée au setup).

---

## 1. Configuration du backup

### 1.1 Fichier de configuration

Éditer `/opt/audit-appliance/config/backup.env` :

```bash
# Destination : local | nfs | s3
BACKUP_DEST=local

# Destination locale ou NFS
BACKUP_LOCAL_PATH=/mnt/backup

# Destination S3 / MinIO (si BACKUP_DEST=s3)
BACKUP_S3_ENDPOINT=http://minio.internal:9000
BACKUP_S3_BUCKET=audit-backup
BACKUP_S3_ACCESS_KEY=minioadmin
BACKUP_S3_SECRET_KEY=minioadmin

# Clé de chiffrement AES-256 (générée au setup — NE PAS PERDRE)
BACKUP_ENCRYPT_KEY=dK7mP2xQnR9vL4hT8yF1wS6cA3bN5uE0...

# Token API pour l'export de configuration
BACKUP_API_TOKEN=eyJhbGciOiJIUzI1NiJ9...

# PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_USER=audit_backup
PG_DB=audit
```

```bash
chmod 600 /opt/audit-appliance/config/backup.env
```

### 1.2 Montage NFS (si applicable)

```bash
# /etc/fstab
nfs-server.internal:/backup/audit  /mnt/backup  nfs  defaults,_netdev  0  0

sudo mount -a
sudo mkdir -p /mnt/backup
```

### 1.3 Vérifier les timers systemd

```bash
systemctl list-timers | grep audit
# audit-backup.timer    →  daily at 01:00
# audit-archive.timer   →  daily at 02:00
# audit-partition.timer →  weekly on Monday
```

---

## 2. Backup manuel

```bash
sudo bash /opt/audit-appliance/bin/appliance-backup.sh

# Suivi en temps réel
journalctl -u audit-backup -f
```

**Contenu d'un backup réussi :**

```
/mnt/backup/20261120_010000/
├── postgresql/
│   ├── base.tar.gz          ← données PostgreSQL complètes
│   ├── pg_wal.tar.gz        ← WAL segments
│   └── SHA256SUMS           ← hash de vérification
└── config_20261120_010000.enc  ← configuration chiffrée AES-256
```

---

## 3. Vérification de l'intégrité d'un backup

```bash
# Vérifier les hashs PostgreSQL
cd /mnt/backup/20261120_010000
sha256sum --check postgresql/SHA256SUMS
# Attendu : postgresql/base.tar.gz: OK

# Vérifier que la configuration est déchiffrable
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -d \
    -pass "pass:VOTRE_CLE" \
    -in config_20261120_010000.enc \
    -out /tmp/config_test.json
cat /tmp/config_test.json | jq .version
shred -u /tmp/config_test.json
```

---

## 4. Procédure de restauration complète

### 4.1 Prérequis

- Nouvelle VM avec Ubuntu 22.04/24.04 installé
- Logiciel appliance installé (`install.sh` exécuté — **sans** `setup-wizard.sh`)
- Accès au backup (NFS monté, S3 accessible, ou fichiers copiés)
- Clé de chiffrement backup

### 4.2 Restauration automatique

```bash
# Sur la nouvelle VM
sudo bash /opt/audit-appliance/bin/appliance-restore.sh \
    --source /mnt/backup/20261120_010000 \
    --key "dK7mP2xQnR9vL4hT8yF1wS6cA3bN5uE0..."

# Depuis S3
sudo bash /opt/audit-appliance/bin/appliance-restore.sh \
    --source s3://audit-backup/backups/20261120_010000 \
    --key "dK7mP2xQnR9vL4hT8yF1wS6cA3bN5uE0..."
```

### 4.3 Étapes de la restauration (détail)

Le script effectue dans l'ordre :

```
① Téléchargement du backup (si source distante)
② Vérification SHA-256 des fichiers PostgreSQL
③ Confirmation interactive (⚠️ action destructive)
④ Arrêt des services applicatifs (CDC, Engine, API)
⑤ Arrêt de PostgreSQL
⑥ Remplacement du répertoire de données PostgreSQL
⑦ Décompression de base.tar.gz + pg_wal.tar.gz
⑧ Redémarrage de PostgreSQL + attente readiness
⑨ Déchiffrement de la configuration (AES-256)
⑩ Import de la configuration via l'API d'initialisation
⑪ Redémarrage de tous les services
⑫ Health check post-restauration
```

### 4.4 Vérification post-restauration

```bash
# Santé globale
curl -sk https://localhost/api/v1/health | jq .status

# Compter les événements (doit correspondre au moment du backup)
curl -sk -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/dashboard | jq .total_events

# Vérifier l'intégrité de la chaîne
curl -sk -X POST https://localhost/api/v1/integrity/verify \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"database_id":1,"schema_name":"BANK","table_name":"CUSTOMER"}' \
    | jq .ok

# Redémarrer le CDC (il reprendra depuis le dernier SCN connu)
sudo systemctl start audit-cdc
```

---

## 5. Restauration partielle (configuration uniquement)

Si seule la configuration doit être restaurée (sans les données d'audit) :

```bash
# Déchiffrer la configuration
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -d \
    -pass "pass:VOTRE_CLE" \
    -in /mnt/backup/20261120_010000/config_20261120_010000.enc \
    -out /tmp/config_restore.json

# Importer via l'API
TOKEN=$(curl -s -X POST https://localhost/api/v1/auth/token \
    -d "username=admin&password=TempPassword" | jq -r .access_token)

curl -s -X POST https://localhost/api/v1/admin/config/import \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @/tmp/config_restore.json

# Nettoyer
shred -u /tmp/config_restore.json
```

---

## 6. Test de restauration (simulation)

**Recommandé : effectuer un test trimestriel.**

```bash
# 1. Sur une VM de test, installer l'appliance
sudo bash install/install.sh

# 2. Restaurer depuis le dernier backup de production
sudo bash bin/appliance-restore.sh \
    --source /mnt/backup/$(ls /mnt/backup | sort | tail -1) \
    --key "$BACKUP_KEY"

# 3. Vérifications
curl -sk https://localhost/api/v1/health/detail | jq .
curl -sk -H "Authorization: Bearer $TOKEN" \
    https://localhost/api/v1/dashboard | jq .total_events

# 4. Consigner le résultat
echo "$(date -u) — Restore test OK — $(jq .total_events <<< $result) events" \
    >> /var/log/restore-tests.log
```

---

## 7. Rotation et rétention des backups

Les backups locaux sont automatiquement rotés :
- **Local / NFS :** 30 derniers backups quotidiens conservés
- **S3 / MinIO :** Lifecycle policy recommandée — 90 jours en S3 Standard, puis Glacier

```bash
# Configurer le lifecycle MinIO
mc ilm add audit-backup/backups \
    --expiry-days 90 \
    --transition-days 30 \
    --transition-storage-class GLACIER
```

---

## 8. Checklist DR (Disaster Recovery)

| Vérification | Fréquence | Responsable |
|-------------|-----------|-------------|
| Backup quotidien exécuté sans erreur | Quotidien | Supervision automatique |
| Intégrité SHA-256 des fichiers backup | Hebdomadaire | Script de vérification |
| Test de restauration sur VM isolée | Trimestriel | Équipe ops |
| Clé de chiffrement backup accessible | Semestriel | RSSI |
| Documentation DR à jour | Annuel | Équipe ops |
