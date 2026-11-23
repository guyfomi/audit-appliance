# Architecture technique

## 1. Vue d'ensemble

L'appliance est un **modular monolith** déployable sur une seule VM Linux.
Chaque module est isolé dans son propre package Python mais s'exécute
dans le même processus, ce qui simplifie le déploiement et l'exploitation.

```
┌─────────────────────────────────────────────────────────┐
│              Oracle Data Audit & Forensics               │
│                    Appliance (1 VM)                      │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │                   Web UI (Nginx)                 │    │
│  │          React + TypeScript + MUI + AG Grid      │    │
│  └───────────────────────┬─────────────────────────┘    │
│                          │ HTTPS                        │
│  ┌───────────────────────▼─────────────────────────┐    │
│  │               Audit API (FastAPI)                │    │
│  │          JWT · RBAC · Rate limit 60/min          │    │
│  └───────────────────────┬─────────────────────────┘    │
│                          │                              │
│  ┌───────────────────────▼─────────────────────────┐    │
│  │               Audit Engine                       │    │
│  │  Ingest→Dedup→Normalize→Enrich→Risk→Hash→Persist │    │
│  └──────────┬──────────────────────┬───────────────┘    │
│             │                      │                    │
│  ┌──────────▼──────┐    ┌──────────▼───────────────┐    │
│  │  PostgreSQL 16  │    │   Archive Worker          │    │
│  │  (partitionné   │    │   Parquet/JSONL           │    │
│  │   par mois)     │    │   → MinIO/S3/filesystem   │    │
│  └─────────────────┘    └──────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │                 CDC Adapter                       │    │
│  │  SynchDB (v1) · Debezium · OpenLogReplicator     │    │
│  │  GoldenGate (Enterprise)                         │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
              │
              │ REDO logs / supplemental logging
              ▼
     Oracle Database (source)
```

---

## 2. Principe d'abstraction CDC

Le cœur du système ne connaît jamais le format natif de SynchDB.
L'interface `CDCAdapter` est le seul point de contact :

```python
class CDCAdapter(ABC):
    async def connect() -> None
    async def events() -> AsyncIterator[CDCEvent]
    async def commit(position: str) -> None
    async def status() -> AdapterHealth
    async def pause() -> None
    async def resume() -> None
    async def close() -> None
```

Remplacer SynchDB par Debezium = créer `debezium.py` qui implémente
`CDCAdapter` → zéro modification dans le moteur d'audit.

---

## 3. Pipeline de traitement d'un événement

```
Oracle REDO
    │
    ▼  poll(500ms)
CDCEvent (normalisé)
    │
    ▼  ① INGEST
audit_raw_event ← écriture immédiate avant tout traitement
    │
    ▼  ② DEDUP
idempotency_key = SHA256(source|db|txn_id|scn|schema|table|pk|op)
Doublon ? → mark_duplicate + commit SCN + return
    │
    ▼  ③ NORMALIZE
CDCEvent → AuditEvent
Masquage colonnes sensibles (PARTIAL / FULL / HASH / REDACT)
ColumnValue.source = CAPTURED | RECONSTRUCTED | UNAVAILABLE
    │
    ▼  ④ ENRICH
db_user_id  → audit_db_user (upsert, last_seen_at)
application_id → audit_application (upsert)
    │
    ▼  ⑤ RISK SCORING
Évaluation de toutes les règles actives (par priorité)
risk_score = Σ(score_add) plafonné à 100
risk_level = max(niveau_calculé, niveau_min_règles_déclenchées)
    │
    ▼  ⑥ INTEGRITY HASH
previous_hash = dernier hash de (database, schema, table)
event_hash = SHA256(canonical_json + previous_hash)
    │
    ▼  ⑦ PERSIST (transaction PostgreSQL atomique)
audit_event + audit_event_risk_detail
ON CONFLICT (idempotency_key, event_time) DO NOTHING
    │
    ├── asyncio.create_task(alerting) ← non-bloquant
    │
    ▼  ⑧ COMMIT
adapter.commit(source_position) → checkpoint persiste
```

