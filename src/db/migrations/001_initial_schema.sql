-- =============================================================================
-- Oracle Data Audit & Forensics Appliance
-- Migration 001 : Schéma initial complet
-- =============================================================================

-- ── Types énumérés ────────────────────────────────────────────────────────────

CREATE TYPE dml_operation AS ENUM (
    'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DDL', 'SELECT'
);

CREATE TYPE risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TYPE raw_processing_status AS ENUM (
    'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE', 'SKIPPED'
);

CREATE TYPE cdc_status AS ENUM ('RUNNING', 'PAUSED', 'ERROR', 'STOPPED', 'CONNECTING');

CREATE TYPE appliance_role AS ENUM ('ADMIN', 'AUDITOR', 'ANALYST', 'READONLY');

CREATE TYPE mask_policy AS ENUM ('NONE', 'FULL', 'PARTIAL', 'HASH', 'REDACT');

CREATE TYPE alert_status AS ENUM (
    'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'
);

CREATE TYPE archive_format AS ENUM ('PARQUET', 'JSONL');

CREATE TYPE job_status AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

CREATE TYPE report_type AS ENUM (
    'DAILY_AUDIT', 'WEEKLY_SECURITY', 'USER_ACTIVITY',
    'SENSITIVE_TABLE', 'CRITICAL_CHANGES', 'AFTER_HOURS',
    'COMPLIANCE', 'DATABASE_CHANGE'
);

CREATE TYPE rule_type AS ENUM (
    'TABLE_SENSITIVITY', 'OPERATION_TYPE', 'TIME_WINDOW',
    'VALUE_CHANGE', 'VOLUME_THRESHOLD', 'UNUSUAL_USER',
    'IP_RANGE', 'COMPOSITE'
);

-- ── Tables de référence ───────────────────────────────────────────────────────

