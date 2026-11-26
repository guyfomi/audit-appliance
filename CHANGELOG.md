# Changelog — Oracle Data Audit & Forensics Appliance

## [1.0.0] — 2026-11-20

### Première version — Enterprise-ready

#### Architecture
- Modular monolith déployable sur une seule VM Ubuntu 22.04/24.04
- Interface `CDCAdapter` abstraite — SynchDB v1 intégré, Debezium/GoldenGate prévus
- PostgreSQL 16 partitionné par mois avec JSONB indexé GIN
- Pas de Kafka, pas de Kubernetes, pas de dépendance cloud obligatoire

#### Composants livrés
- **CDC** : SynchDB adapter + mock Python pour tests sans Oracle
- **Audit Engine** : pipeline 8 étapes (ingest → dedup → normalize → enrich → risk → integrity → persist → alert)
- **Risk Engine** : 8 règles par défaut, rechargement à chaud, évaluateurs extensibles
- **Integrity Engine** : chaîne SHA-256 par table, checkpoints périodiques, vérification complète
- **Archive Engine** : Parquet (Snappy) et JSONL, backends filesystem/MinIO/S3
- **REST API** : FastAPI + JWT + RBAC 4 niveaux + rate limiting 60 req/min
- **Web UI** : React 18 + TypeScript + MUI v5 + AG Grid + ECharts
- **Monitoring** : endpoint Prometheus /metrics, health checks détaillés

#### Pages UI
- Dashboard (KPIs + 3 graphiques ECharts temps réel)
- Audit Explorer (AG Grid + 12 filtres + export CSV)
- Event Detail (diff avant/après + raisons de risque + hash SHA-256)
- Record Timeline (historique complet d'un enregistrement)
- Transaction Explorer
- Alertes (acquittement, résolution, faux positifs)
- Règles de risque (CRUD + rechargement live)
- Intégrité SHA-256 (vérification interactive)
- Santé système (jauges ressources + métriques)
- Rapports (8 types : quotidien, conformité, hors heures, etc.)
- Utilisateurs (RBAC ADMIN/AUDITOR/ANALYST/READONLY + MFA TOTP)

#### Installation
- `install.sh` : installation complète en 10 étapes (~15 min)
- `install-synchdb.sh` : CDC SynchDB + mock Python
- `install-ui.sh` : build React + déploiement Nginx
- `setup-wizard.sh` : assistant interactif 10 étapes
- `appliance-backup.sh` : backup pg_basebackup + config AES-256
- `appliance-restore.sh` : restauration complète en 8 étapes

#### Tests
- 30+ tests unitaires (idempotence, masquage, risk, integrity, SynchDB parser)
- Tests d'intégration API (12 endpoints)
- Tests de charge (1k/5k/10k/50k eps + sustained 1h)
- Smoke test complet (10 vérifications post-installation)

#### Sécurité
- TLS 1.2/1.3 — headers HSTS, CSP, X-Frame
- JWT HS256 — RBAC granulaire par permission
- MFA TOTP optionnel (pyotp + QR code)
- Secrets Oracle jamais dans les logs ni l'API
- Événements append-only — pas de UPDATE/DELETE sur audit_event
- admin_audit_event : l'auditeur est lui-même audité

---

## Roadmap v1.1

- [ ] Adapter Debezium (CDCAdapter implémenté)
- [ ] LDAP / Active Directory pour l'authentification
- [ ] Architecture HA (PostgreSQL streaming replication + MinIO cluster)
- [ ] Tableau de bord SOC temps réel (WebSocket)
- [ ] Kafka optionnel pour volumes > 50 000 eps
- [ ] Export SIEM natif (Splunk HEC, Elastic ECS)
- [ ] Oracle GoldenGate adapter (Enterprise)
- [ ] Pages UI restantes : Databases, Archive, Backup, Administration
