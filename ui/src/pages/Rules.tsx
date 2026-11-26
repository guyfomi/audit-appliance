import React, { useState } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, IconButton, Button, Switch,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Grid, Alert, CircularProgress, Tooltip,
} from '@mui/material';
import { Add, Edit, Security, Refresh } from '@mui/icons-material';
import { useRules, useCreateRule } from '../hooks';
import { RiskBadge } from '../components/common';
import { rulesApi } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import type { AuditRule, RiskLevel } from '../lib/types';

// ── Formulaire création/édition règle ─────────────────────────────────────────

const RULE_TYPES = [
  { value: 'TABLE_SENSITIVITY', label: 'Sensibilité de la table' },
  { value: 'OPERATION_TYPE',    label: 'Type d\'opération DML' },
  { value: 'TIME_WINDOW',       label: 'Fenêtre horaire (hors heures ouvrées)' },
  { value: 'VALUE_CHANGE',      label: 'Variation de valeur numérique' },
  { value: 'VOLUME_THRESHOLD',  label: 'Seuil de volume (événements/minute)' },
  { value: 'UNUSUAL_USER',      label: 'Utilisateur inhabituel sur la table' },
  { value: 'IP_RANGE',          label: 'Plage IP (bloquée ou non autorisée)' },
  { value: 'COMPOSITE',         label: 'Composite (AND/OR de conditions)' },
];

