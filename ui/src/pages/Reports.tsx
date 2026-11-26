import React, { useState } from 'react';
import {
  Box, Paper, Typography, Grid, Button, Chip,
  Select, MenuItem, FormControl, InputLabel,
  TextField, Alert, CircularProgress, Divider,
} from '@mui/material';
import { Download, Article, Schedule } from '@mui/icons-material';
import { reportsApi } from '../lib/api';

interface ReportDef {
  type:        string;
  label:       string;
  description: string;
  icon:        string;
  params?:     { key: string; label: string; type: string }[];
}

const REPORTS: ReportDef[] = [
  {
    type: 'DAILY_AUDIT',
    label: 'Rapport d\'audit quotidien',
    description: 'Résumé de toutes les modifications de la journée, classées par risque.',
    icon: '📋',
    params: [{ key: 'date', label: 'Date', type: 'date' }],
  },
  {
    type: 'WEEKLY_SECURITY',
    label: 'Rapport sécurité hebdomadaire',
    description: 'Synthèse des événements à risque HIGH et CRITICAL sur 7 jours.',
    icon: '🔒',
  },
  {
    type: 'USER_ACTIVITY',
    label: 'Activité par utilisateur Oracle',
    description: 'Détail des modifications effectuées par chaque utilisateur Oracle.',
    icon: '👤',
    params: [{ key: 'db_username', label: 'Utilisateur Oracle (optionnel)', type: 'text' }],
  },
  {
    type: 'SENSITIVE_TABLE',
    label: 'Tables sensibles',
    description: 'Toutes les modifications sur les tables marquées sensibles ou critiques.',
    icon: '🛡️',
  },
  {
    type: 'CRITICAL_CHANGES',
    label: 'Changements critiques',
    description: 'Tous les événements de niveau CRITICAL sur la période.',
    icon: '🚨',
    params: [
      { key: 'from_date', label: 'Du',  type: 'date' },
      { key: 'to_date',   label: 'Au',  type: 'date' },
    ],
  },
  {
    type: 'AFTER_HOURS',
    label: 'Activité hors heures ouvrées',
    description: 'Modifications effectuées en dehors des heures de travail (08h00–18h00 lun–ven).',
    icon: '🌙',
  },
  {
    type: 'COMPLIANCE',
    label: 'Rapport de conformité',
    description: 'Rapport structuré pour audit réglementaire (RGPD, SOX, PCI-DSS).',
    icon: '⚖️',
    params: [
      { key: 'from_date', label: 'Du', type: 'date' },
      { key: 'to_date',   label: 'Au', type: 'date' },
    ],
  },
  {
    type: 'DATABASE_CHANGE',
    label: 'Changements DDL et structurels',
    description: 'Toutes les opérations DDL (CREATE, ALTER, DROP) et les TRUNCATE.',
    icon: '🗄️',
  },
];

// ── Carte rapport ─────────────────────────────────────────────────────────────

const ReportCard: React.FC<{ report: ReportDef }> = ({ report }) => {
  const [format,  setFormat]  = useState('PDF');
  const [params,  setParams]  = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleGenerate = async () => {
    setRunning(true);
    setDone(false);
    setError(null);
    try {
      await reportsApi.run(report.type, format, params);
      setDone(true);
    } catch {
      setError('Erreur lors de la génération du rapport.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 2, height: '100%',
                 display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Typography sx={{ fontSize: 28 }}>{report.icon}</Typography>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>{report.label}</Typography>
          <Typography variant="caption" color="text.secondary">{report.description}</Typography>
        </Box>
      </Box>

      {report.params?.map(p => (
        <TextField key={p.key} label={p.label} type={p.type} size="small" fullWidth
          InputLabelProps={p.type === 'date' ? { shrink: true } : undefined}
          value={params[p.key] || ''}
          onChange={e => setParams(prev => ({ ...prev, [p.key]: e.target.value }))}
        />
      ))}

      <Divider />

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <Select value={format} onChange={e => setFormat(e.target.value)}>
            {['PDF','CSV','Excel','JSON'].map(f => (
              <MenuItem key={f} value={f}>{f}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained" size="small" fullWidth
          startIcon={running ? <CircularProgress size={16} color="inherit" /> : <Download />}
          onClick={handleGenerate}
          disabled={running}
        >
          Générer
        </Button>
      </Box>

      {done && (
        <Alert severity="success" sx={{ py: 0.5 }}>
          Rapport généré — consultez vos téléchargements.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>
      )}
    </Paper>
  );
};

// ── Page principale ───────────────────────────────────────────────────────────

const Reports: React.FC = () => (
  <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Article sx={{ color: 'primary.main' }} />
      <Typography variant="h5" fontWeight={700}>Rapports</Typography>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
      Générer des rapports d'audit pour les besoins de conformité, de sécurité ou d'investigation forensique.
    </Typography>

    <Alert severity="info" sx={{ mb: 3 }} icon={<Schedule />}>
      Les rapports peuvent aussi être planifiés via Administration → Rapports planifiés.
      Formats disponibles : PDF (mise en page lisible), CSV/Excel (données brutes), JSON (intégration).
    </Alert>

    <Grid container spacing={2}>
      {REPORTS.map(r => (
        <Grid item xs={12} sm={6} md={4} key={r.type}>
          <ReportCard report={r} />
        </Grid>
      ))}
    </Grid>
  </Box>
);

export default Reports;
