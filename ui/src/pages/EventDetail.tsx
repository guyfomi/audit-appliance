import React, { useState } from 'react';
import {
  Box, Typography, Chip, Divider, IconButton, Button,
  CircularProgress, Paper, List, ListItem, ListItemIcon,
  ListItemText, Tooltip, Grid, Alert,
} from '@mui/material';
import {
  Close, CheckCircle, Warning, ArrowForward,
  History, SwapHoriz, Shield, ContentCopy,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useEventDetail } from '../hooks';
import { RiskBadge, OperationBadge, BeforeAfterDiff } from '../components/common';
import type { RiskLevel } from '../lib/types';

interface Props {
  eventId: number;
  onClose?: () => void;
}

const RISK_ICON: Record<RiskLevel, React.ReactNode> = {
  CRITICAL: <Warning sx={{ color: 'error.main' }} />,
  HIGH:     <Warning sx={{ color: 'warning.main' }} />,
  MEDIUM:   <Warning sx={{ color: 'info.main' }} />,
  LOW:      <CheckCircle sx={{ color: 'success.main' }} />,
};

const EventDetail: React.FC<Props> = ({ eventId, onClose }) => {
  const navigate           = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const { data: event, isLoading } = useEventDetail(eventId);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!event) return null;

  const pkStr = JSON.stringify(event.primary_key);

  const metaRows = [
    { key: 'Timestamp',    val: new Date(event.event_time).toLocaleString('fr-FR') },
    { key: 'Base',         val: event.database_name },
    { key: 'Schéma',       val: event.schema_name },
    { key: 'Table',        val: event.table_name },
    { key: 'Clé primaire', val: pkStr },
    { key: 'SCN',          val: event.scn?.toLocaleString('fr-FR') ?? '—' },
    { key: 'Transaction',  val: event.transaction_id ?? '—', link: true },
  ];

  const identityRows = [
    { key: 'Utilisateur Oracle', val: event.db_username ?? '—' },
    { key: 'Utilisateur App',    val: event.app_user ?? '—' },
    { key: 'Application',        val: event.application_name ?? event.module ?? '—' },
    { key: 'Adresse IP',         val: event.client_ip ?? '—' },
    { key: 'Hostname',           val: event.hostname ?? '—' },
    { key: 'Module',             val: event.module ?? '—' },
    { key: 'Action',             val: event.action ?? '—' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{
        px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper',
        flexShrink: 0,
      }}>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <OperationBadge op={event.operation} />
            <Typography variant="subtitle1" fontWeight={700}>
              {event.table_name}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Événement #{event.id.toLocaleString('fr-FR')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={`${event.risk_score}/100`}
            color={event.risk_level === 'CRITICAL' || event.risk_level === 'HIGH' ? 'error' : 'default'}
            variant="outlined" size="small"
          />
          <RiskBadge level={event.risk_level} />
        </Box>
        {onClose && (
          <IconButton size="small" onClick={onClose}>
            <Close />
          </IconButton>
        )}
      </Box>

      {/* ── Corps scrollable ─────────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>

        <Grid container spacing={2}>
          {/* Contexte */}
          <Grid item xs={12} sm={6}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase">
                Contexte
              </Typography>
              {metaRows.map(r => (
                <Box key={r.key} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4,
                                       borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                  <Typography variant="caption" color="text.secondary">{r.key}</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" fontFamily="monospace" sx={{ textAlign: 'right', maxWidth: 180,
                                                                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.val}
                    </Typography>
                    {r.link && event.transaction_id && (
                      <Tooltip title="Voir la transaction">
                        <IconButton size="small" onClick={() => navigate(`/transactions?id=${event.transaction_id}`)}>
                          <ArrowForward sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              ))}
            </Paper>
          </Grid>

          {/* Identité */}
          <Grid item xs={12} sm={6}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase">
                Identité
              </Typography>
              {identityRows.map(r => (
                <Box key={r.key} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4,
                                       borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                  <Typography variant="caption" color="text.secondary">{r.key}</Typography>
                  <Typography variant="caption" fontFamily="monospace">{r.val}</Typography>
                </Box>
              ))}
            </Paper>
          </Grid>
        </Grid>

        {/* Diff avant/après */}
        <Paper variant="outlined" sx={{ p: 1.5, mt: 2, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase">
              Modifications
            </Typography>
            <Button size="small" variant="text" onClick={() => setShowAll(s => !s)}>
              {showAll ? 'Masquer inchangées' : 'Voir toutes les colonnes'}
            </Button>
          </Box>
          <BeforeAfterDiff
            before={event.before_data}
            after={event.after_data}
            changedColumns={event.changed_columns}
            showAll={showAll}
          />
        </Paper>

        {/* Raisons du risque */}
        {event.risk_reasons.length > 0 && (
          <Paper variant="outlined" sx={{ p: 1.5, mt: 2, borderRadius: 2 }}>
            <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase" sx={{ mb: 1, display: 'block' }}>
              Pourquoi {event.risk_level} ?
            </Typography>
            <List dense disablePadding>
              {event.risk_reasons.map((r, i) => (
                <ListItem key={i} sx={{ px: 0, alignItems: 'flex-start' }}>
                  <ListItemIcon sx={{ minWidth: 28, mt: 0.3 }}>
                    {RISK_ICON[event.risk_level]}
                  </ListItemIcon>
                  <ListItemText
                    primary={r.reason}
                    secondary={`${r.rule_name} · +${r.score_contribution} pts`}
                    primaryTypographyProps={{ fontSize: 13 }}
                    secondaryTypographyProps={{ fontSize: 11 }}
                  />
                </ListItem>
              ))}
            </List>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">Score total</Typography>
              <Typography variant="h6" fontWeight={700} color="error.main">
                {event.risk_score} / 100
              </Typography>
            </Box>
          </Paper>
        )}

        {/* Intégrité */}
        <Paper variant="outlined" sx={{ p: 1.5, mt: 2, borderRadius: 2 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" textTransform="uppercase" sx={{ mb: 1, display: 'block' }}>
            Intégrité cryptographique
          </Typography>
          {event.event_hash ? (
            <Alert severity="success" icon={<Shield />} sx={{ mb: 1 }}>
              Chaîne SHA-256 vérifiable
            </Alert>
          ) : (
            <Alert severity="warning">Hash non disponible</Alert>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <Typography variant="caption" color="text.disabled" fontFamily="monospace" sx={{ wordBreak: 'break-all', fontSize: 10 }}>
              {event.event_hash}
            </Typography>
            <Tooltip title="Copier le hash">
              <IconButton size="small" onClick={() => navigator.clipboard.writeText(event.event_hash)}>
                <ContentCopy sx={{ fontSize: 12 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Paper>
      </Box>

      {/* ── Footer actions ───────────────────────────────────────────────────── */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, flexShrink: 0 }}>
        <Button size="small" variant="outlined" startIcon={<History />} fullWidth
          onClick={() => {
            const pk = Object.values(event.primary_key)[0] as string;
            navigate(`/timeline?schema=${event.schema_name}&table=${event.table_name}&pk=${pk}`);
            onClose?.();
          }}>
          Timeline
        </Button>
        <Button size="small" variant="outlined" startIcon={<SwapHoriz />} fullWidth
          onClick={() => {
            if (event.transaction_id)
              navigate(`/transactions?id=${event.transaction_id}`);
            onClose?.();
          }}
          disabled={!event.transaction_id}>
          Transaction
        </Button>
      </Box>
    </Box>
  );
};

export default EventDetail;
