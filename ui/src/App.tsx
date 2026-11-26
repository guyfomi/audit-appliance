import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Shell } from './components/layout/Shell';

const Login              = React.lazy(() => import('./pages/Login'));
const Dashboard          = React.lazy(() => import('./pages/Dashboard'));
const AuditExplorer      = React.lazy(() => import('./pages/AuditExplorer'));
const RecordTimeline     = React.lazy(() => import('./pages/RecordTimeline'));
const TransactionExplorer = React.lazy(() => import('./pages/TransactionExplorer'));
const Alerts             = React.lazy(() => import('./pages/Alerts'));
const Rules              = React.lazy(() => import('./pages/Rules'));
const Integrity          = React.lazy(() => import('./pages/Integrity'));
const Health             = React.lazy(() => import('./pages/Health'));
const Users              = React.lazy(() => import('./pages/Users'));
const Reports            = React.lazy(() => import('./pages/Reports'));

const Placeholder: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div style={{ padding: 32 }}>
    <h2 style={{ marginBottom: 8 }}>{title}</h2>
    <p style={{ color: '#666' }}>{description || 'Disponible dans la prochaine version.'}</p>
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
});

const theme = createTheme({
  palette: {
    primary:    { main: '#1565C0' },
    secondary:  { main: '#E65100' },
    error:      { main: '#B71C1C' },
    warning:    { main: '#E65100' },
    success:    { main: '#2E7D32' },
    info:       { main: '#0277BD' },
    background: { default: '#F5F7FA', paper: '#FFFFFF' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 }, h5: { fontWeight: 700 }, h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 600 }, subtitle2: { fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiPaper:     { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton:    { defaultProps: { disableElevation: true } },
    MuiChip:      { styleOverrides: { root: { fontWeight: 500 } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600, backgroundColor: '#F5F7FA', borderBottom: '2px solid #E0E0E0' } } },
  },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const Loader: React.FC = () => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', flexDirection:'column', gap:16, color:'#666' }}>
    <div style={{ width:36, height:36, border:'3px solid #E0E0E0', borderTopColor:'#1565C0', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
    <span style={{ fontSize:14 }}>Chargement…</span>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

const AppRoutes: React.FC = () => (
  <React.Suspense fallback={<Loader />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"    element={<Dashboard />} />
        <Route path="explorer"     element={<AuditExplorer />} />
        <Route path="timeline"     element={<RecordTimeline />} />
        <Route path="transactions" element={<TransactionExplorer />} />
        <Route path="alerts"       element={<Alerts />} />
        <Route path="rules"        element={<Rules />} />
        <Route path="databases"    element={<Placeholder title="Bases de données Oracle" description="Configurer les bases Oracle, tables, colonnes et politiques de masquage." />} />
        <Route path="integrity"    element={<Integrity />} />
        <Route path="archive"      element={<Placeholder title="Archive" description="Jobs d'archivage Parquet/JSONL, vérification hash, archivage manuel." />} />
        <Route path="health"       element={<Health />} />
        <Route path="reports"      element={<Reports />} />
        <Route path="users"        element={<Users />} />
        <Route path="backup"       element={<Placeholder title="Backup / Restore" description="Backup manuel, historique, restauration." />} />
        <Route path="admin"        element={<Placeholder title="Administration" description="Configuration générale, rétention, alertes, intégrations SIEM." />} />
        <Route path="*"            element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  </React.Suspense>
);

const App: React.FC = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
