import React, { useState, useCallback, useRef } from 'react';
import {
  Box, Paper, Drawer, Grid, TextField, Select, MenuItem,
  FormControl, InputLabel, Button, Chip, Typography,
  IconButton, Divider, CircularProgress, Tooltip,
} from '@mui/material';
import {
  Search, FilterAlt, Close, Download, Refresh,
} from '@mui/icons-material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridReadyEvent } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-material.css';

import { useEventSearch } from '../hooks';
import { RiskBadge, OperationBadge, Pagination } from '../components/common';
import EventDetail from './EventDetail';
import type { AuditEventSummary, EventSearchParams, RiskLevel, Operation } from '../lib/types';

const DEFAULT_PARAMS: EventSearchParams = {
  page: 1, page_size: 100,
  sort_by: 'event_time', sort_dir: 'desc',
};

// ── Filtre latéral ────────────────────────────────────────────────────────────

interface FilterPanelProps {
  params:   EventSearchParams;
  onChange: (p: EventSearchParams) => void;
  onReset:  () => void;
}

const FilterPanel: React.FC<FilterPanelProps> = ({ params, onChange, onReset }) => {
  const set = (key: keyof EventSearchParams, val: unknown) =>
    onChange({ ...params, [key]: val || undefined, page: 1 });

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, overflowY: 'auto' }}>
      <Typography variant="subtitle2" fontWeight={600}>Filtres</Typography>

      <TextField label="De" type="datetime-local" size="small" fullWidth
        InputLabelProps={{ shrink: true }}
        value={params.from_time?.slice(0, 16) || ''}
        onChange={e => set('from_time', e.target.value ? e.target.value + ':00Z' : '')}
      />
      <TextField label="À" type="datetime-local" size="small" fullWidth
        InputLabelProps={{ shrink: true }}
        value={params.to_time?.slice(0, 16) || ''}
        onChange={e => set('to_time', e.target.value ? e.target.value + ':00Z' : '')}
      />

      <Divider />

      <TextField label="Base de données" size="small" fullWidth
        value={params.database_name || ''}
        onChange={e => set('database_name', e.target.value)}
      />
      <TextField label="Schéma" size="small" fullWidth
        value={params.schema_name || ''}
        onChange={e => set('schema_name', e.target.value)}
      />
      <TextField label="Table" size="small" fullWidth
        value={params.table_name || ''}
        onChange={e => set('table_name', e.target.value)}
      />

      <Divider />

      <FormControl size="small" fullWidth>
        <InputLabel>Opération</InputLabel>
        <Select value={params.operation || ''} label="Opération"
          onChange={e => set('operation', e.target.value as Operation)}>
          <MenuItem value="">Toutes</MenuItem>
          {['INSERT','UPDATE','DELETE','TRUNCATE','DDL'].map(op => (
            <MenuItem key={op} value={op}>{op}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth>
        <InputLabel>Niveau de risque</InputLabel>
        <Select value={params.risk_level || ''} label="Niveau de risque"
          onChange={e => set('risk_level', e.target.value as RiskLevel)}>
          <MenuItem value="">Tous</MenuItem>
          {['CRITICAL','HIGH','MEDIUM','LOW'].map(l => (
            <MenuItem key={l} value={l}>{l}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <Divider />

      <TextField label="Utilisateur Oracle" size="small" fullWidth
        value={params.db_username || ''}
        onChange={e => set('db_username', e.target.value)}
      />
      <TextField label="Utilisateur applicatif" size="small" fullWidth
        value={params.app_user || ''}
        onChange={e => set('app_user', e.target.value)}
      />
      <TextField label="Adresse IP" size="small" fullWidth
        value={params.client_ip || ''}
        onChange={e => set('client_ip', e.target.value)}
      />
      <TextField label="Transaction ID" size="small" fullWidth
        value={params.transaction_id || ''}
        onChange={e => set('transaction_id', e.target.value)}
      />
      <TextField label="Colonne modifiée" size="small" fullWidth
        value={params.changed_column || ''}
        onChange={e => set('changed_column', e.target.value)}
      />

      <Divider />

      <Button variant="outlined" size="small" onClick={onReset} startIcon={<Close />}>
        Réinitialiser
      </Button>
    </Box>
  );
};

// ── Active filter chips ───────────────────────────────────────────────────────

const ActiveFilters: React.FC<{ params: EventSearchParams; onRemove: (k: string) => void }> = ({ params, onRemove }) => {
  const labels: Record<string, string> = {
    database_name: 'DB', schema_name: 'Schéma', table_name: 'Table',
    operation: 'Op', risk_level: 'Risque', db_username: 'User Oracle',
    app_user: 'User App', client_ip: 'IP', transaction_id: 'Txn',
    changed_column: 'Colonne',
  };
  const chips = Object.entries(labels)
    .filter(([k]) => params[k as keyof EventSearchParams])
    .map(([k, l]) => ({ key: k, label: `${l}: ${params[k as keyof EventSearchParams]}` }));

  if (chips.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1, pb: 0.5 }}>
      {chips.map(c => (
        <Chip key={c.key} label={c.label} size="small"
          onDelete={() => onRemove(c.key)} />
      ))}
    </Box>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const AuditExplorer: React.FC = () => {
  const [params,       setParams]       = useState<EventSearchParams>(DEFAULT_PARAMS);
  const [submitted,    setSubmitted]    = useState(DEFAULT_PARAMS);
  const [selectedId,   setSelectedId]  = useState<number | null>(null);
  const [quickSearch,  setQuickSearch] = useState('');
  const gridRef = useRef<AgGridReact>(null);

  const { data, isLoading, isFetching, refetch } = useEventSearch(submitted);

  const handleSearch = useCallback(() => {
    setSubmitted({ ...params, page: 1 });
  }, [params]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleReset = () => {
    setParams(DEFAULT_PARAMS);
    setSubmitted(DEFAULT_PARAMS);
    setQuickSearch('');
  };

  const handleRemoveFilter = (key: string) => {
    const p = { ...params, [key]: undefined };
    setParams(p);
    setSubmitted({ ...p, page: 1 });
  };

  // AG Grid column definitions
  const colDefs: ColDef<AuditEventSummary>[] = [
    {
      field: 'event_time', headerName: 'Heure', width: 85, sort: 'desc',
      valueFormatter: p => new Date(p.value).toLocaleTimeString('fr-FR'),
      cellStyle: { color: '#666', fontSize: 12 },
    },
    { field: 'database_name', headerName: 'Base', width: 100, hide: true },
    { field: 'schema_name',   headerName: 'Schéma', width: 80 },
    { field: 'table_name',    headerName: 'Table', width: 110, cellStyle: { fontWeight: 500 } },
    {
      field: 'operation', headerName: 'Op', width: 80,
      cellRenderer: (p: { value: Operation }) => <OperationBadge op={p.value} />,
    },
    {
      field: 'primary_key', headerName: 'Clé primaire', width: 110,
      valueGetter: p => JSON.stringify(p.data?.primary_key || {}),
      cellStyle: { fontFamily: 'monospace', fontSize: 11 },
    },
    { field: 'db_username',  headerName: 'User Oracle', width: 110 },
    { field: 'app_user',     headerName: 'User App',    width: 90 },
    { field: 'client_ip',    headerName: 'IP',          width: 120, cellStyle: { fontFamily: 'monospace', fontSize: 11 } },
    {
      field: 'changed_columns', headerName: 'Colonnes modifiées', flex: 1,
      valueFormatter: p => (p.value || []).join(', '),
      cellStyle: { color: '#666', fontSize: 11 },
    },
    {
      field: 'risk_level', headerName: 'Risque', width: 110,
      cellRenderer: (p: { value: RiskLevel; data: AuditEventSummary }) =>
        <RiskBadge level={p.value} score={p.data?.risk_score} />,
    },
  ];

  // Coloration des lignes par risque
  const getRowStyle = (p: { data: AuditEventSummary }) => {
    if (!p.data) return {};
    const bgMap: Record<RiskLevel, string> = {
      CRITICAL: '#FFF5F5',
      HIGH:     '#FFFBF0',
      MEDIUM:   '#F0F7FF',
      LOW:      'transparent',
    };
    return { background: bgMap[p.data.risk_level] || 'transparent' };
  };

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Panneau filtres ───────────────────────────────────────────────── */}
      <Paper sx={{ width: 240, flexShrink: 0, borderRight: 1, borderColor: 'divider',
                   overflow: 'hidden', borderRadius: 0 }}>
        <FilterPanel params={params} onChange={setParams} onReset={handleReset} />
      </Paper>

      {/* ── Contenu principal ─────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Barre outils */}
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider',
                   display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            size="small" placeholder="Recherche rapide : table, user, IP, transaction…"
            value={quickSearch}
            onChange={e => setQuickSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ flex: 1 }}
            InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'text.disabled', fontSize: 20 }} /> }}
          />
          <Button variant="contained" size="small" onClick={handleSearch}
                  startIcon={<FilterAlt />}>
            Filtrer
          </Button>
          <Tooltip title="Rafraîchir">
            <IconButton size="small" onClick={() => refetch()}>
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {data ? `${data.total.toLocaleString('fr-FR')} résultats` : ''}
          </Typography>
          <Tooltip title="Exporter (CSV)">
            <IconButton size="small"
              onClick={() => gridRef.current?.api?.exportDataAsCsv({ fileName: 'audit-export.csv' })}>
              <Download fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Chips filtres actifs */}
        <ActiveFilters params={submitted} onRemove={handleRemoveFilter} />

        {/* Grille AG Grid */}
        <Box className="ag-theme-material" sx={{ flex: 1, overflow: 'hidden' }}>
          {isLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          ) : (
            <AgGridReact<AuditEventSummary>
              ref={gridRef}
              rowData={data?.items ?? []}
              columnDefs={colDefs}
              defaultColDef={{ resizable: true, sortable: true }}
              rowSelection="single"
              getRowStyle={getRowStyle as never}
              onRowClicked={e => e.data && setSelectedId(e.data.id)}
              suppressPaginationPanel
              overlayLoadingTemplate="<span>Chargement…</span>"
              overlayNoRowsTemplate="<span>Aucun événement pour ces critères</span>"
              suppressMovableColumns
              animateRows
            />
          )}
        </Box>

        {/* Pagination */}
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          {data && (
            <Pagination
              total={data.total}
              page={submitted.page}
              pageSize={submitted.page_size}
              onChange={p => setSubmitted(prev => ({ ...prev, page: p }))}
            />
          )}
        </Box>
      </Box>

      {/* ── Drawer détail ─────────────────────────────────────────────────── */}
      <Drawer
        anchor="right"
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        PaperProps={{ sx: { width: 660, overflow: 'hidden' } }}
      >
        {selectedId !== null && (
          <EventDetail
            eventId={selectedId}
            onClose={() => setSelectedId(null)}
          />
        )}
      </Drawer>
    </Box>
  );
};

export default AuditExplorer;
