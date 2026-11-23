import React from 'react';
import {
  Box, Grid, Paper, Typography, Chip, CircularProgress,
  List, ListItem, ListItemText, Divider, Button,
} from '@mui/material';
import {
  TrendingUp, Warning, Error as ErrorIcon,
  CheckCircle, Storage, Speed,
} from '@mui/icons-material';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { useDashboard, useCDCStatus } from '../hooks';
import { RiskBadge, CDCStatusBadge } from '../components/common';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label:    string;
  value:    string | number;
  sub?:     string;
  icon?:    React.ReactNode;
  color?:   'default' | 'error' | 'warning' | 'success' | 'info';
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, icon, color = 'default' }) => {
  const colorMap = {
    default: 'text.primary',
    error:   'error.main',
    warning: 'warning.main',
    success: 'success.main',
    info:    'info.main',
  };
  return (
    <Paper sx={{ p: 2.5, height: '100%', borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={500} textTransform="uppercase" letterSpacing={0.5}>
            {label}
          </Typography>
          <Typography variant="h4" fontWeight={700} sx={{ color: colorMap[color], mt: 0.5 }}>
            {typeof value === 'number' ? value.toLocaleString('fr-FR') : value}
          </Typography>
          {sub && (
            <Typography variant="caption" color="text.secondary">{sub}</Typography>
          )}
        </Box>
        {icon && (
          <Box sx={{ color: colorMap[color], opacity: 0.7 }}>{icon}</Box>
        )}
      </Box>
    </Paper>
  );
};

// ── Dashboard Page ────────────────────────────────────────────────────────────

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useDashboard();
  const { data: cdcList }          = useCDCStatus();

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!stats) return null;

  // Graphique événements par heure
  const hourlyChartOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: stats.events_by_hour.map(e => {
        const d = new Date(e.hour);
        return `${d.getHours()}h`;
      }),
    },
    yAxis: { type: 'value' },
    series: [{
      data:      stats.events_by_hour.map(e => e.count),
      type:      'bar',
      itemStyle: { color: '#1565C0', borderRadius: [3, 3, 0, 0] },
    }],
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
  };

  // Graphique distribution des risques
  const riskChartOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type:   'pie',
      radius: ['40%', '70%'],
      data: [
        { value: stats.risk_distribution['LOW']      || 0, name: 'LOW',      itemStyle: { color: '#2E7D32' } },
        { value: stats.risk_distribution['MEDIUM']   || 0, name: 'MEDIUM',   itemStyle: { color: '#1565C0' } },
        { value: stats.risk_distribution['HIGH']     || 0, name: 'HIGH',     itemStyle: { color: '#E65100' } },
        { value: stats.risk_distribution['CRITICAL'] || 0, name: 'CRITICAL', itemStyle: { color: '#B71C1C' } },
      ],
      label: { formatter: '{b}: {c}' },
    }],
  };

  // Graphique top tables
  const topTablesOption = {
    tooltip: { trigger: 'axis' },
    xAxis: {
      type:   'value',
    },
    yAxis: {
      type: 'category',
      data: stats.top_tables.slice(0, 8).map(t => t.table).reverse(),
    },
    series: [{
      data:      stats.top_tables.slice(0, 8).map(t => t.count).reverse(),
      type:      'bar',
      itemStyle: { color: '#0277BD', borderRadius: [0, 3, 3, 0] },
    }],
    grid: { left: 100, right: 20, top: 10, bottom: 30 },
  };

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Dashboard</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {cdcList?.map(cdc => (
            <CDCStatusBadge key={cdc.database_id} status={cdc} />
          ))}
        </Box>
      </Box>

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={4} md={2}>
          <KpiCard label="Événements aujourd'hui" value={stats.events_today}
            sub={`${stats.events_per_second} ev/s`}
            icon={<TrendingUp />} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiCard label="Événements/seconde" value={`${stats.events_per_second}`}
            icon={<Speed />} color="success" />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiCard label="Événements CRITICAL" value={stats.critical_events}
            icon={<ErrorIcon />} color={stats.critical_events > 0 ? 'error' : 'default'} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiCard label="Événements HIGH" value={stats.high_risk_events}
            icon={<Warning />} color={stats.high_risk_events > 10 ? 'warning' : 'default'} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiCard label="Alertes ouvertes" value={stats.open_alerts}
            icon={<Warning />} color={stats.open_alerts > 0 ? 'error' : 'success'} />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <KpiCard
            label="Lag CDC"
            value={stats.cdc_lag_seconds !== null ? `${stats.cdc_lag_seconds.toFixed(1)}s` : 'N/A'}
            icon={<CheckCircle />}
            color={(stats.cdc_lag_seconds ?? 0) > 30 ? 'warning' : 'success'}
          />
        </Grid>
      </Grid>

      {/* ── Opérations du jour ─────────────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'INSERT', value: stats.inserts,  color: '#2E7D32' },
          { label: 'UPDATE', value: stats.updates,  color: '#1565C0' },
          { label: 'DELETE', value: stats.deletes,  color: '#B71C1C' },
        ].map(op => (
          <Grid item xs={4} key={op.label}>
            <Paper sx={{ p: 1.5, textAlign: 'center', borderTop: `3px solid ${op.color}`, borderRadius: 2 }}>
              <Typography variant="h5" fontWeight={700} sx={{ color: op.color }}>
                {op.value.toLocaleString('fr-FR')}
              </Typography>
              <Typography variant="caption" color="text.secondary">{op.label}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {/* ── Graphiques ─────────────────────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>
              Événements (24 dernières heures)
            </Typography>
            <ReactECharts option={hourlyChartOption} style={{ height: 180 }} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>
              Distribution des risques
            </Typography>
            <ReactECharts option={riskChartOption} style={{ height: 180 }} />
          </Paper>
        </Grid>
      </Grid>

      {/* ── Top tables + Top users ─────────────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} md={7}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>Top tables</Typography>
            <ReactECharts option={topTablesOption} style={{ height: 200 }} />
          </Paper>
        </Grid>
        <Grid item xs={12} md={5}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} mb={1}>Top utilisateurs Oracle</Typography>
            <List dense>
              {stats.top_users.slice(0, 8).map((u, i) => (
                <React.Fragment key={u.username}>
                  <ListItem sx={{ px: 0 }}>
                    <ListItemText
                      primary={u.username}
                      primaryTypographyProps={{ fontSize: 13, fontFamily: 'monospace' }}
                    />
                    <Chip label={u.count.toLocaleString('fr-FR')} size="small" />
                  </ListItem>
                  {i < stats.top_users.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          </Paper>
        </Grid>
      </Grid>

      {/* ── Statut stockage ────────────────────────────────────────────────── */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Stockage PostgreSQL</Typography>
                <Typography variant="h6" fontWeight={600}>
                  {(stats.storage_used_bytes / 1_073_741_824).toFixed(1)} GB
                </Typography>
              </Box>
              <Storage sx={{ color: 'info.main', fontSize: 36 }} />
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">Archive</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Chip
                label={stats.archive_status}
                color={stats.archive_status === 'OK' ? 'success' : 'warning'}
                size="small"
              />
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">Intégrité SHA-256</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Chip
                label={stats.integrity_status}
                color={stats.integrity_status === 'OK' ? 'success' : 'error'}
                size="small"
              />
              <Button
                size="small" variant="text"
                onClick={() => navigate('/integrity')}
                sx={{ fontSize: 11 }}
              >
                Vérifier
              </Button>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Dashboard;
