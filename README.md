# Oracle Data Audit & Forensics Appliance

> **Qui a modifié quoi, quand, depuis où — et quelle était la valeur avant et après ?**

Appliance virtuelle de sécurité, d'audit et de forensic permettant aux entreprises de surveiller et d'historiser en temps réel les modifications effectuées sur leurs données Oracle sensibles.

---

## Positionnement produit

```
Database Audit
+  Data Change Tracking
+  Before/After History
+  Forensics
+  Risk Detection
+  Immutable Evidence
```

**Destinataires :** DSI · DBA · RSSI · Auditeurs · Équipes SOC · Responsables conformité

---

## Architecture

```
Oracle Database
      │  CDC / REDO logs
      ▼
CDC Adapter (SynchDB v1 — interchangeable)
      │  CDCEvent normalisé
      ▼
Audit Engine (modular monolith)
  ├── Ingest & Raw storage
  ├── Idempotence (déduplication)
  ├── Normalization
  ├── Enrichment
  ├── Risk scoring
  ├── Integrity hashing (SHA-256 chain)
  ├── Alerting
  └── Archive & Retention
      │
      ▼
PostgreSQL 16 (partitionné par mois)
      │
      ├── Audit API (FastAPI)
      │       └── Web UI (React + MUI + AG Grid)
      │
      └── Archive Worker
              └── Parquet / JSONL → MinIO / S3 / Filesystem
```

**Contraintes absolues respectées :**
- Pas de Kafka · Pas de Kubernetes · Pas de cloud obligatoire
- CDC interchangeable (SynchDB → Debezium → GoldenGate sans toucher au moteur)
- Single VM — tout tient sur Ubuntu 22.04/24.04
- Événements append-only, idempotents, cryptographiquement vérifiables

---

## Prérequis système

| Ressource | Minimum | Recommandé |
|-----------|---------|------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 4 vCPU | 8 vCPU |
| RAM | 8 GB | 16 GB |
| Disque | 50 GB | 200 GB+ |
| Réseau | 100 Mbit/s | 1 Gbit/s |

**Oracle côté source :**
- Oracle 11g R2 minimum (12c+ recommandé)
- Supplemental logging activé : `ALTER DATABASE ADD SUPPLEMENTAL LOG DATA;`
- Utilisateur CDC avec droits `LOGMINING` ou équivalent SynchDB

---

## Installation rapide

```bash
# 1. Cloner ou décompresser l'appliance
git clone https://github.com/votre-org/audit-appliance.git /opt/audit-appliance
cd /opt/audit-appliance

# 2. Installation système (en tant que root)
sudo bash install/install.sh

# 3. Assistant de configuration (10 étapes)
sudo bash install/setup-wizard.sh

# 4. Ouvrir l'interface
# https://<IP_DE_LA_VM>
```

Voir [docs/INSTALLATION.md](docs/INSTALLATION.md) pour le guide complet.

---

## Structure du projet

```
audit-appliance/
├── README.md                   ← ce fichier
├── docs/
│   ├── INSTALLATION.md         ← guide d'installation détaillé
│   ├── ARCHITECTURE.md         ← architecture technique
│   ├── OPERATIONS.md           ← guide opérationnel
│   ├── API.md                  ← référence API REST
│   └── BACKUP_RESTORE.md       ← procédures backup/restore
├── install/
│   ├── install.sh              ← installation système
│   └── setup-wizard.sh         ← assistant de configuration
├── systemd/                    ← units systemd
├── nginx/                      ← configuration reverse proxy
├── src/                        ← code source Python
│   ├── cdc/                    ← CDC Adapter
│   ├── engine/                 ← Audit Engine
│   ├── api/                    ← REST API (FastAPI)
│   ├── db/                     ← modèle PostgreSQL
│   └── monitoring/             ← health & metrics
├── tests/
│   ├── load/                   ← tests de charge
│   └── resilience/             ← tests de résilience
├── packer/                     ← build OVA/QCOW2
└── config/                     ← templates de configuration
```

---

## Flux d'un événement d'audit

```
Oracle REDO log
    │
    ▼  (SynchDB poll every 500ms)
audit_raw_event  ← stockage immédiat avant tout traitement
    │
    ▼  (idempotence check — clé SHA-256 composite)
    │  Doublon ? → discard + log, commit SCN quand même
    │
    ▼  (normalize → AuditEvent)
    │  Masquage colonnes sensibles appliqué ici
    │
    ▼  (enrich → résolution user/app)
    │
    ▼  (risk scoring — règles PostgreSQL)
    │  Score 0–100, niveau LOW/MEDIUM/HIGH/CRITICAL
    │
    ▼  (integrity hash — SHA-256 chain par table)
    │  event_hash = SHA256(canonical_data + previous_hash)
    │
    ▼  (persist → audit_event)
    │  Transaction PostgreSQL atomique
    │
    ├── audit_event_risk_detail
    └── audit_alert (si règle trigger)
    │
    ▼  commit(scn) → CDC adapter checkpoint
```

---

## Réponses forensiques

Le produit répond aux questions :

| Question | Source |
|----------|--------|
| Qui a modifié ? | `db_username` + `app_user` + `client_identifier` |
| Quand ? | `event_time` + `commit_time` |
| Quelle donnée ? | `schema_name.table_name` + `primary_key` |
| Valeur avant ? | `before_data` (JSONB) |
| Valeur après ? | `after_data` (JSONB) |
| Quelle transaction ? | `transaction_id` + `scn` |
| Depuis quelle app ? | `module` + `action` |
| Depuis quelle IP ? | `client_ip` (inet) |
| Modification suspecte ? | `risk_score` + `risk_level` + `risk_reasons` |
| Autres modifs dans la transaction ? | Transaction Explorer |
| L'audit a-t-il été falsifié ? | `Verify Audit Integrity` (SHA-256 chain) |

---

## Licence

Propriétaire — usage interne uniquement.
