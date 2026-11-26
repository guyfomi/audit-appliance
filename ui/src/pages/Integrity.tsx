import React, { useState } from 'react';
import {
  Box, Paper, Typography, Button, Grid, Alert, Chip,
  CircularProgress, TextField, LinearProgress, Tooltip,
  List, ListItem, ListItemIcon, ListItemText, Divider,
} from '@mui/material';
import { Lock, CheckCircle, Error, Verified, PlayArrow, Info } from '@mui/icons-material';
import { useIntegrityStatus } from '../hooks';
import { integrityApi } from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import type { IntegrityVerifyResult } from '../lib/types';

const Integrity: React.FC = () => {
  const { data: status }  = useIntegrityStatus();
  const [dbId,     setDbId]     = useState('1');
  const [schema,   setSchema]   = useState('BANK');
  const [table,    setTable]    = useState('CUSTOMER');
  const [fromTime, setFromTime] = useState('');
  const [toTime,   setToTime]   = useState('');
  const [running,  setRunning]  = useState(false);
  const [result,   setResult]   = useState<IntegrityVerifyResult | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const handleVerify = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await integrityApi.verify(
        parseInt(dbId), schema, table,
        fromTime || undefined, toTime || undefined
      );
      setResult(res.data);
    } catch (e: unknown) {
      setError('Erreur lors de la vérification. Vérifier les paramètres.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Lock sx={{ color: 'primary.main' }} />
        <Typography variant="h5" fontWeight={700}>Intégrité cryptographique</Typography>
      </Box>

      {/* Explication */}
      <Alert severity="info" sx={{ mb: 3 }} icon={<Info />}>
        Chaque événement d'audit est lié au précédent par une chaîne SHA-256
        (<em>event_hash = SHA256(données canoniques + hash_précédent)</em>).
        Toute modification d'un événement archivé brise la chaîne et est détectée.
      </Alert>

      {/* Statut global */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
            {status?.last_verified_ok === true ? (
              <CheckCircle sx={{ fontSize: 40, color: 'success.main' }} />
            ) : status?.last_verified_ok === false ? (
              <Error sx={{ fontSize: 40, color: 'error.main' }} />
            ) : (
              <Lock sx={{ fontSize: 40, color: 'text.disabled' }} />
            )}
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Dernière vérification
            </Typography>
            <Chip
              label={status?.last_verified_ok === true ? 'OK' : status?.last_verified_ok === false ? 'ERREUR' : 'Non vérifiée'}
              color={status?.last_verified_ok === true ? 'success' : status?.last_verified_ok === false ? 'error' : 'default'}
              size="small" sx={{ mt: 0.5 }}
            />
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">Dernier checkpoint</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5 }}>
              {status?.last_checkpoint_time
                ? new Date(status.last_checkpoint_time).toLocaleString('fr-FR')
                : '—'}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">Dernière vérification</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5 }}>
              {status?.last_verified_at
                ? new Date(status.last_verified_at).toLocaleString('fr-FR')
                : '—'}
            </Typography>
          </Paper>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Paper sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary">Total checkpoints</Typography>
            <Typography variant="h5" fontWeight={700} color="primary.main" sx={{ mt: 0.5 }}>
              {status?.total_checkpoints ?? '—'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Formulaire de vérification */}
      <Paper sx={{ p: 2.5, borderRadius: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Verified sx={{ color: 'primary.main' }} />
          <Typography variant="subtitle1" fontWeight={600}>
            Vérifier la chaîne d'une table
          </Typography>
        </Box>

        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={6} sm={2}>
            <TextField label="Database ID" size="small" fullWidth
              value={dbId} onChange={e => setDbId(e.target.value)} type="number" />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="Schéma" size="small" fullWidth
              value={schema} onChange={e => setSchema(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="Table" size="small" fullWidth
              value={table} onChange={e => setTable(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="De (optionnel)" size="small" fullWidth type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={fromTime} onChange={e => setFromTime(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <TextField label="À (optionnel)" size="small" fullWidth type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={toTime} onChange={e => setToTime(e.target.value)} />
          </Grid>
          <Grid item xs={6} sm={2}>
            <Button variant="contained" fullWidth startIcon={running ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
              onClick={handleVerify} disabled={running || !schema || !table}>
              {running ? 'Vérification…' : 'Vérifier'}
            </Button>
          </Grid>
        </Grid>

        {running && <LinearProgress sx={{ mt: 2 }} />}

        {/* Résultat */}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        {result && (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            {result.ok ? (
              <Alert severity="success" icon={<CheckCircle />}>
                <strong>Chaîne intègre</strong> — {result.events_checked.toLocaleString('fr-FR')} événements
                vérifiés en {result.duration_ms} ms. Aucune altération détectée.
              </Alert>
            ) : (
              <Alert severity="error" icon={<Error />}>
                <strong>Chaîne compromise !</strong> — Erreur à l'événement #{result.error_at_id}
                <br />
                <code style={{ fontSize: 11 }}>{result.error_message}</code>
                <br />
                <strong>Action recommandée :</strong> contacter immédiatement l'équipe sécurité
                et isoler les accès à la base d'audit.
              </Alert>
            )}

            <List dense sx={{ mt: 1 }}>
              <ListItem><ListItemText primary="Événements vérifiés" secondary={result.events_checked.toLocaleString('fr-FR')} /></ListItem>
              <ListItem><ListItemText primary="Durée" secondary={`${result.duration_ms} ms`} /></ListItem>
              {result.error_at_id && <ListItem><ListItemText primary="Événement en erreur" secondary={`#${result.error_at_id}`} /></ListItem>}
            </List>
          </Box>
        )}
      </Paper>

      {/* Principe de la chaîne */}
      <Paper sx={{ p: 2.5, borderRadius: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
          Principe de la chaîne SHA-256
        </Typography>
        <Box sx={{ fontFamily: 'monospace', fontSize: 12, p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
          <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', lineHeight: 2 }}>
            Événement 1 : hash = SHA256(données + "GENESIS") = <strong>a3f8d2e1…</strong><br />
            Événement 2 : hash = SHA256(données + <strong>a3f8d2e1…</strong>) = <strong>7c1e3a8f…</strong><br />
            Événement 3 : hash = SHA256(données + <strong>7c1e3a8f…</strong>) = <strong>b9d4071e…</strong><br />
            …<br />
            Si l'événement 2 est modifié → son hash change → la chaîne se brise à l'événement 3
          </Typography>
        </Box>
        <Alert severity="warning" sx={{ mt: 1.5 }} icon={<Lock />}>
          Les événements d'audit sont en mode <strong>append-only</strong>.
          Aucune opération UPDATE ou DELETE n'est autorisée sur la table audit_event,
          ni depuis l'API ni depuis l'interface.
        </Alert>
      </Paper>
    </Box>
  );
};

export default Integrity;
