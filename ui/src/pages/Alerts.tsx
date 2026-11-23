import React, { useState } from 'react';
import {
  Box, Paper, Typography, Chip, Button, Select, MenuItem,
  FormControl, InputLabel, Table, TableBody, TableCell,
  TableHead, TableRow, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, CircularProgress, Alert,
} from '@mui/material';
import { CheckCircle, Block, Flag } from '@mui/icons-material';
import { useAlerts, useAcknowledgeAlert } from '../hooks';
import { RiskBadge, Pagination } from '../components/common';
import type { AlertStatus, RiskLevel } from '../lib/types';

const STATUS_COLORS: Record<AlertStatus, 'default' | 'error' | 'warning' | 'success' | 'info'> = {
  OPEN:            'error',
  ACKNOWLEDGED:    'warning',
  RESOLVED:        'success',
  FALSE_POSITIVE:  'default',
};

const Alerts: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<string>('OPEN');
  const [page,         setPage]         = useState(1);
  const [dialogAlert,  setDialogAlert]  = useState<{ id: number; action: string } | null>(null);
  const [notes,        setNotes]        = useState('');

  const { data, isLoading } = useAlerts(statusFilter || undefined, page);
  const { mutate: acknowledge, isPending } = useAcknowledgeAlert();

  const handleAction = (id: number, action: string) => {
    setDialogAlert({ id, action });
    setNotes('');
  };

  const handleConfirm = () => {
    if (!dialogAlert) return;
    acknowledge(
      { id: dialogAlert.id, status: dialogAlert.action, notes },
      { onSuccess: () => { setDialogAlert(null); setNotes(''); } }
    );
  };

  const ACTION_LABELS: Record<string, string> = {
    ACKNOWLEDGED: 'Acquitter',
    RESOLVED:     'Résoudre',
    FALSE_POSITIVE: 'Faux positif',
  };

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>Alertes de sécurité</Typography>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Statut</InputLabel>
          <Select value={statusFilter} label="Statut" onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <MenuItem value="">Toutes</MenuItem>
            <MenuItem value="OPEN">Ouvertes</MenuItem>
            <MenuItem value="ACKNOWLEDGED">Acquittées</MenuItem>
            <MenuItem value="RESOLVED">Résolues</MenuItem>
            <MenuItem value="FALSE_POSITIVE">Faux positifs</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : !data?.items?.length ? (
        <Alert severity="success" sx={{ borderRadius: 2 }}>
          Aucune alerte {statusFilter === 'OPEN' ? 'ouverte' : ''} en ce moment.
        </Alert>
      ) : (
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>Heure</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Sévérité</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Titre</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Règle</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Statut</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.map(alert => (
                <TableRow key={alert.id}
                  sx={{ '&:hover': { bgcolor: 'action.hover' },
                        bgcolor: alert.severity === 'CRITICAL' ? '#FFF5F5'
                               : alert.severity === 'HIGH'     ? '#FFFBF0' : 'inherit' }}>
                  <TableCell sx={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {new Date(alert.alert_time).toLocaleString('fr-FR')}
                  </TableCell>
                  <TableCell><RiskBadge level={alert.severity} /></TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" noWrap fontWeight={500}>{alert.title}</Typography>
                    {alert.description && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {alert.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{alert.rule_name}</TableCell>
                  <TableCell>
                    <Chip label={alert.status} size="small" color={STATUS_COLORS[alert.status]} />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      {alert.status === 'OPEN' && (
                        <>
                          <Button size="small" startIcon={<CheckCircle sx={{ fontSize: 14 }} />}
                            onClick={() => handleAction(alert.id, 'ACKNOWLEDGED')}>
                            Acquitter
                          </Button>
                          <Button size="small" color="error" startIcon={<Flag sx={{ fontSize: 14 }} />}
                            onClick={() => handleAction(alert.id, 'FALSE_POSITIVE')}>
                            FP
                          </Button>
                        </>
                      )}
                      {alert.status === 'ACKNOWLEDGED' && (
                        <Button size="small" color="success" startIcon={<Block sx={{ fontSize: 14 }} />}
                          onClick={() => handleAction(alert.id, 'RESOLVED')}>
                          Résoudre
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data && (
            <Pagination total={data.total} page={page} pageSize={50} onChange={setPage} />
          )}
        </Paper>
      )}

      {/* Dialog de confirmation */}
      <Dialog open={!!dialogAlert} onClose={() => setDialogAlert(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {dialogAlert ? ACTION_LABELS[dialogAlert.action] : ''} l'alerte
        </DialogTitle>
        <DialogContent>
          <TextField
            label="Notes / commentaire"
            multiline rows={3} fullWidth sx={{ mt: 1 }}
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Décrire l'investigation, la cause ou la raison..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogAlert(null)}>Annuler</Button>
          <Button variant="contained" onClick={handleConfirm} disabled={isPending}>
            {isPending ? <CircularProgress size={18} /> : 'Confirmer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Alerts;
