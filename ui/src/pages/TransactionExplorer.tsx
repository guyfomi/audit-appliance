import React, { useState } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, Drawer, CircularProgress,
  TextField, Button, Grid, Divider, List, ListItem,
  ListItemText, Alert,
} from '@mui/material';
import { Search, SwapHoriz } from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { transactionsApi } from '../lib/api';
import { RiskBadge, OperationBadge, Pagination } from '../components/common';
import type { AuditTransaction } from '../lib/types';

// ── Détail transaction ────────────────────────────────────────────────────────

const TransactionDetail: React.FC<{ txnId: string; onClose: () => void }> = ({ txnId, onClose }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', txnId],
    queryFn:  () => transactionsApi.get(txnId).then(r => r.data),
    enabled:  !!txnId,
  });

  if (isLoading) return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
      <CircularProgress />
    </Box>
  );
  if (!data) return null;

  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <SwapHoriz sx={{ color: 'primary.main' }} />
        <Typography variant="subtitle1" fontWeight={700}>Transaction</Typography>
        <Typography variant="caption" fontFamily="monospace" color="text.secondary">
          {data.transaction_id}
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        {[
          { label: 'Base',          value: data.database_name },
          { label: 'Début',         value: data.start_time ? new Date(data.start_time).toLocaleString('fr-FR') : '—' },
          { label: 'Commit',        value: data.commit_time ? new Date(data.commit_time).toLocaleString('fr-FR') : '—' },
          { label: 'Durée',         value: data.duration_ms ? `${data.duration_ms} ms` : '—' },
          { label: 'User Oracle',   value: data.db_username ?? '—' },
          { label: 'Application',   value: data.application_name ?? '—' },
          { label: 'IP Client',     value: data.client_ip ?? '—' },
          { label: 'Nb changements',value: data.event_count },
          { label: 'Rollback',      value: data.is_rollback ? 'Oui' : 'Non' },
          { label: 'Risque max',    value: <RiskBadge level={data.max_risk_level} /> },
        ].map(r => (
          <Grid item xs={6} key={r.label}>
            <Typography variant="caption" color="text.secondary" display="block">{r.label}</Typography>
            <Typography variant="body2" fontWeight={500}>
              {typeof r.value === 'string' || typeof r.value === 'number' ? r.value : r.value}
            </Typography>
          </Grid>
        ))}
      </Grid>

      <Divider sx={{ my: 1.5 }} />
      <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase">
        Tables modifiées
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
        {data.tables_affected.map(t => (
          <Chip key={t} label={t} size="small" variant="outlined" />
        ))}
      </Box>
    </Box>
  );
};

// ── Page principale ───────────────────────────────────────────────────────────

const TransactionExplorer: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [page,      setPage]      = useState(1);
  const [txnFilter, setTxnFilter] = useState(searchParams.get('id') || '');
  const [submitted, setSubmitted] = useState(searchParams.get('id') || '');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('id'));

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', page, submitted],
    queryFn:  () => transactionsApi.list(page, 50).then(r => r.data),
  });

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Transaction Explorer
      </Typography>

      {/* Recherche par ID */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
          <TextField
            label="Transaction ID" size="small" sx={{ flex: 1 }}
            value={txnFilter}
            onChange={e => setTxnFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setSubmitted(txnFilter)}
            placeholder="ex: 8.23.918273"
            InputProps={{ startAdornment: <SwapHoriz sx={{ mr: 1, color: 'text.disabled', fontSize: 20 }} /> }}
          />
          <Button variant="contained" startIcon={<Search />}
            onClick={() => { setSubmitted(txnFilter); setSelectedId(txnFilter); }}>
            Rechercher
          </Button>
        </Box>
      </Paper>

      {/* Liste des transactions */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>Transaction ID</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Commit</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Durée</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>User Oracle</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>IP</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'center' }}>Changements</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Tables</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Risque max</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map(txn => (
                <TableRow key={txn.id}
                  onClick={() => setSelectedId(txn.transaction_id)}
                  sx={{
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    bgcolor: txn.max_risk_level === 'CRITICAL' ? '#FFF5F5'
                           : txn.max_risk_level === 'HIGH'     ? '#FFFBF0' : 'inherit',
                  }}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {txn.transaction_id}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {txn.commit_time ? new Date(txn.commit_time).toLocaleString('fr-FR') : '—'}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {txn.duration_ms ? `${txn.duration_ms} ms` : '—'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {txn.db_username ?? '—'}
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {txn.client_ip ?? '—'}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    <Chip label={txn.event_count} size="small" />
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }}>
                    {txn.tables_affected.slice(0, 3).join(', ')}
                    {txn.tables_affected.length > 3 && ` +${txn.tables_affected.length - 3}`}
                  </TableCell>
                  <TableCell><RiskBadge level={txn.max_risk_level} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data && (
            <Pagination total={data.total} page={page} pageSize={50} onChange={setPage} />
          )}
        </Paper>
      )}

      {/* Drawer détail */}
      <Drawer anchor="right" open={!!selectedId} onClose={() => setSelectedId(null)}
        PaperProps={{ sx: { width: 520 } }}>
        {selectedId && (
          <TransactionDetail txnId={selectedId} onClose={() => setSelectedId(null)} />
        )}
      </Drawer>
    </Box>
  );
};

export default TransactionExplorer;
