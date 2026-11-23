import React, { useState } from 'react';
import {
  Box, Paper, TextField, Button, Typography,
  Timeline, TimelineItem, TimelineSeparator, TimelineConnector,
  TimelineContent, TimelineDot, TimelineOppositeContent,
  Chip, Grid, CircularProgress, Alert,
} from '@mui/lab';
import { Search, History } from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { useRecordTimeline } from '../hooks';
import { RiskBadge, OperationBadge, BeforeAfterDiff } from '../components/common';
import type { RiskLevel } from '../lib/types';

const DOT_COLOR: Record<RiskLevel, 'error' | 'warning' | 'info' | 'success'> = {
  CRITICAL: 'error',
  HIGH:     'warning',
  MEDIUM:   'info',
  LOW:      'success',
};

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
              value={schema} onChange={e => setSchema(e.target.value)}
              placeholder="ex: BANK"
            />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField label="Table" size="small" fullWidth
              value={table} onChange={e => setTable(e.target.value)}
              placeholder="ex: CUSTOMER"
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField label="Valeur de la clé primaire" size="small" fullWidth
              value={pk} onChange={e => setPk(e.target.value)}
              placeholder="ex: 123456"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
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
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <History sx={{ color: 'primary.main' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {data.total} événement{data.total > 1 ? 's' : ''} — {submitted.schema}.{submitted.table}
              — clé: <code>{submitted.pk}</code>
            </Typography>
            <Chip label={`${data.total} événements`} size="small" color="primary" />
          </Box>

          <Timeline position="right">
            {data.items.map((event, idx) => (
              <TimelineItem key={event.id}>
                <TimelineOppositeContent sx={{ flex: 0.15, py: 1.5, pr: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(event.event_time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </Typography>
                </TimelineOppositeContent>

                <TimelineSeparator>
                  <TimelineDot color={DOT_COLOR[event.risk_level]}
                               variant={event.risk_level === 'LOW' ? 'outlined' : 'filled'} />
                  {idx < data.items.length - 1 && <TimelineConnector />}
                </TimelineSeparator>

                <TimelineContent sx={{ py: 1, px: 2, pb: 2 }}>
                  <Paper variant="outlined" sx={{
                    p: 1.5, borderRadius: 2,
                    borderLeftWidth: event.risk_level !== 'LOW' ? 3 : 1,
                    borderLeftColor: event.risk_level === 'CRITICAL' ? 'error.main'
                                   : event.risk_level === 'HIGH'     ? 'warning.main'
                                   : event.risk_level === 'MEDIUM'   ? 'info.main'
                                   : 'divider',
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <OperationBadge op={event.operation} />
                      <RiskBadge level={event.risk_level} />
                    </Box>

                    {/* Diff avant/après */}
                    {event.changed_columns.length > 0 ? (
                      <BeforeAfterDiff
                        before={(event as any).before_data || {}}
                        after={(event as any).after_data || {}}
                        changedColumns={event.changed_columns}
                        showAll={false}
                      />
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
                  </Paper>
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        </Box>
      )}
    </Box>
  );
};

export default RecordTimeline;
