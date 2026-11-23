// =============================================================================
// Hooks React Query — Oracle Data Audit & Forensics Appliance
// =============================================================================

import { useQuery, useMutation, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import {
  eventsApi, recordsApi, transactionsApi, alertsApi,
  rulesApi, dashboardApi, cdcApi, integrityApi, healthApi,
  usersApi, archiveApi,
} from '../lib/api';
import type { EventSearchParams } from '../lib/types';

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const useDashboard = () =>
  useQuery({
    queryKey:        ['dashboard'],
    queryFn:         () => dashboardApi.get().then(r => r.data),
    refetchInterval: 10_000,
    staleTime:       5_000,
  });

// ── Événements ────────────────────────────────────────────────────────────────

export const useEvents = (page: number, pageSize: number) =>
  useQuery({
    queryKey:        ['events', page, pageSize],
    queryFn:         () => eventsApi.list(page, pageSize).then(r => r.data),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

export const useEventSearch = (params: EventSearchParams, enabled = true) =>
  useQuery({
    queryKey:        ['events', 'search', params],
    queryFn:         () => eventsApi.search(params).then(r => r.data),
    placeholderData: keepPreviousData,
    enabled,
    staleTime:       10_000,
  });

export const useEventDetail = (id: number | null) =>
  useQuery({
    queryKey: ['events', id],
    queryFn:  () => eventsApi.get(id!).then(r => r.data),
    enabled:  id !== null,
  });

// ── Record Timeline ───────────────────────────────────────────────────────────

export const useRecordTimeline = (
  schema: string, table: string, pk: string, page = 1,
  enabled = true
) =>
  useQuery({
    queryKey: ['timeline', schema, table, pk, page],
    queryFn:  () => recordsApi.timeline(schema, table, pk, page).then(r => r.data),
    enabled:  enabled && !!schema && !!table && !!pk,
  });

// ── Transactions ──────────────────────────────────────────────────────────────

export const useTransactions = (page: number, pageSize: number) =>
  useQuery({
    queryKey:        ['transactions', page, pageSize],
    queryFn:         () => transactionsApi.list(page, pageSize).then(r => r.data),
    placeholderData: keepPreviousData,
  });

export const useTransactionDetail = (id: string | null) =>
  useQuery({
    queryKey: ['transactions', id],
    queryFn:  () => transactionsApi.get(id!).then(r => r.data),
    enabled:  !!id,
  });

// ── Alertes ───────────────────────────────────────────────────────────────────

export const useAlerts = (status?: string, page = 1, pageSize = 50) =>
  useQuery({
    queryKey:        ['alerts', status, page, pageSize],
    queryFn:         () => alertsApi.list(status, page, pageSize).then(r => r.data),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

export const useAcknowledgeAlert = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, notes }: { id: number; status: string; notes?: string }) =>
      alertsApi.update(id, status, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
};

// ── Règles ────────────────────────────────────────────────────────────────────

export const useRules = () =>
  useQuery({
    queryKey: ['rules'],
    queryFn:  () => rulesApi.list().then(r => r.data),
  });

export const useCreateRule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rulesApi.create,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
};

// ── CDC ───────────────────────────────────────────────────────────────────────

export const useCDCStatus = () =>
  useQuery({
    queryKey:        ['cdc'],
    queryFn:         () => cdcApi.status().then(r => r.data),
    refetchInterval: 10_000,
  });

export const usePauseCDC = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dbId: number) => cdcApi.pause(dbId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['cdc'] }),
  });
};

export const useResumeCDC = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dbId: number) => cdcApi.resume(dbId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['cdc'] }),
  });
};

// ── Intégrité ─────────────────────────────────────────────────────────────────

export const useIntegrityStatus = () =>
  useQuery({
    queryKey:        ['integrity'],
    queryFn:         () => integrityApi.status().then(r => r.data),
    refetchInterval: 60_000,
  });

// ── Santé ─────────────────────────────────────────────────────────────────────

export const useHealth = () =>
  useQuery({
    queryKey:        ['health'],
    queryFn:         () => healthApi.detail().then(r => r.data),
    refetchInterval: 15_000,
  });

// ── Utilisateurs ──────────────────────────────────────────────────────────────

export const useUsers = () =>
  useQuery({
    queryKey: ['users'],
    queryFn:  () => usersApi.list().then(r => r.data),
  });

// ── Archive ───────────────────────────────────────────────────────────────────

export const useArchiveJobs = () =>
  useQuery({
    queryKey: ['archive', 'jobs'],
    queryFn:  () => archiveApi.jobs().then(r => r.data),
  });
