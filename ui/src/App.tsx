import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Shell } from './components/layout/Shell';

// Pages (lazy loading pour de meilleures performances)
const Login           = React.lazy(() => import('./pages/Login'));
const Dashboard       = React.lazy(() => import('./pages/Dashboard'));
const AuditExplorer   = React.lazy(() => import('./pages/AuditExplorer'));
const RecordTimeline  = React.lazy(() => import('./pages/RecordTimeline'));
const EventDetail     = React.lazy(() => import('./pages/EventDetail'));
const Alerts          = React.lazy(() => import('./pages/Alerts'));
const Health          = React.lazy(() => import('./pages/Health'));

// Placeholders pour les pages non encore implémentées
const Placeholder: React.FC<{ title: string }> = ({ title }) => (
  <div style={{ padding: 32 }}>
    <h2>{title}</h2>
    <p style={{ color: '#666' }}>Cette page est en cours de développement.</p>
  </div>
);

// ── React Query client ────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry:              1,
      refetchOnWindowFocus: false,
      staleTime:          10_000,
    },
  },
});

// ── Thème MUI ─────────────────────────────────────────────────────────────────

const theme = createTheme({
  palette: {
    primary:   { main: '#1565C0' },
    secondary: { main: '#E65100' },
    error:     { main: '#B71C1C' },
    warning:   { main: '#E65100' },
    success:   { main: '#2E7D32' },
    background: {
      default: '#F5F7FA',
      paper:   '#FFFFFF',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiPaper:  { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiChip:   { styleOverrides: { root: { fontWeight: 500 } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600, backgroundColor: '#F5F7FA' } } },
  },
});

// ── Route protégée ────────────────────────────────────────────────────────────

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

// ── App principale ────────────────────────────────────────────────────────────

const AppRoutes: React.FC = () => (
  <React.Suspense fallback={
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div>Chargement…</div>
    </div>
  }>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <ProtectedRoute><Shell /></ProtectedRoute>
      }>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"    element={<Dashboard />} />
        <Route path="explorer"     element={<AuditExplorer />} />
        <Route path="timeline"     element={<RecordTimeline />} />
        <Route path="transactions" element={<Placeholder title="Transaction Explorer" />} />
        <Route path="alerts"       element={<Alerts />} />
        <Route path="rules"        element={<Placeholder title="Règles de risque" />} />
        <Route path="databases"    element={<Placeholder title="Bases de données" />} />
        <Route path="integrity"    element={<Placeholder title="Intégrité SHA-256" />} />
        <Route path="archive"      element={<Placeholder title="Archive" />} />
        <Route path="health"       element={<Health />} />
        <Route path="reports"      element={<Placeholder title="Rapports" />} />
        <Route path="users"        element={<Placeholder title="Utilisateurs" />} />
        <Route path="backup"       element={<Placeholder title="Backup / Restore" />} />
        <Route path="admin"        element={<Placeholder title="Administration" />} />
        <Route path="events/:id"   element={<Placeholder title="Détail événement" />} />
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
