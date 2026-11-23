# Référence API REST

Base URL : `https://<appliance-host>/api/v1`

Authentification : Bearer JWT — obtenu via `POST /auth/token`

---

## Authentification

### POST /auth/token

Obtenir un token JWT.

**Request** (`application/x-www-form-urlencoded`)

| Champ | Type | Description |
|-------|------|-------------|
| `username` | string | Nom d'utilisateur |
| `password` | string | Mot de passe |

**Response 200**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiJ9...",
  "token_type": "bearer",
  "expires_in": 28800,
  "role": "ADMIN"
}
```

**Exemple**

```bash
TOKEN=$(curl -s -X POST https://host/api/v1/auth/token \
  -d "username=admin&password=secret" | jq -r .access_token)
```

---

## Événements

### GET /events

Liste paginée des événements d'audit.

**Query parameters**

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | int | 1 | Numéro de page |
| `page_size` | int | 50 | Éléments par page (max 500) |

**Response 200**

```json
{
  "total": 284931,
  "page": 1,
  "page_size": 50,
  "pages": 5699,
  "items": [
    {
      "id": 9827362,
      "event_id": "a3f8d2e1-b9c4-0712-...",
      "event_time": "2026-11-20T15:32:18Z",
      "database_name": "COREBANK",
      "schema_name": "BANK",
      "table_name": "CUSTOMER",
      "operation": "UPDATE",
      "db_username": "APPUSER",
      "app_user": "USER123",
      "client_ip": "10.10.20.15",
      "risk_score": 87,
      "risk_level": "CRITICAL",
      "changed_columns": ["CREDIT_LIMIT"]
    }
  ]
}
```

---

### GET /events/{id}

Détail complet d'un événement.

**Response 200**

```json
{
  "id": 9827362,
  "event_id": "a3f8d2e1-b9c4-0712-...",
  "event_time": "2026-11-20T15:32:18Z",
  "commit_time": "2026-11-20T15:32:18.342Z",
  "database_name": "COREBANK",
  "schema_name": "BANK",
  "table_name": "CUSTOMER",
  "operation": "UPDATE",
  "transaction_id": "8.23.918273",
  "scn": 123456789,
  "commit_scn": 123456799,
  "primary_key": {"CUSTOMER_ID": "123456"},
  "before_data": {"CREDIT_LIMIT": 5000000, "STATUS": "ACTIVE"},
  "after_data":  {"CREDIT_LIMIT": 8000000, "STATUS": "ACTIVE"},
  "changed_columns": ["CREDIT_LIMIT"],
  "db_username": "APPUSER",
  "app_user": "USER123",
  "client_identifier": "USER123",
  "application_name": "CORE_BANKING",
  "client_ip": "10.10.20.15",
  "hostname": "APP01",
  "module": "CORE_BANKING",
  "action": "CUSTOMER_UPDATE",
  "risk_score": 87,
  "risk_level": "CRITICAL",
  "event_hash": "a3f8d2e1b9c40712...",
  "previous_event_hash": "7c1e3a8f204b96d...",
  "risk_reasons": [
    {
      "rule_name": "Credit limit increase > 50%",
      "score_contribution": 40,
      "reason": "CREDIT_LIMIT increased by 60% (threshold: 50%)"
    },
    {
      "rule_name": "Critical table modification",
      "score_contribution": 40,
      "reason": "Table CUSTOMER is marked critical"
    },
    {
      "rule_name": "Outside business hours",
      "score_contribution": 20,
      "reason": "Event outside business hours (Fri 15:32)"
    }
  ]
}
```

---

### GET /events/search

Recherche multi-critères.

**Query parameters**

| Paramètre | Type | Description |
|-----------|------|-------------|
| `from_time` | ISO8601 | Début de période |
| `to_time` | ISO8601 | Fin de période |
| `database_name` | string | Nom de la base |
| `schema_name` | string | Nom du schéma |
| `table_name` | string | Nom de la table |
| `operation` | string | INSERT / UPDATE / DELETE |
| `db_username` | string | Utilisateur Oracle (ILIKE) |
| `app_user` | string | Utilisateur applicatif |
| `client_ip` | string | Adresse IP client |
| `transaction_id` | string | ID de transaction |
| `scn` | int | System Change Number |
| `risk_level` | string | LOW / MEDIUM / HIGH / CRITICAL |
| `changed_column` | string | Colonne modifiée |
| `page` | int | Page (défaut: 1) |
| `page_size` | int | Taille page (max 500) |
| `sort_by` | string | event_time / risk_score / table_name |
| `sort_dir` | string | asc / desc |

**Exemple**

```bash
curl -s "https://host/api/v1/events/search?\
table_name=CUSTOMER\
&operation=UPDATE\
&risk_level=CRITICAL\
&from_time=2026-11-20T00:00:00Z\
&to_time=2026-11-20T23:59:59Z\
&page_size=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Record Timeline