const RuleForm: React.FC<{
  rule?:    Partial<AuditRule>;
  onSave:  (rule: Partial<AuditRule>) => void;
  onClose: () => void;
  saving:  boolean;
}> = ({ rule, onSave, onClose, saving }) => {
  const [form, setForm] = useState({
    name:           rule?.name           || '',
    description:    rule?.description    || '',
    rule_type:      rule?.rule_type      || 'TABLE_SENSITIVITY',
    risk_score_add: rule?.risk_score_add || 20,
    risk_level_min: rule?.risk_level_min || 'MEDIUM' as RiskLevel,
    generate_alert: rule?.generate_alert ?? false,
    priority:       rule?.priority       || 50,
    conditions:     JSON.stringify(rule?.conditions || { type: 'TABLE_SENSITIVITY', require: 'sensitive' }, null, 2),
  });

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    try {
      const conditions = JSON.parse(form.conditions);
      onSave({ ...form, conditions });
    } catch {
      alert('JSON de conditions invalide');
    }
  };

  const condExamples: Record<string, string> = {
    TABLE_SENSITIVITY:  JSON.stringify({ type: 'TABLE_SENSITIVITY', require: 'critical' }, null, 2),
    OPERATION_TYPE:     JSON.stringify({ type: 'OPERATION_TYPE', operations: ['DELETE', 'TRUNCATE'] }, null, 2),
    TIME_WINDOW:        JSON.stringify({ type: 'TIME_WINDOW', work_start: [8, 0], work_end: [18, 0], work_days: [0,1,2,3,4] }, null, 2),
    VALUE_CHANGE:       JSON.stringify({ type: 'VALUE_CHANGE', column: 'CREDIT_LIMIT', threshold_pct: 50, direction: 'increase' }, null, 2),
    VOLUME_THRESHOLD:   JSON.stringify({ type: 'VOLUME_THRESHOLD', max_events: 100, window_minutes: 1 }, null, 2),
    UNUSUAL_USER:       JSON.stringify({ type: 'UNUSUAL_USER' }, null, 2),
    IP_RANGE:           JSON.stringify({ type: 'IP_RANGE', blocked_ranges: ['192.168.0.0/16'] }, null, 2),
    COMPOSITE:          JSON.stringify({ type: 'COMPOSITE', logic: 'AND', conditions: [{ type: 'OPERATION_TYPE', operations: ['DELETE'] }, { type: 'TABLE_SENSITIVITY', require: 'sensitive' }] }, null, 2),
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Nom de la règle *" value={form.name} onChange={e => set('name', e.target.value)} fullWidth />
      <TextField label="Description" value={form.description} onChange={e => set('description', e.target.value)} fullWidth multiline rows={2} />

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <FormControl fullWidth>
            <InputLabel>Type de règle</InputLabel>
            <Select value={form.rule_type} label="Type de règle"
              onChange={e => { set('rule_type', e.target.value); set('conditions', condExamples[e.target.value] || '{}'); }}>
              {RULE_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={6}>
          <TextField label="Score à ajouter (0–100)" type="number" fullWidth
            value={form.risk_score_add}
            onChange={e => set('risk_score_add', Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
            inputProps={{ min: 0, max: 100 }}
          />
        </Grid>
        <Grid item xs={6}>
          <FormControl fullWidth>
            <InputLabel>Niveau minimum</InputLabel>
            <Select value={form.risk_level_min} label="Niveau minimum"
              onChange={e => set('risk_level_min', e.target.value)}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={6}>
          <TextField label="Priorité (1=plus haute)" type="number" fullWidth
            value={form.priority}
            onChange={e => set('priority', parseInt(e.target.value) || 50)}
          />
        </Grid>
        <Grid item xs={6}>
          <FormControlLabel
            control={<Switch checked={form.generate_alert} onChange={e => set('generate_alert', e.target.checked)} />}
            label="Générer une alerte"
            sx={{ mt: 1 }}
          />
        </Grid>
      </Grid>

      <TextField
        label="Conditions (JSON)"
        value={form.conditions}
        onChange={e => set('conditions', e.target.value)}
        fullWidth multiline rows={6}
        sx={{ fontFamily: 'monospace' }}
        inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
        helperText="Modifier selon le type de règle sélectionné ci-dessus"
      />
    </Box>
  );
};

// ── Page principale ───────────────────────────────────────────────────────────

const Rules: React.FC = () => {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useRules();
  const { mutate: createRule, isPending } = useCreateRule();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRule,   setEditRule]   = useState<Partial<AuditRule> | undefined>(undefined);

  const handleSave = (rule: Partial<AuditRule>) => {
    if (editRule?.id) {
      rulesApi.update(editRule.id, rule).then(() => {
        qc.invalidateQueries({ queryKey: ['rules'] });
        setDialogOpen(false);
      });
    } else {
      createRule(rule, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleToggle = async (rule: AuditRule) => {
    await rulesApi.update(rule.id, { is_active: !rule.is_active });
    qc.invalidateQueries({ queryKey: ['rules'] });
  };

  const handleReload = () => rulesApi.reload().then(() => alert('Règles rechargées'));

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Security sx={{ color: 'primary.main' }} />
          <Typography variant="h5" fontWeight={700}>Règles de risque</Typography>
          {rules && <Chip label={`${rules.filter(r => r.is_active).length} actives`} size="small" color="primary" />}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Recharger les règles dans le moteur sans redémarrage">
            <Button startIcon={<Refresh />} onClick={handleReload} variant="outlined" size="small">
              Recharger
            </Button>
          </Tooltip>
          <Button startIcon={<Add />} variant="contained" size="small"
            onClick={() => { setEditRule(undefined); setDialogOpen(true); }}>
            Nouvelle règle
          </Button>
        </Box>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        Les règles sont évaluées par ordre de priorité croissante (1 = plus prioritaire).
        Le score total est plafonné à 100. Les règles inactives ne sont pas évaluées.
      </Alert>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600, width: 60 }}>Active</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Nom</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'center' }}>+Score</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Niveau min</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'center' }}>Alerte</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'center' }}>Priorité</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'center' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules?.sort((a, b) => a.priority - b.priority).map(rule => (
                <TableRow key={rule.id}
                  sx={{ opacity: rule.is_active ? 1 : 0.5, '&:hover': { bgcolor: 'action.hover' } }}>
                  <TableCell>
                    <Switch size="small" checked={rule.is_active} onChange={() => handleToggle(rule)} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{rule.name}</Typography>
                    {rule.description && (
                      <Typography variant="caption" color="text.secondary">{rule.description}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip label={rule.rule_type} size="small" variant="outlined" sx={{ fontSize: 10 }} />
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" fontWeight={600} color="primary.main">
                      +{rule.risk_score_add}
                    </Typography>
                  </TableCell>
                  <TableCell><RiskBadge level={rule.risk_level_min} /></TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    {rule.generate_alert
                      ? <Chip label="Oui" size="small" color="error" />
                      : <Chip label="Non" size="small" />}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" fontWeight={500}>{rule.priority}</Typography>
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    <IconButton size="small" onClick={() => { setEditRule(rule); setDialogOpen(true); }}>
                      <Edit fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Dialog formulaire */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editRule?.id ? 'Modifier la règle' : 'Nouvelle règle de risque'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <RuleForm rule={editRule} onSave={handleSave} onClose={() => setDialogOpen(false)} saving={isPending} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Annuler</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Rules;
