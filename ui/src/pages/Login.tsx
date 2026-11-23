import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, TextField, Button, Typography,
  Alert, CircularProgress, InputAdornment, IconButton,
} from '@mui/material';
import { Lock, Visibility, VisibilityOff } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';

const Login: React.FC = () => {
  const { login }    = useAuth();
  const navigate     = useNavigate();
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [showPwd,  setShowPwd]    = useState(false);
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch {
      setError('Identifiants incorrects. Vérifier le nom d\'utilisateur et le mot de passe.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'background.default',
    }}>
      <Paper elevation={3} sx={{ p: 4, width: 380, borderRadius: 3 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box sx={{
            bgcolor: 'primary.main', borderRadius: 2, p: 1.5, mb: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Lock sx={{ color: '#fff', fontSize: 32 }} />
          </Box>
          <Typography variant="h6" fontWeight={700}>Oracle Data Audit</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Forensics & Audit Appliance
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Nom d'utilisateur"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus fullWidth required
            autoComplete="username"
          />
          <TextField
            label="Mot de passe"
            type={showPwd ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            fullWidth required
            autoComplete="current-password"
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowPwd(s => !s)} edge="end">
                    {showPwd ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Button
            type="submit" variant="contained" fullWidth size="large"
            disabled={loading || !username || !password}
            sx={{ mt: 1, py: 1.4, fontWeight: 600 }}
          >
            {loading ? <CircularProgress size={22} color="inherit" /> : 'Se connecter'}
          </Button>
        </Box>

        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center', mt: 3 }}>
          Oracle Data Audit & Forensics Appliance v1.0.0
        </Typography>
      </Paper>
    </Box>
  );
};

export default Login;