CREATE TABLE audit_database (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    host            TEXT NOT NULL DEFAULT 'unknown',
    port            INT  NOT NULL DEFAULT 1521,
    service_name    TEXT NOT NULL DEFAULT 'unknown',
    oracle_version  TEXT,
    is_active       BOOL NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  audit_database IS 'Sources Oracle auditées';
COMMENT ON COLUMN audit_database.name IS 'Nom de la base Oracle (ex: COREBANK)';

CREATE TABLE audit_db_user (
    id                 SERIAL PRIMARY KEY,
    database_id        INT  NOT NULL REFERENCES audit_database(id),
    username           TEXT NOT NULL,
    is_service_account BOOL NOT NULL DEFAULT FALSE,
    is_trusted         BOOL NOT NULL DEFAULT FALSE,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes              TEXT,
    UNIQUE (database_id, username)
);

COMMENT ON TABLE audit_db_user IS 'Utilisateurs Oracle observés';

CREATE TABLE audit_application (
    id           SERIAL PRIMARY KEY,
    module_name  TEXT NOT NULL UNIQUE,
    display_name TEXT,
    is_trusted   BOOL NOT NULL DEFAULT FALSE,
    owner        TEXT,
    notes        TEXT
);

COMMENT ON TABLE audit_application IS 'Applications sources identifiées par V$SESSION.MODULE';

CREATE TABLE audit_table_config (
    id               SERIAL PRIMARY KEY,
    database_id      INT  NOT NULL REFERENCES audit_database(id),
    schema_name      TEXT NOT NULL,
    table_name       TEXT NOT NULL,
    is_sensitive     BOOL NOT NULL DEFAULT FALSE,
    is_critical      BOOL NOT NULL DEFAULT FALSE,
    capture_before   BOOL NOT NULL DEFAULT TRUE,
    capture_after    BOOL NOT NULL DEFAULT TRUE,
    excluded_columns TEXT[],
    masked_columns   JSONB DEFAULT '{}',
    retention_days   INT,
    UNIQUE (database_id, schema_name, table_name)
);

COMMENT ON TABLE  audit_table_config IS 'Configuration d''audit par table';
COMMENT ON COLUMN audit_table_config.masked_columns
    IS 'JSON: {"COLUMN_NAME": "PARTIAL|FULL|HASH|REDACT"}';

CREATE TABLE audit_column_config (
    id              SERIAL PRIMARY KEY,
    table_config_id INT  NOT NULL REFERENCES audit_table_config(id) ON DELETE CASCADE,
    column_name     TEXT NOT NULL,
    is_sensitive    BOOL NOT NULL DEFAULT FALSE,
    mask_policy     mask_policy NOT NULL DEFAULT 'NONE',
    mask_pattern    TEXT,
    notes           TEXT,
    UNIQUE (table_config_id, column_name)
);

-- ── Table principale des événements (partitionnée) ────────────────────────────

CREATE TABLE audit_event (
    id                   BIGSERIAL,
    event_id             UUID         NOT NULL DEFAULT gen_random_uuid(),
    event_time           TIMESTAMPTZ  NOT NULL,
    commit_time          TIMESTAMPTZ,

    database_id          INT          NOT NULL REFERENCES audit_database(id),
    schema_name          TEXT         NOT NULL,
    table_name           TEXT         NOT NULL,
    operation            dml_operation NOT NULL,

    transaction_id       TEXT,
    scn                  BIGINT,
    commit_scn           BIGINT,

    primary_key          JSONB        NOT NULL DEFAULT '{}',

    db_user_id           INT          REFERENCES audit_db_user(id),
    app_user             TEXT,
    client_identifier    TEXT,
    application_id       INT          REFERENCES audit_application(id),
    client_ip            INET,
    hostname             TEXT,
    module               TEXT,
    action               TEXT,

    before_data          JSONB        DEFAULT '{}',
    after_data           JSONB        DEFAULT '{}',
    changed_columns      TEXT[]       DEFAULT '{}',

    risk_score           SMALLINT     NOT NULL DEFAULT 0
                                      CHECK (risk_score BETWEEN 0 AND 100),
    risk_level           risk_level   NOT NULL DEFAULT 'LOW',

    source_adapter       TEXT         NOT NULL DEFAULT 'unknown',
    raw_event_id         BIGINT,

    event_hash           TEXT         NOT NULL DEFAULT '',
    previous_event_hash  TEXT,
    idempotency_key      TEXT         NOT NULL,

    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    PRIMARY KEY (id, event_time)
) PARTITION BY RANGE (event_time);

COMMENT ON TABLE  audit_event IS 'Événements d''audit — append-only — partitionné par mois';
COMMENT ON COLUMN audit_event.idempotency_key
    IS 'SHA256(source|db|txn|scn|schema|table|pk|op) — unicité garantie';
COMMENT ON COLUMN audit_event.event_hash
    IS 'SHA256(canonical_json + previous_event_hash) — chaîne d''intégrité';

-- Index principaux
CREATE UNIQUE INDEX idx_audit_event_idempotency
    ON audit_event (idempotency_key, event_time);
CREATE INDEX idx_audit_event_time       ON audit_event (event_time DESC);
CREATE INDEX idx_audit_event_table      ON audit_event (database_id, schema_name, table_name, event_time DESC);
CREATE INDEX idx_audit_event_user       ON audit_event (db_user_id, event_time DESC);
CREATE INDEX idx_audit_event_app        ON audit_event (application_id, event_time DESC);
CREATE INDEX idx_audit_event_risk       ON audit_event (risk_level, event_time DESC);
CREATE INDEX idx_audit_event_txn        ON audit_event (transaction_id);
CREATE INDEX idx_audit_event_scn        ON audit_event (scn);
CREATE INDEX idx_audit_event_ip         ON audit_event (client_ip, event_time DESC);
CREATE INDEX idx_audit_event_pk         ON audit_event USING GIN (primary_key);
CREATE INDEX idx_audit_event_before     ON audit_event USING GIN (before_data);
CREATE INDEX idx_audit_event_after      ON audit_event USING GIN (after_data);
CREATE INDEX idx_audit_event_cols       ON audit_event USING GIN (changed_columns);

-- Partitions initiales (mois courant + 2 mois suivants)
CREATE TABLE audit_event_2026_11 PARTITION OF audit_event
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE audit_event_2026_12 PARTITION OF audit_event
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE audit_event_2027_01 PARTITION OF audit_event
    FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

-- ── Stockage des événements bruts ─────────────────────────────────────────────

CREATE TABLE audit_raw_event (
    raw_event_id      BIGSERIAL PRIMARY KEY,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_adapter    TEXT        NOT NULL,
    source_position   TEXT        NOT NULL,
    payload           JSONB       NOT NULL,
    payload_hash      TEXT        NOT NULL,
    processing_status raw_processing_status NOT NULL DEFAULT 'PENDING',
    processed_at      TIMESTAMPTZ,
    error_message     TEXT,
    retry_count       SMALLINT    NOT NULL DEFAULT 0
);

COMMENT ON TABLE audit_raw_event
    IS 'Événements CDC bruts — conservés pour retraitement si le moteur évolue';

CREATE INDEX idx_raw_event_status   ON audit_raw_event (processing_status, received_at);
CREATE INDEX idx_raw_event_position ON audit_raw_event (source_position);
CREATE INDEX idx_raw_event_received ON audit_raw_event (received_at DESC);

-- ── Transactions ──────────────────────────────────────────────────────────────

CREATE TABLE audit_transaction (
    id               BIGSERIAL PRIMARY KEY,
    transaction_id   TEXT        NOT NULL,
    database_id      INT         NOT NULL REFERENCES audit_database(id),
    start_scn        BIGINT,
    commit_scn       BIGINT,
    start_time       TIMESTAMPTZ,
    commit_time      TIMESTAMPTZ,
    db_user_id       INT         REFERENCES audit_db_user(id),
    application_id   INT         REFERENCES audit_application(id),
    client_ip        INET,
    hostname         TEXT,
    event_count      INT         NOT NULL DEFAULT 0,
    tables_affected  TEXT[]      DEFAULT '{}',
    max_risk_level   risk_level  NOT NULL DEFAULT 'LOW',
    duration_ms      INT,
    is_rollback      BOOL        NOT NULL DEFAULT FALSE,
    UNIQUE (database_id, transaction_id)
);

CREATE INDEX idx_audit_txn_time ON audit_transaction (commit_time DESC);
CREATE INDEX idx_audit_txn_user ON audit_transaction (db_user_id, commit_time DESC);

-- ── Risque et alertes ─────────────────────────────────────────────────────────

CREATE TABLE audit_rule (
    id               SERIAL PRIMARY KEY,
    name             TEXT        NOT NULL UNIQUE,
    description      TEXT,
    rule_type        rule_type   NOT NULL,
    conditions       JSONB       NOT NULL DEFAULT '{}',
    risk_score_add   SMALLINT    NOT NULL DEFAULT 0 CHECK (risk_score_add BETWEEN 0 AND 100),
    risk_level_min   risk_level  NOT NULL DEFAULT 'LOW',
    generate_alert   BOOL        NOT NULL DEFAULT FALSE,
    is_active        BOOL        NOT NULL DEFAULT TRUE,
    priority         SMALLINT    NOT NULL DEFAULT 100,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN audit_rule.conditions
    IS 'Structure JSON de la condition : {"type":"...", ...}';

CREATE TABLE audit_event_risk_detail (
    id                 BIGSERIAL PRIMARY KEY,
    event_id           BIGINT      NOT NULL,
    event_time         TIMESTAMPTZ NOT NULL,
    rule_id            INT         NOT NULL REFERENCES audit_rule(id),
    score_contribution SMALLINT    NOT NULL,
    reason             TEXT        NOT NULL
);

CREATE INDEX idx_risk_detail_event ON audit_event_risk_detail (event_id);

-- ── Utilisateurs de l'appliance ───────────────────────────────────────────────

CREATE TABLE appliance_user (
    id               SERIAL PRIMARY KEY,
    username         TEXT        NOT NULL UNIQUE,
    email            TEXT        NOT NULL,
    full_name        TEXT,
    password_hash    TEXT        NOT NULL,
    role             appliance_role NOT NULL DEFAULT 'READONLY',
    is_active        BOOL        NOT NULL DEFAULT TRUE,
    mfa_secret       TEXT,
    last_login_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN appliance_user.password_hash IS 'bcrypt hash — jamais exposé par l''API';
COMMENT ON COLUMN appliance_user.mfa_secret    IS 'Base32 TOTP secret — chiffré en transit';

CREATE TABLE audit_alert (
    id               BIGSERIAL PRIMARY KEY,
    event_id         BIGINT      NOT NULL,
    event_time       TIMESTAMPTZ NOT NULL,
    rule_id          INT         NOT NULL REFERENCES audit_rule(id),
    alert_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
    severity         risk_level  NOT NULL,
    title            TEXT        NOT NULL,
    description      TEXT,
    status           alert_status NOT NULL DEFAULT 'OPEN',
    acknowledged_by  INT         REFERENCES appliance_user(id),
    acknowledged_at  TIMESTAMPTZ,
    resolved_at      TIMESTAMPTZ,
    notes            TEXT
);

CREATE INDEX idx_alert_status   ON audit_alert (status, alert_time DESC);
CREATE INDEX idx_alert_severity ON audit_alert (severity, alert_time DESC);
CREATE INDEX idx_alert_event    ON audit_alert (event_id);

-- ── CDC et checkpoint ─────────────────────────────────────────────────────────

CREATE TABLE cdc_checkpoint (
    id               SERIAL PRIMARY KEY,
    database_id      INT         NOT NULL REFERENCES audit_database(id) UNIQUE,
    adapter_type     TEXT        NOT NULL DEFAULT 'synchdb',
    last_scn         BIGINT,
    last_commit_scn  BIGINT,
    last_event_time  TIMESTAMPTZ,
    status           cdc_status  NOT NULL DEFAULT 'STOPPED',
    lag_seconds      NUMERIC(10,3),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_idempotency_key (
    id               BIGSERIAL PRIMARY KEY,
    idempotency_key  TEXT        NOT NULL UNIQUE,
    event_id         UUID        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE audit_idempotency_key
    IS 'Cache de déduplication — nettoyage automatique après 30 jours';

CREATE INDEX idx_idem_created ON audit_idempotency_key (created_at);

CREATE TABLE audit_integrity_checkpoint (
    id               BIGSERIAL PRIMARY KEY,
    checkpoint_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_event_id   BIGINT,
    last_event_id    BIGINT,
    event_count      BIGINT      NOT NULL DEFAULT 0,
    root_hash        TEXT        NOT NULL,
    verified_at      TIMESTAMPTZ,
    verified_ok      BOOL
);

CREATE TABLE admin_audit_event (
    id               BIGSERIAL PRIMARY KEY,
    user_id          INT         REFERENCES appliance_user(id),
    event_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
    action           TEXT        NOT NULL,
    resource_type    TEXT,
    resource_id      TEXT,
    details          JSONB       DEFAULT '{}',
    client_ip        INET,
    session_id       TEXT
);

COMMENT ON TABLE admin_audit_event
    IS 'Audit des actions administratives — l''auditeur est lui-même audité';

CREATE INDEX idx_admin_audit_time ON admin_audit_event (event_time DESC);
CREATE INDEX idx_admin_audit_user ON admin_audit_event (user_id, event_time DESC);

-- ── Archive et rétention ──────────────────────────────────────────────────────

CREATE TABLE audit_retention_policy (
    id               SERIAL PRIMARY KEY,
    policy_name      TEXT        NOT NULL,
    database_id      INT         REFERENCES audit_database(id),
    schema_name      TEXT,
    table_name       TEXT,
    hot_days         INT         NOT NULL DEFAULT 90,
    warm_days        INT         NOT NULL DEFAULT 365,
    cold_days        INT         NOT NULL DEFAULT 2555,
    min_risk_keep    risk_level  NOT NULL DEFAULT 'HIGH',
    is_active        BOOL        NOT NULL DEFAULT TRUE
);

COMMENT ON COLUMN audit_retention_policy.min_risk_keep
    IS 'Niveau de risque minimum dont les événements ne sont jamais purgés';

CREATE TABLE audit_archive_job (
    id               SERIAL PRIMARY KEY,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    partition_name   TEXT        NOT NULL,
    event_count      BIGINT,
    archive_path     TEXT,
    archive_hash     TEXT,
    format           archive_format NOT NULL DEFAULT 'PARQUET',
    status           job_status  NOT NULL DEFAULT 'PENDING',
    error_message    TEXT
);

CREATE TABLE audit_report (
    id               SERIAL PRIMARY KEY,
    name             TEXT        NOT NULL,
    report_type      report_type NOT NULL,
    parameters       JSONB       DEFAULT '{}',
    schedule         TEXT,
    created_by       INT         REFERENCES appliance_user(id),
    last_run_at      TIMESTAMPTZ,
    last_run_status  job_status
);

-- ── Données par défaut ────────────────────────────────────────────────────────

-- Règles de risque par défaut
INSERT INTO audit_rule (name, description, rule_type, conditions,
    risk_score_add, risk_level_min, generate_alert, priority)
VALUES
    (
        'Critical table modification',
        'Modification d''une table marquée critique',
        'TABLE_SENSITIVITY',
        '{"type":"TABLE_SENSITIVITY","require":"critical"}',
        40, 'HIGH', TRUE, 10
    ),
    (
        'DELETE on sensitive table',
        'Suppression sur une table sensible',
        'COMPOSITE',
        '{"type":"COMPOSITE","logic":"AND","conditions":[{"type":"OPERATION_TYPE","operations":["DELETE"]},{"type":"TABLE_SENSITIVITY","require":"sensitive"}]}',
        60, 'CRITICAL', TRUE, 5
    ),
    (
        'Outside business hours',
        'Modification hors des heures ouvrées (lun-ven 08:00-18:00)',
        'TIME_WINDOW',
        '{"type":"TIME_WINDOW","work_start":[8,0],"work_end":[18,0],"work_days":[0,1,2,3,4]}',
        20, 'MEDIUM', FALSE, 50
    ),
    (
        'Credit limit increase > 50%',
        'Augmentation de la limite de crédit supérieure à 50%',
        'VALUE_CHANGE',
        '{"type":"VALUE_CHANGE","column":"CREDIT_LIMIT","threshold_pct":50,"direction":"increase"}',
        40, 'HIGH', TRUE, 20
    ),
    (
        'Volume threshold — 100 events/min',
        'Utilisateur ayant effectué plus de 100 modifications en 1 minute',
        'VOLUME_THRESHOLD',
        '{"type":"VOLUME_THRESHOLD","max_events":100,"window_minutes":1}',
        50, 'HIGH', TRUE, 15
    ),
    (
        'Unusual user on table',
        'Utilisateur n''ayant jamais modifié cette table auparavant',
        'UNUSUAL_USER',
        '{"type":"UNUSUAL_USER"}',
        30, 'HIGH', TRUE, 25
    ),
    (
        'DDL operation',
        'Toute opération DDL (CREATE, ALTER, DROP)',
        'OPERATION_TYPE',
        '{"type":"OPERATION_TYPE","operations":["DDL"]}',
        80, 'CRITICAL', TRUE, 1
    ),
    (
        'TRUNCATE operation',
        'Opération TRUNCATE sur n''importe quelle table',
        'OPERATION_TYPE',
        '{"type":"OPERATION_TYPE","operations":["TRUNCATE"]}',
        70, 'CRITICAL', TRUE, 2
    );

-- Politique de rétention par défaut
INSERT INTO audit_retention_policy
    (policy_name, hot_days, warm_days, cold_days, min_risk_keep, is_active)
VALUES
    ('Default Policy', 90, 365, 2555, 'HIGH', TRUE);

-- ── Vues utiles ───────────────────────────────────────────────────────────────

CREATE VIEW v_high_risk_events AS
SELECT
    e.id, e.event_id, e.event_time, e.operation,
    d.name  AS database_name,
    e.schema_name, e.table_name, e.primary_key,
    u.username AS db_username,
    e.app_user, e.client_ip, e.hostname,
    e.before_data, e.after_data, e.changed_columns,
    e.risk_score, e.risk_level,
    a.display_name AS application_name,
    e.transaction_id, e.scn
FROM audit_event e
LEFT JOIN audit_database    d ON e.database_id    = d.id
LEFT JOIN audit_db_user     u ON e.db_user_id     = u.id
LEFT JOIN audit_application a ON e.application_id = a.id
WHERE e.risk_level IN ('HIGH', 'CRITICAL');

COMMENT ON VIEW v_high_risk_events IS 'Événements HIGH et CRITICAL — vue dénormalisée';

CREATE VIEW v_open_alerts AS
SELECT
    al.id, al.alert_time, al.severity, al.title, al.description, al.status,
    ar.name  AS rule_name,
    e.event_time, e.table_name, e.operation,
    d.name  AS database_name,
    u.username AS db_username
FROM audit_alert al
JOIN audit_rule     ar ON al.rule_id    = ar.id
JOIN audit_event    e  ON al.event_id   = e.id AND al.event_time = e.event_time
JOIN audit_database d  ON e.database_id = d.id
LEFT JOIN audit_db_user u ON e.db_user_id = u.id
WHERE al.status = 'OPEN'
ORDER BY al.alert_time DESC;

COMMENT ON VIEW v_open_alerts IS 'Alertes ouvertes avec contexte complet';
