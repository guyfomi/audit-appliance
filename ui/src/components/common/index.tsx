// =============================================================================
// Composants communs — Oracle Data Audit & Forensics Appliance
// =============================================================================

import React from 'react';
import {
  Chip, Box, Table, TableBody, TableCell, TableHead,
  TableRow, Tooltip, Typography,
} from '@mui/material';
import {
  CheckCircle, Error, Warning, Info,
  FiberManualRecord,
} from '@mui/icons-material';
import type { RiskLevel, Operation, CDCStatus } from '../../lib/types';

// ── RiskBadge ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, 'error' | 'warning' | 'info' | 'success'> = {
  CRITICAL: 'error',
  HIGH:     'warning',
  MEDIUM:   'info',
  LOW:      'success',
};

export const RiskBadge: React.FC<{ level: RiskLevel; score?: number }> = ({ level, score }) => (
  <Chip
    label={score !== undefined ? `${level} (${score})` : level}
    color={RISK_COLORS[level]}
    size="small"
    sx={{ fontWeight: 600, fontSize: 11 }}
  />
);

// ── OperationBadge ────────────────────────────────────────────────────────────

const OP_COLORS: Record<string, string> = {
  INSERT:   '#1B8A4E',
  UPDATE:   '#1565C0',
  DELETE:   '#C62828',
  TRUNCATE: '#6A1B9A',
  DDL:      '#E65100',
};

export const OperationBadge: React.FC<{ op: Operation }> = ({ op }) => (
  <Box
    component="span"
    sx={{
      px: 0.8, py: 0.3, borderRadius: 1,
      fontSize: 11, fontWeight: 700,
      color: '#fff',
      bgcolor: OP_COLORS[op] || '#555',
    }}
  >
    {op}
  </Box>
);

// ── BeforeAfterDiff ───────────────────────────────────────────────────────────

interface DiffProps {
  before:         Record<string, unknown>;
  after:          Record<string, unknown>;
  changedColumns: string[];
  showAll?:       boolean;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return new Intl.NumberFormat('fr-FR').format(v);
  return String(v);
}

function computePctChange(before: unknown, after: unknown): number | null {
  if (typeof before === 'number' && typeof after === 'number' && before !== 0)
    return ((after - before) / Math.abs(before)) * 100;
  return null;
}

export const BeforeAfterDiff: React.FC<DiffProps> = ({
  before, after, changedColumns, showAll = false,
}) => {
  const changed = new Set(changedColumns.map(c => c.toUpperCase()));
  const allCols = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const visible = showAll ? allCols : allCols.filter(c => changed.has(c.toUpperCase()));

  if (visible.length === 0)
    return <Typography variant="body2" color="text.secondary">Aucune colonne modifiée</Typography>;

  return (
    <Table size="small" sx={{ tableLayout: 'fixed' }}>
      <TableHead>
        <TableRow sx={{ bgcolor: 'grey.50' }}>
          <TableCell sx={{ fontWeight: 600, width: '30%' }}>Colonne</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Avant</TableCell>
          <TableCell sx={{ fontWeight: 600 }}>Après</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {visible.map(col => {
          const isChanged = changed.has(col.toUpperCase());
          const bVal = before[col];
          const aVal = after[col];
          const pct  = isChanged ? computePctChange(bVal, aVal) : null;

          return (
            <TableRow
              key={col}
              sx={isChanged ? { bgcolor: 'warning.light' } : {}}
            >
              <TableCell sx={{ fontWeight: isChanged ? 700 : 400, fontFamily: 'monospace', fontSize: 12 }}>
                {col}
              </TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12,
                               textDecoration: isChanged ? 'line-through' : 'none',
                               color: isChanged ? 'text.disabled' : 'text.primary' }}>
                {formatValue(bVal)}
              </TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: isChanged ? 600 : 400 }}>
                {formatValue(aVal)}
                {pct !== null && Math.abs(pct) >= 1 && (
                  <Chip
                    label={`${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}
                    size="small"
                    color={pct > 0 ? 'error' : 'warning'}
                    sx={{ ml: 1, fontSize: 10, height: 18 }}
                  />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

// ── CDCStatusBadge ────────────────────────────────────────────────────────────

export const CDCStatusBadge: React.FC<{ status: CDCStatus }> = ({ status }) => {
  const isRunning = status.status === 'RUNNING';
  const lag       = status.lag_seconds;
  const lagOk     = lag === null || lag < 30;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
      <FiberManualRecord
        sx={{
          fontSize: 10,
          color: isRunning && lagOk ? 'success.main'
               : isRunning          ? 'warning.main'
               :                      'error.main',
          animation: isRunning ? 'pulse 2s infinite' : 'none',
        }}
      />
      <Typography variant="caption" sx={{ fontWeight: 500 }}>
        CDC {status.status}
      </Typography>
      {lag !== null && (
        <Typography variant="caption" color={lagOk ? 'text.secondary' : 'warning.main'}>
          · lag {lag.toFixed(1)}s
        </Typography>
      )}
    </Box>
  );
};

// ── IntegrityIcon ─────────────────────────────────────────────────────────────

export const IntegrityIcon: React.FC<{ ok: boolean | null }> = ({ ok }) => {
  if (ok === null) return <Info sx={{ color: 'info.main', fontSize: 18 }} />;
  return ok
    ? <Tooltip title="Chaîne d'intégrité vérifiée"><CheckCircle sx={{ color: 'success.main', fontSize: 18 }} /></Tooltip>
    : <Tooltip title="Erreur d'intégrité détectée !"><Error sx={{ color: 'error.main', fontSize: 18 }} /></Tooltip>;
};

// ── Pagination ────────────────────────────────────────────────────────────────

interface PaginationProps {
  total:    number;
  page:     number;
  pageSize: number;
  onChange: (page: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({ total, page, pageSize, onChange }) => {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
        {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} sur {total.toLocaleString('fr-FR')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {page > 1 && (
          <Chip label="‹" size="small" onClick={() => onChange(page - 1)} clickable />
        )}
        {[...Array(Math.min(5, pages))].map((_, i) => {
          const p = page <= 3 ? i + 1 : page - 2 + i;
          if (p < 1 || p > pages) return null;
          return (
            <Chip
              key={p} label={p} size="small"
              color={p === page ? 'primary' : 'default'}
              onClick={() => onChange(p)} clickable
            />
          );
        })}
        {page < pages && (
          <Chip label="›" size="small" onClick={() => onChange(page + 1)} clickable />
        )}
      </Box>
    </Box>
  );
};