### GET /records/{schema}/{table}/{primary_key}/timeline

Historique complet d'un enregistrement.

**Path parameters**

| Paramètre | Description |
|-----------|-------------|
| `schema` | Nom du schéma Oracle |
| `table` | Nom de la table |
| `primary_key` | Valeur de la clé primaire |

**Response 200**

```json
{
  "total": 4,
  "page": 1,
  "page_size": 100,
  "pages": 1,
  "items": [
    {
      "event_time": "2026-11-20T08:12:03Z",
      "operation": "INSERT",
      "db_username": "BATCHJOB",
      "before_data": {},
      "after_data": {"STATUS": "ACTIVE", "CREDIT_LIMIT": 5000000},
      "changed_columns": ["STATUS", "CREDIT_LIMIT"],
      "risk_level": "LOW",
      "transaction_id": "8.23.900001"
    },
    {
      "event_time": "2026-11-20T15:32:18Z",
      "operation": "UPDATE",
      "db_username": "APPUSER",
      "before_data": {"CREDIT_LIMIT": 5000000},
      "after_data": {"CREDIT_LIMIT": 8000000},
      "changed_columns": ["CREDIT_LIMIT"],
      "risk_level": "CRITICAL",
      "transaction_id": "8.23.918273"
    }
  ]
}
```

---

## Transactions

### GET /transactions/{transaction_id}

Détail d'une transaction avec tous ses changements.

**Response 200**

```json
{
  "id": 45678,
  "transaction_id": "8.23.918273",
  "database_name": "COREBANK",
  "start_time": "2026-11-20T15:32:17Z",
  "commit_time": "2026-11-20T15:32:18Z",
  "db_username": "APPUSER",
  "application_name": "CORE_BANKING",
  "client_ip": "10.10.20.15",
  "event_count": 3,
  "tables_affected": ["CUSTOMER", "ACCOUNT", "AUDIT_LOG"],
  "max_risk_level": "CRITICAL",
  "duration_ms": 1240,
  "is_rollback": false,
  "events": [...]
}
```

---

## Alertes

### GET /alerts

**Query parameters** : `status` (OPEN/ACKNOWLEDGED/RESOLVED), `severity`, `page`, `page_size`

### PATCH /alerts/{id}

Mettre à jour le statut d'une alerte.

**Request body**

```json
{
  "status": "ACKNOWLEDGED",
  "notes": "Vérifié — changement autorisé par le responsable métier"
}
```

---

## Règles de risque

### GET /rules

Liste toutes les règles.

### POST /rules

Créer une règle.

**Request body**

```json
{
  "name": "DELETE sur table LOAN",
  "description": "Toute suppression dans la table LOAN est critique",
  "rule_type": "COMPOSITE",
  "conditions": {
    "type": "COMPOSITE",
    "logic": "AND",
    "conditions": [
      {"type": "OPERATION_TYPE", "operations": ["DELETE"]},
      {"type": "TABLE_SENSITIVITY", "require": "critical"}
    ]
  },
  "risk_score_add": 80,
  "risk_level_min": "CRITICAL",
  "generate_alert": true,
  "priority": 5
}
```

**Types de conditions disponibles**

| Type | Paramètres | Description |
|------|-----------|-------------|
| `TABLE_SENSITIVITY` | `require`: critical/sensitive | Table marquée critique ou sensible |
| `OPERATION_TYPE` | `operations`: liste | Opération DML ciblée |
| `TIME_WINDOW` | `work_start`, `work_end`, `work_days` | Hors heures ouvrées |
| `VALUE_CHANGE` | `column`, `threshold_pct`, `direction` | Variation d'une valeur numérique |
| `VOLUME_THRESHOLD` | `max_events`, `window_minutes` | Volume d'activité anormal |
| `UNUSUAL_USER` | — | Utilisateur n'ayant jamais modifié cette table |
| `IP_RANGE` | `blocked_ranges`, `allowed_ranges` | Contrôle par plage IP |
| `COMPOSITE` | `logic`: AND/OR, `conditions`: [] | Combinaison de conditions |