**Garantie de livraison :**
- `commit()` est appelé **uniquement** après écriture PostgreSQL confirmée
- En cas d'exception → `mark_failed` + pas de `commit()` → replay au redémarrage

---

## 4. Modèle de données (résumé)

### Tables principales

| Table | Rôle | Partitionnement |
|-------|------|-----------------|
| `audit_event` | Événements d'audit normalisés | Par mois (`event_time`) |
| `audit_raw_event` | Événements bruts CDC | Aucun |
| `audit_transaction` | Transactions regroupées | Aucun |
| `audit_event_risk_detail` | Détail des règles déclenchées | Aucun |
| `audit_alert` | Alertes générées | Aucun |
| `audit_integrity_checkpoint` | Ancres de la chaîne SHA-256 | Aucun |
| `audit_idempotency_key` | Clés de déduplication | Aucun |
| `cdc_checkpoint` | Position CDC par source | Aucun |
| `admin_audit_event` | Audit des actions admin | Aucun |

### JSONB utilisé pour

- `primary_key` : clé primaire de l'enregistrement modifié
- `before_data` : valeurs avant modification (indexé GIN)
- `after_data` : valeurs après modification (indexé GIN)
- `conditions` dans `audit_rule` : structure des règles de risque

---

## 5. Stratégie d'idempotence

La clé de déduplication est un SHA-256 de :
```
source_adapter | database | transaction_id | scn | schema | table | json(primary_key) | operation
```

Double protection :
1. Table `audit_idempotency_key` avec index UNIQUE → rejet applicatif
2. `ON CONFLICT (idempotency_key, event_time) DO NOTHING` → rejet base de données

---

## 6. Stratégie d'intégrité (chaîne SHA-256)

Chaque événement enchaîne avec le précédent **pour la même table** :

```
event_hash = SHA256(
    json({
        event_id, operation, event_time,
        transaction_id, primary_key,
        before_data, after_data,
        db_user_id, client_ip
    }, sort_keys=True)
    +
    previous_event_hash  (ou "GENESIS" pour le premier)
)
```

Des checkpoints périodiques ancrent la chaîne dans `audit_integrity_checkpoint`.
La vérification relit tous les événements et recalcule la chaîne.

---

## 7. Niveaux de risque

| Score | Niveau | Exemples |
|-------|--------|----------|
| 0–24 | LOW | Modification routine par un compte applicatif de confiance |
| 25–49 | MEDIUM | Hors heures ouvrées, table sensible |
| 50–74 | HIGH | Augmentation limite crédit > 50%, utilisateur inhabituel |
| 75–100 | CRITICAL | DELETE sur table critique, cumul de facteurs |

---

## 8. RBAC

```
ADMIN    → toutes les permissions
  │
  ├── AUDITOR → lecture + intégrité + contrôle CDC
  │       │
  │       └── ANALYST → lecture + acquittement alertes
  │               │
  │               └── READONLY → lecture seule
```

---

## 9. Rétention des données

```
PostgreSQL HOT (0–90 jours)
    │  Partition détachée automatiquement
    ▼
PostgreSQL WARM (91–365 jours)
    │  Export Parquet + upload object store
    ▼
Archive COLD (>365 jours)
    Parquet compressé (Snappy) — schéma Arrow figé
    JSONL.gz — format lisible/portable
```

Règle de sécurité : les événements CRITICAL et HIGH ne sont jamais
purgés en dessous d'un seuil configurable (`min_risk_keep`).

---

## 10. Évolution vers HA (sans réécriture)

L'architecture standard est mono-nœud.
L'évolution vers HA s'effectue en ajoutant des composants
**sans modifier le cœur applicatif** :

```
Standard (1 VM)         →    HA Enterprise
─────────────────────────────────────────────
PostgreSQL single        →    Primary + Standby (streaming replication)
Filesystem archive       →    MinIO cluster (3 nœuds)
SynchDB embedded         →    CDC Node dédié (SynchDB ou Debezium)
Single Uvicorn           →    Plusieurs instances derrière load balancer
systemd timers           →    Maintenu (timers sur nœud primaire)
```
