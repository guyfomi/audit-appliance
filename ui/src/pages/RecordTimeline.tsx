import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRecordTimeline } from '../hooks';
import { RiskBadge, OperationBadge } from '../components/common';
import type { RiskLevel } from '../lib/types';

const DOT_COLOR: Record<RiskLevel, 'error' | 'warning' | 'info' | 'success'> = {
  CRITICAL: 'error',
  HIGH:     'warning',
  MEDIUM:   'info',
  LOW:      'success',
};

import {
  Box, Paper, TextField, Button, Typography,
  Grid, CircularProgress, Alert, Chip,
} from '@mui/material';
import { Search, History } from '@mui/icons-material';

const RecordTimeline: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [schema, setSchema] = useState(searchParams.get('schema') || 'BANK');
  const [table,  setTable]  = useState(searchParams.get('table')  || 'CUSTOMER');
  const [pk,     setPk]     = useState(searchParams.get('pk')     || '');
  const [submitted, setSubmitted] = useState({
    schema: searchParams.get('schema') || '',
    table:  searchParams.get('table')  || '',
    pk:     searchParams.get('pk')     || '',
  });

  const { data, isLoading } = useRecordTimeline(
    submitted.schema, submitted.table, submitted.pk, 1,
    !!(submitted.schema && submitted.table && submitted.pk)
  );

  const handleSearch = () => setSubmitted({ schema, table, pk });

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Record Timeline
      </Typography>

      {/* ── Formulaire de recherche ────────────────────────────────────────── */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
          Identifier l'enregistrement
        </Typography>
        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={12} sm={3}>
            <TextField label="Schéma" size="small" fullWidth
              value={schema} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSchema(e.target.value)}
              placeholder="ex: BANK"
            />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField label="Table" size="small" fullWidth
              value={table} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTable(e.target.value)}
              placeholder="ex: CUSTOMER"
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField label="Valeur de la clé primaire" size="small" fullWidth
              value={pk} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPk(e.target.value)}
              placeholder="ex: 123456"
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <Button variant="contained" fullWidth startIcon={<Search />} onClick={handleSearch}>
              Rechercher
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* ── Résultats ─────────────────────────────────────────────────────── */}
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {data && data.total === 0 && (
        <Alert severity="info">
          Aucun événement trouvé pour {submitted.schema}.{submitted.table} — clé: {submitted.pk}
        </Alert>
      )}

      {data && data.total > 0 && (
        <Box sx={{ p: 1, borderRadius: 1, border: '1px solid #e0e0e0' }}>
          <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
            {data.total} événement{data.total > 1 ? 's' : ''} — {submitted.schema}.{submitted.table}
          </Typography>
          <Chip label={`${data.total} événements`} size="small" color="primary" sx={{ my: 1 }} />

          {data.items.map((event, idx) => (
            <Box key={event.id} sx={{ p: 1, borderBottom: '1px solid #f0f0f0' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <OperationBadge op={event.operation} />
                <RiskBadge level={event.risk_level} />
                <Typography variant="caption" color="text.secondary">
                  {new Date(event.event_time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Typography>
              </Box>

              {event.changed_columns.length > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {event.changed_columns.length} colonne{event.changed_columns.length > 1 ? 's' : ''} modifiées
                </Typography>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {event.operation === 'INSERT' ? 'Enregistrement créé' : 'Aucune colonne capturée'}
                </Typography>
              )}

              <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                {event.db_username && (
                  <Typography variant="caption" color="text.secondary">
                    👤 {event.db_username}
                    {event.app_user && event.app_user !== event.db_username && ` (${event.app_user})`}
                  </Typography>
                )}
                {event.client_ip && (
                  <Typography variant="caption" color="text.secondary">
                    🌐 {event.client_ip}
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default RecordTimeline;
