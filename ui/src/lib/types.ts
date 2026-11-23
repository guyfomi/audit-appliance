// =============================================================================
// Oracle Data Audit & Forensics Appliance — Types TypeScript
// =============================================================================

export type RiskLevel  = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Operation  = 'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE' | 'DDL';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
export type UserRole    = 'ADMIN' | 'AUDITOR' | 'ANALYST' | 'READONLY';

// ── Authentification ──────────────────────────────────────────────────────────

export interface AuthToken {
  access_token: string;
  token_type:   string;
  expires_in:   number;
  role:         UserRole;
}

export interface CurrentUser {
  user_id:  number;
  username: string;
  role:     UserRole;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  total:     number;
  page:      number;
  page_size: number;
  pages:     number;
  items:     T[];
}

// ── Événements ────────────────────────────────────────────────────────────────

export interface AuditEventSummary {
  id:              number;
  event_id:        string;
  event_time:      string;
  database_name:   string;
  schema_name:     string;
  table_name:      string;
  operation:       Operation;
  db_username:     string | null;
  app_user:        string | null;
  client_ip:       string | null;
  risk_score:      number;
  risk_level:      RiskLevel;
  changed_columns: string[];
}

export interface RiskReason {
  rule_name:          string;
  score_contribution: number;
  reason:             string;
}

export interface AuditEventDetail extends AuditEventSummary {
  commit_time:        string | null;
  transaction_id:     string | null;
  scn:                number | null;
  commit_scn:         number | null;
  primary_key:        Record<string, unknown>;
  before_data:        Record<string, unknown>;
  after_data:         Record<string, unknown>;
  client_identifier:  string | null;
  application_name:   string | null;
  hostname:           string | null;
  module:             string | null;
  action:             string | null;
  event_hash:         string;
  previous_event_hash: string | null;
  risk_reasons:       RiskReason[];
}

// ── Recherche ─────────────────────────────────────────────────────────────────

export interface EventSearchParams {
  from_time?:      string;
  to_time?:        string;
  database_name?:  string;
  schema_name?:    string;
  table_name?:     string;
  operation?:      Operation;
  db_username?:    string;
  app_user?:       string;
  client_ip?:      string;
  transaction_id?: string;
  scn?:            number;
  risk_level?:     RiskLevel;
  changed_column?: string;
  page:            number;
  page_size:       number;
  sort_by:         string;
  sort_dir:        'asc' | 'desc';
}

// ── Transactions ──────────────────────────────────────────────────────────────

export interface AuditTransaction {
  id:               number;
  transaction_id:   string;
  database_name:    string;
  start_time:       string | null;
  commit_time:      string | null;
  db_username:      string | null;
  application_name: string | null;
  client_ip:        string | null;
  event_count:      number;
  tables_affected:  string[];
  max_risk_level:   RiskLevel;
  duration_ms:      number | null;
  is_rollback:      boolean;
}

// ── Alertes ───────────────────────────────────────────────────────────────────

export interface AuditAlert {
  id:              number;
  event_id:        number;
  rule_name:       string;
  alert_time:      string;
  severity:        RiskLevel;
  title:           string;
  description:     string | null;
  status:          AlertStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

// ── Règles ────────────────────────────────────────────────────────────────────

export interface AuditRule {
  id:             number;
  name:           string;
  description:    string | null;
  rule_type:      string;
  conditions:     Record<string, unknown>;
  risk_score_add: number;
  risk_level_min: RiskLevel;
  generate_alert: boolean;
  is_active:      boolean;
  priority:       number;
  created_at:     string;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardStats {
  total_events:       number;
  events_today:       number;
  events_hour:        number;
  inserts:            number;
  updates:            number;
  deletes:            number;
  critical_events:    number;
  high_risk_events:   number;
  open_alerts:        number;
  cdc_lag_seconds:    number | null;
  events_per_second:  number;
  storage_used_bytes: number;
  archive_status:     string;
  integrity_status:   string;
  top_tables:         Array<{ table: string; count: number }>;
  top_users:          Array<{ username: string; count: number }>;
  events_by_hour:     Array<{ hour: string; count: number }>;
  risk_distribution:  Record<RiskLevel, number>;
}

// ── CDC ───────────────────────────────────────────────────────────────────────

export interface CDCStatus {
  database_id:      number;
  database_name:    string;
  adapter_type:     string;
  status:           'RUNNING' | 'PAUSED' | 'ERROR' | 'STOPPED' | 'CONNECTING';
  last_scn:         number | null;
  last_commit_scn:  number | null;
  last_event_time:  string | null;
  lag_seconds:      number | null;
  updated_at:       string;
}

// ── Intégrité ─────────────────────────────────────────────────────────────────

export interface IntegrityStatus {
  last_checkpoint_time: string | null;
  last_verified_at:     string | null;
  last_verified_ok:     boolean | null;
  total_checkpoints:    number;
}

export interface IntegrityVerifyResult {
  ok:             boolean;
  events_checked: number;
  error_at_id:    number | null;
  error_message:  string | null;
  duration_ms:    number;
}

// ── Santé ─────────────────────────────────────────────────────────────────────

export interface HealthDetail {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    postgresql:         string;
    disk_free_pct:      number;
    disk_free_gb:       number;
    cdc_lag_seconds:    number | null;
    integrity_ok:       boolean | null;
  };
}

// ── Utilisateurs ──────────────────────────────────────────────────────────────

export interface ApplianceUser {
  id:           number;
  username:     string;
  email:        string;
  full_name:    string | null;
  role:         UserRole;
  is_active:    boolean;
  last_login_at: string | null;
}
