import React from 'react';
import {
  Box, Paper, Typography, Grid, Chip, LinearProgress,
  List, ListItem, ListItemIcon, ListItemText, Divider,
  Button, CircularProgress, Alert,
} from '@mui/material';
import {
  CheckCircle, Error, Warning,
  Storage, Memory, Speed, NetworkCheck,
  FiberManualRecord, Refresh,
} from '@mui/icons-material';
import { useHealth, useCDCStatus, useDashboard } from '../hooks';
import { useQueryClient } from '@tanstack/react-query';

// ── Composant barre de jauge ──────────────────────────────────────────────────

const GaugeRow: React.FC<{
  label:  string;
  value:  number;
  unit?:  string;
  warn?:  number;
  crit?:  number;
  invert?: boolean;
}> = ({ label, value, unit = '%', warn = 70, crit = 90, invert = false }) => {
  const pct     = Math.min(100, Math.max(0, value));
  const isWarn  = invert ? pct < (100 - warn) : pct >= warn;
  const isCrit  = invert ? pct < (100 - crit) : pct >= crit;
  const color   = isCrit ? 'error' : isWarn ? 'warning' : 'success';

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption">{label}</Typography>
        <Typography variant="caption" fontWeight={600} color={`${color}.main`}>
          {typeof value === 'number' ? value.toFixed(1) : value}{unit}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={color}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  );
};

// ── Composant statut service ──────────────────────────────────────────────────

const ServiceRow: React.FC<{ label: string; status: 'ok' | 'warn' | 'error'; detail?: string }> = ({ label, status, detail }) => {
  const icon = status === 'ok'   ? <CheckCircle sx={{ color: 'success.main', fontSize: 18 }} />
             : status === 'warn' ? <Warning sx={{ color: 'warning.main', fontSize: 18 }} />
             :                     <Error sx={{ color: 'error.main', fontSize: 18 }} />;

  return (
    <ListItem dense disableGutters>
      <ListItemIcon sx={{ minWidth: 28 }}>{icon}</ListItemIcon>
      <ListItemText
        primary={label}
        secondary={detail}
        primaryTypographyProps={{ fontSize: 13 }}
        secondaryTypographyProps={{ fontSize: 11 }}
      />
    </ListItem>
  );
};

// ── Health Page ───────────────────────────────────────────────────────────────

