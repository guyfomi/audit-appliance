import React, { useState } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, Chip, Button, IconButton, Dialog,
  DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, Switch,
  FormControlLabel, Alert, CircularProgress, Avatar, Tooltip,
} from '@mui/material';
import { Add, Block, Person, VpnKey } from '@mui/icons-material';
import { useUsers } from '../hooks';
import { usersApi } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../lib/types';

const ROLE_COLORS: Record<UserRole, 'error' | 'warning' | 'info' | 'default'> = {
  ADMIN:    'error',
  AUDITOR:  'warning',
  ANALYST:  'info',
  READONLY: 'default',
};

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  ADMIN:    'Toutes les permissions — créer utilisateurs, modifier règles, contrôler CDC',
  AUDITOR:  'Lecture + vérification intégrité + contrôle CDC',
  ANALYST:  'Lecture + acquittement alertes + export',
  READONLY: 'Consultation uniquement — aucune action',
};

// ── Formulaire création ───────────────────────────────────────────────────────

const CreateUserForm: React.FC<{
  onSave:  (u: { username: string; email: string; full_name: string; role: UserRole; password?: string }) => void;
  onClose: () => void;
  saving:  boolean;
}> = ({ onSave, onClose, saving }) => {
  const [form, setForm] = useState({
    username: '', email: '', full_name: '',
    role: 'READONLY' as UserRole, password: '', auto_password: true,
  });
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const isValid = form.username && form.email &&
    (form.auto_password || form.password.length >= 12);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
      <TextField label="Nom d'utilisateur *" value={form.username}
        onChange={e => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
        helperText="Lettres minuscules, chiffres, tirets" fullWidth />
      <TextField label="Email *" type="email" value={form.email}
        onChange={e => set('email', e.target.value)} fullWidth />
      <TextField label="Nom complet" value={form.full_name}
        onChange={e => set('full_name', e.target.value)} fullWidth />

      <FormControl fullWidth>
        <InputLabel>Rôle</InputLabel>
        <Select value={form.role} label="Rôle" onChange={e => set('role', e.target.value as UserRole)}>
          {(['READONLY', 'ANALYST', 'AUDITOR', 'ADMIN'] as UserRole[]).map(r => (
            <MenuItem key={r} value={r}>
              <Box>
                <Typography variant="body2">{r}</Typography>
                <Typography variant="caption" color="text.secondary">{ROLE_DESCRIPTIONS[r]}</Typography>
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControlLabel
        control={<Switch checked={form.auto_password} onChange={e => set('auto_password', e.target.checked)} />}
        label="Générer un mot de passe temporaire automatiquement"
      />
      {!form.auto_password && (
        <TextField label="Mot de passe (min 12 caractères)" type="password"
          value={form.password}
          onChange={e => set('password', e.target.value)}
          error={form.password.length > 0 && form.password.length < 12}
          helperText={form.password.length > 0 && form.password.length < 12 ? 'Minimum 12 caractères' : ''}
          fullWidth />
      )}

      <Alert severity="info">
        Le mot de passe temporaire sera affiché une seule fois après la création.
        L'utilisateur devra le changer à sa première connexion.
      </Alert>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" disabled={!isValid || saving}
          onClick={() => onSave({ username: form.username, email: form.email,
                                   full_name: form.full_name, role: form.role,
                                   password: form.auto_password ? undefined : form.password })}>
          {saving ? <CircularProgress size={20} /> : 'Créer l\'utilisateur'}
        </Button>
      </Box>
    </Box>
  );
};

// ── Page principale ───────────────────────────────────────────────────────────

const Users: React.FC = () => {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const { data: users, isLoading } = useUsers();
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [saving,     setSaving]       = useState(false);
  const [tempPwd,    setTempPwd]      = useState<string | null>(null);

  const handleCreate = async (u: Parameters<typeof usersApi.create>[0]) => {
    setSaving(true);
    try {
      const res = await usersApi.create(u);
      qc.invalidateQueries({ queryKey: ['users'] });
      setDialogOpen(false);
      if ((res.data as { _temp_password?: string })._temp_password) {
        setTempPwd((res.data as { _temp_password?: string })._temp_password!);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async (id: number) => {
    if (!confirm('Désactiver cet utilisateur ?')) return;
    await usersApi.disable(id);
    qc.invalidateQueries({ queryKey: ['users'] });
  };

  return (
    <Box sx={{ p: 3, overflowY: 'auto', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Person sx={{ color: 'primary.main' }} />
          <Typography variant="h5" fontWeight={700}>Gestion des utilisateurs</Typography>
          {users && <Chip label={`${users.filter(u => u.is_active).length} actifs`} size="small" color="primary" />}
        </Box>
        <Button startIcon={<Add />} variant="contained" size="small" onClick={() => setDialogOpen(true)}>
          Nouvel utilisateur
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        La hiérarchie des rôles : READONLY ⊂ ANALYST ⊂ AUDITOR ⊂ ADMIN.
        Un ADMIN peut voir et modifier tous les utilisateurs. Les actions admin sont elles-mêmes auditées.
      </Alert>

      {/* Mot de passe temporaire */}
      {tempPwd && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setTempPwd(null)}>
          <strong>Mot de passe temporaire</strong> (affiché une seule fois) :
          <code style={{ marginLeft: 8, fontSize: 14, fontWeight: 700 }}>{tempPwd}</code>
          <br />
          Communiquer ce mot de passe à l'utilisateur via un canal sécurisé.
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
      ) : (
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: 'grey.50' }}>
                <TableCell sx={{ fontWeight: 600 }}>Utilisateur</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Rôle</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Statut</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Dernière connexion</TableCell>
                <TableCell sx={{ fontWeight: 600, textAlign: 'center' }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users?.map(u => (
                <TableRow key={u.id}
                  sx={{ opacity: u.is_active ? 1 : 0.5, '&:hover': { bgcolor: 'action.hover' } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar sx={{ width: 30, height: 30, bgcolor: 'primary.main', fontSize: 13 }}>
                        {u.username[0].toUpperCase()}
                      </Avatar>
                      <Box>
                        <Typography variant="body2" fontWeight={500}>{u.username}</Typography>
                        {u.full_name && (
                          <Typography variant="caption" color="text.secondary">{u.full_name}</Typography>
                        )}
                      </Box>
                      {u.id === currentUser?.user_id && (
                        <Chip label="Moi" size="small" sx={{ fontSize: 10 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{u.email}</TableCell>
                  <TableCell>
                    <Tooltip title={ROLE_DESCRIPTIONS[u.role]}>
                      <Chip label={u.role} size="small" color={ROLE_COLORS[u.role]} />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip label={u.is_active ? 'Actif' : 'Désactivé'}
                      size="small" color={u.is_active ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    {u.last_login_at
                      ? new Date(u.last_login_at).toLocaleString('fr-FR')
                      : <Typography variant="caption" color="text.disabled">Jamais connecté</Typography>}
                  </TableCell>
                  <TableCell sx={{ textAlign: 'center' }}>
                    {u.is_active && u.id !== currentUser?.user_id && (
                      <Tooltip title="Désactiver l'utilisateur">
                        <IconButton size="small" color="error" onClick={() => handleDisable(u.id)}>
                          <Block fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VpnKey /> Nouvel utilisateur
        </DialogTitle>
        <DialogContent>
          <CreateUserForm onSave={handleCreate} onClose={() => setDialogOpen(false)} saving={saving} />
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default Users;
