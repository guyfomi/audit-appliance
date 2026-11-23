// =============================================================================
// Client HTTP — Oracle Data Audit & Forensics Appliance
// =============================================================================

import axios, { AxiosInstance } from 'axios';
import type {
  AuditEventDetail, AuditEventSummary, AuditTransaction,
  AuditAlert, AuditRule, DashboardStats, CDCStatus,
  IntegrityStatus, IntegrityVerifyResult, HealthDetail,
  PaginatedResponse, EventSearchParams, ApplianceUser,
  AuthToken,
} from './types';

const BASE_URL = '/api/v1';

// ── Instance Axios ────────────────────────────────────────────────────────────

const http: AxiosInstance = axios.create({ baseURL: BASE_URL });

// Injecter le JWT sur chaque requête
http.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers!.Authorization = `Bearer ${token}`;
  return cfg;
});

// Rediriger vers /login si token expiré
http.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (username: string, password: string) => {
    const form = new URLSearchParams({ username, password });
    return http.post<AuthToken>('/auth/token', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
  changePassword: (current_password: string, new_password: string) =>
    http.post('/users/me/change-password', { current_password, new_password }),
};

// ── Événements ────────────────────────────────────────────────────────────────

export const eventsApi = {
  list: (page = 1, pageSize = 50) =>
    http.get<PaginatedResponse<AuditEventSummary>>('/events', {
      params: { page, page_size: pageSize },
    }),
  get: (id: number) =>
    http.get<AuditEventDetail>(`/events/${id}`),
  search: (params: EventSearchParams) =>
    http.get<PaginatedResponse<AuditEventSummary>>('/events/search', { params }),
};

// ── Records / Timeline ────────────────────────────────────────────────────────

export const recordsApi = {
  timeline: (schema: string, table: string, pk: string, page = 1) =>
    http.get<PaginatedResponse<AuditEventSummary>>(
      `/records/${schema}/${table}/${encodeURIComponent(pk)}/timeline`,
      { params: { page, page_size: 100 } }
    ),
};

// ── Transactions ──────────────────────────────────────────────────────────────

export const transactionsApi = {
  list: (page = 1, pageSize = 50) =>
    http.get<PaginatedResponse<AuditTransaction>>('/transactions', {
      params: { page, page_size: pageSize },
    }),
  get: (id: string) =>
    http.get<AuditTransaction>(`/transactions/${id}`),
};

// ── Alertes ───────────────────────────────────────────────────────────────────

export const alertsApi = {
  list: (status?: string, page = 1, pageSize = 50) =>
    http.get<PaginatedResponse<AuditAlert>>('/alerts', {
      params: { status, page, page_size: pageSize },
    }),
  update: (id: number, status: string, notes?: string) =>
    http.patch(`/alerts/${id}`, { status, notes }),
};

// ── Règles ────────────────────────────────────────────────────────────────────

export const rulesApi = {
  list: () =>
    http.get<AuditRule[]>('/rules'),
  create: (rule: Partial<AuditRule>) =>
    http.post<AuditRule>('/rules', rule),
  update: (id: number, rule: Partial<AuditRule>) =>
    http.put<AuditRule>(`/rules/${id}`, rule),
  reload: () =>
    http.post('/rules/reload'),
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const dashboardApi = {
  get: () => http.get<DashboardStats>('/dashboard'),
};

// ── CDC ───────────────────────────────────────────────────────────────────────

export const cdcApi = {
  status: () => http.get<CDCStatus[]>('/cdc/status'),
  pause:  (databaseId: number) =>
    http.post(`/cdc/pause?database_id=${databaseId}`),
  resume: (databaseId: number) =>
    http.post(`/cdc/resume?database_id=${databaseId}`),
};

// ── Intégrité ─────────────────────────────────────────────────────────────────

export const integrityApi = {
  status: () => http.get<IntegrityStatus>('/integrity/status'),
  verify: (databaseId: number, schema: string, table: string,
           fromTime?: string, toTime?: string) =>
    http.post<IntegrityVerifyResult>('/integrity/verify', {
      database_id: databaseId, schema_name: schema, table_name: table,
      from_time: fromTime, to_time: toTime,
    }),
};

// ── Santé ─────────────────────────────────────────────────────────────────────

export const healthApi = {
  simple: () => http.get('/health'),
  detail: () => http.get<HealthDetail>('/health/detail'),
};

// ── Rapports ──────────────────────────────────────────────────────────────────

export const reportsApi = {
  list: () => http.get('/reports'),
  run:  (type: string, format: string, params?: Record<string, unknown>) =>
    http.post('/reports/run', { report_type: type, format, parameters: params }),
};

// ── Utilisateurs ──────────────────────────────────────────────────────────────

export const usersApi = {
  list: ()   => http.get<ApplianceUser[]>('/users'),
  create: (u: Partial<ApplianceUser> & { password?: string }) =>
    http.post<ApplianceUser>('/users', u),
  disable: (id: number) =>
    http.patch(`/users/${id}/disable`),
};

// ── Archive ───────────────────────────────────────────────────────────────────

export const archiveApi = {
  jobs: () => http.get('/archive/jobs'),
  run:  () => http.post('/archive/run'),
};

export default http;