const Health: React.FC = () => {
  const qc = useQueryClient();
  const { data: health,    isLoading: hLoading }   = useHealth();
  const { data: cdcList,   isLoading: cdcLoading } = useCDCStatus();
  const { data: dashboard, isLoading: dLoading }   = useDashboard();

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['health'] });
    qc.invalidateQueries({ queryKey: ['cdc'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  if (hLoading || cdcLoading || dLoading) {
    return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <CircularProgress />
    </Box>;
  }

  const checks  = health?.checks;
  const overall = health?.status ?? 'unknown';
  const cdc     = cdcList?.[0];

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h5" fontWeight={700}>Santé système</Typography>
          <Chip
            label={overall === 'ok' ? 'Opérationnel' : overall === 'degraded' ? 'Dégradé' : 'Erreur'}
            color={overall === 'ok' ? 'success' : overall === 'degraded' ? 'warning' : 'error'}
            icon={overall === 'ok' ? <CheckCircle /> : <Warning />}
          />
        </Box>
        <Button startIcon={<Refresh />} onClick={refreshAll} size="small">
          Rafraîchir
        </Button>
      </Box>

      {overall !== 'ok' && (
        <Alert severity={overall === 'degraded' ? 'warning' : 'error'} sx={{ mb: 2 }}>
          L'appliance présente des problèmes. Consulter les détails ci-dessous.
        </Alert>
      )}

      <Grid container spacing={2}>

        {/* ── Ressources système ─────────────────────────────────────────── */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Memory sx={{ color: 'primary.main' }} />
              <Typography variant="subtitle2" fontWeight={600}>Ressources</Typography>
            </Box>
            <GaugeRow label="Disque utilisé"
              value={checks ? 100 - checks.disk_free_pct : 0}
              warn={70} crit={90}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Libre : {checks?.disk_free_gb?.toFixed(1)} GB
            </Typography>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="caption" color="text.secondary">PostgreSQL</Typography>
              <Chip
                label={checks?.postgresql === 'ok' ? 'Connecté' : checks?.postgresql}
                size="small"
                color={checks?.postgresql === 'ok' ? 'success' : 'error'}
              />
            </Box>
          </Paper>
        </Grid>

        {/* ── CDC ─────────────────────────────────────────────────────────── */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <NetworkCheck sx={{ color: 'primary.main' }} />
              <Typography variant="subtitle2" fontWeight={600}>CDC — {cdc?.database_name}</Typography>
            </Box>
            <List dense disablePadding>
              <ServiceRow
                label={`Statut : ${cdc?.status ?? 'N/A'}`}
                status={cdc?.status === 'RUNNING' ? 'ok' : cdc?.status === 'PAUSED' ? 'warn' : 'error'}
              />
              <ServiceRow
                label={`Lag CDC : ${cdc?.lag_seconds?.toFixed(1) ?? 'N/A'} s`}
                status={(cdc?.lag_seconds ?? 0) < 30 ? 'ok' : (cdc?.lag_seconds ?? 0) < 300 ? 'warn' : 'error'}
              />
              <ServiceRow
                label={`Intégrité SHA-256`}
                status={checks?.integrity_ok === true ? 'ok' : checks?.integrity_ok === false ? 'error' : 'warn'}
                detail={checks?.integrity_ok === true ? 'Dernière vérification OK'
                      : checks?.integrity_ok === false ? 'ERREUR — chaîne compromise'
                      : 'Non vérifiée'}
              />
            </List>
          </Paper>
        </Grid>

        {/* ── Métriques applicatives ─────────────────────────────────────── */}
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Speed sx={{ color: 'primary.main' }} />
              <Typography variant="subtitle2" fontWeight={600}>Métriques</Typography>
            </Box>
            {[
              { label: 'Événements aujourd\'hui', value: dashboard?.events_today?.toLocaleString('fr-FR') ?? '—' },
              { label: 'Événements / seconde',    value: `${dashboard?.events_per_second ?? 0} ev/s` },
              { label: 'Alertes ouvertes',         value: dashboard?.open_alerts ?? 0 },
              { label: 'Events CRITICAL',          value: dashboard?.critical_events ?? 0 },
              { label: 'Archive',                  value: dashboard?.archive_status ?? '—' },
              { label: 'Stockage PG',              value: `${((dashboard?.storage_used_bytes ?? 0) / 1_073_741_824).toFixed(1)} GB` },
            ].map(m => (
              <Box key={m.label} sx={{ display: 'flex', justifyContent: 'space-between',
                                       py: 0.5, borderBottom: 1, borderColor: 'divider',
                                       '&:last-child': { borderBottom: 0 } }}>
                <Typography variant="caption" color="text.secondary">{m.label}</Typography>
                <Typography variant="caption" fontWeight={600}>{m.value}</Typography>
              </Box>
            ))}
          </Paper>
        </Grid>

        {/* ── Services systemd ─────────────────────────────────────────────── */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Storage sx={{ color: 'primary.main' }} />
              <Typography variant="subtitle2" fontWeight={600}>Services</Typography>
            </Box>
            <Grid container spacing={2}>
              {[
                { name: 'Audit API (FastAPI)',       key: 'api' },
                { name: 'Audit Engine',              key: 'engine' },
                { name: 'CDC Adapter (SynchDB)',     key: 'cdc' },
                { name: 'Archive Worker',            key: 'archive' },
                { name: 'PostgreSQL 16',             key: 'postgresql' },
                { name: 'Nginx (reverse proxy)',     key: 'nginx' },
              ].map(svc => (
                <Grid item xs={6} sm={4} md={2} key={svc.key}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1,
                             border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
                    <FiberManualRecord sx={{ fontSize: 10, color: 'success.main' }} />
                    <Typography variant="caption" fontWeight={500}>{svc.name}</Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Health;