---

## Dashboard

### GET /dashboard

Métriques temps réel pour le tableau de bord.

**Response 200**

```json
{
  "total_events": 12847293,
  "events_today": 284931,
  "events_hour": 38200,
  "inserts": 45000,
  "updates": 220000,
  "deletes": 19931,
  "critical_events": 14,
  "high_risk_events": 203,
  "open_alerts": 7,
  "cdc_lag_seconds": 0.4,
  "events_per_second": 38.2,
  "storage_used_bytes": 19765043200,
  "archive_status": "OK",
  "integrity_status": "OK",
  "top_tables": [
    {"table": "TRANSACTION", "count": 98000},
    {"table": "ACCOUNT", "count": 71000}
  ],
  "top_users": [
    {"username": "APPUSER", "count": 180000},
    {"username": "BATCHJOB", "count": 95000}
  ],
  "events_by_hour": [
    {"hour": "2026-11-20T14:00:00", "count": 36800},
    {"hour": "2026-11-20T15:00:00", "count": 38200}
  ],
  "risk_distribution": {
    "LOW": 275000,
    "MEDIUM": 8500,
    "HIGH": 1217,
    "CRITICAL": 14
  }
}
```

---

## Intégrité

### GET /integrity/status

État de la chaîne d'intégrité.

### POST /integrity/verify

Vérifier la chaîne SHA-256 d'une table.

**Request body**

```json
{
  "database_id": 1,
  "schema_name": "BANK",
  "table_name": "CUSTOMER",
  "from_time": "2026-11-01T00:00:00Z",
  "to_time": "2026-11-20T23:59:59Z"
}
```

**Response 200**

```json
{
  "ok": true,
  "events_checked": 47293,
  "error_at_id": null,
  "error_message": null,
  "duration_ms": 8420
}
```

---

## CDC

### GET /cdc/status

État du connecteur CDC.

### POST /cdc/pause?database_id={id}

Mettre en pause (rôle ADMIN requis).

### POST /cdc/resume?database_id={id}

Reprendre (rôle ADMIN requis).

---

## Santé

### GET /health

Probe légère (sans authentification).

```json
{"status": "ok", "timestamp": 1732110738.4}
```

### GET /health/detail

Métriques détaillées (rôle AUDITOR requis).

---

## Rapports

### GET /reports

Liste les rapports disponibles.

### POST /reports/run

Exécuter un rapport.

**Request body**

```json
{
  "report_type": "DAILY_AUDIT",
  "format": "PDF",
  "parameters": {
    "date": "2026-11-20"
  }
}
```

**Types de rapports disponibles**

| Type | Description |
|------|-------------|
| `DAILY_AUDIT` | Résumé quotidien des modifications |
| `WEEKLY_SECURITY` | Rapport de sécurité hebdomadaire |
| `USER_ACTIVITY` | Activité par utilisateur Oracle |
| `SENSITIVE_TABLE` | Modifications sur tables sensibles |
| `CRITICAL_CHANGES` | Tous les événements CRITICAL |
| `AFTER_HOURS` | Activité hors heures ouvrées |
| `COMPLIANCE` | Rapport de conformité RGPD/SOX |
| `DATABASE_CHANGE` | Modifications DDL et structurelles |

---

## Codes d'erreur

| Code HTTP | Description |
|-----------|-------------|
| 200 | Succès |
| 201 | Ressource créée |
| 400 | Requête invalide |
| 401 | Token absent ou invalide |
| 403 | Permission insuffisante |
| 404 | Ressource introuvable |
| 429 | Rate limit dépassé (60 req/min) |
| 500 | Erreur serveur interne |

**Format d'erreur**

```json
{
  "detail": "Permission 'rules:write' required"
}
```

---

## Rate limiting

L'API est limitée à **60 requêtes par minute** par adresse IP.
En cas de dépassement : HTTP 429 avec header `Retry-After`.

```bash
# Vérifier votre quota restant
curl -si https://host/api/v1/health | grep -i x-ratelimit
```
