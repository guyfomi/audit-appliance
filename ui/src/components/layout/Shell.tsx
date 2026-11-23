import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, Badge, Avatar, Tooltip, useTheme,
  IconButton, Chip,
} from '@mui/material';
import {
  Dashboard, Search, History, SwapHoriz, NotificationsActive,
  Security, Storage, Lock, Archive, MonitorHeart, Settings,
  TableChart, Person, Backup, Logout, ChevronLeft, ChevronRight,
  FiberManualRecord,
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard, useCDCStatus } from '../../hooks';

const DRAWER_WIDTH      = 220;
const DRAWER_COLLAPSED  = 64;

interface NavItem {
  label:    string;
  icon:     React.ReactNode;
  path:     string;
  roles?:   string[];
  divider?: boolean;
  badge?:   number;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard',         icon: <Dashboard />,           path: '/dashboard' },
  { label: 'Audit Explorer',    icon: <Search />,              path: '/explorer' },
  { label: 'Record Timeline',   icon: <History />,             path: '/timeline' },
  { label: 'Transactions',      icon: <SwapHoriz />,           path: '/transactions' },
  { label: '', divider: true,   icon: null,                    path: '' },
  { label: 'Alertes',           icon: <NotificationsActive />, path: '/alerts' },
  { label: 'Règles de risque',  icon: <Security />,            path: '/rules' },
  { label: '', divider: true,   icon: null,                    path: '' },
  { label: 'Bases de données',  icon: <Storage />,             path: '/databases',  roles: ['ADMIN','AUDITOR'] },
  { label: 'Intégrité',         icon: <Lock />,                path: '/integrity',  roles: ['ADMIN','AUDITOR'] },
  { label: 'Archive',           icon: <Archive />,             path: '/archive',    roles: ['ADMIN'] },
  { label: 'Santé système',     icon: <MonitorHeart />,        path: '/health',     roles: ['ADMIN','AUDITOR'] },
  { label: 'Rapports',          icon: <TableChart />,          path: '/reports' },
  { label: '', divider: true,   icon: null,                    path: '' },
  { label: 'Utilisateurs',      icon: <Person />,              path: '/users',      roles: ['ADMIN'] },
  { label: 'Backup / Restore',  icon: <Backup />,              path: '/backup',     roles: ['ADMIN'] },
  { label: 'Administration',    icon: <Settings />,            path: '/admin',      roles: ['ADMIN'] },
];

export const Shell: React.FC = () => {
  const { user, logout, hasRole } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const theme     = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  const { data: dashboard } = useDashboard();
  const { data: cdcList }   = useCDCStatus();

  const openAlerts   = dashboard?.open_alerts ?? 0;
  const cdcStatus    = cdcList?.[0];
  const cdcRunning   = cdcStatus?.status === 'RUNNING';
  const lag          = cdcStatus?.lag_seconds ?? null;
  const lagOk        = lag === null || lag < 30;
  const drawerWidth  = collapsed ? DRAWER_COLLAPSED : DRAWER_WIDTH;

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            transition: theme.transitions.create('width', {
              easing:   theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
            overflowX: 'hidden',
            bgcolor:   'background.paper',
            borderRight: `1px solid ${theme.palette.divider}`,
          },
        }}
      >
        {/* Logo */}
        <Box sx={{
          display: 'flex', alignItems: 'center',
          px: 2, py: 1.5, gap: 1, minHeight: 56,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}>
          <Lock sx={{ color: 'primary.main', fontSize: 22, flexShrink: 0 }} />
          {!collapsed && (
            <Typography variant="subtitle2" fontWeight={700} noWrap>
              Audit Appliance
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronRight fontSize="small" /> : <ChevronLeft fontSize="small" />}
          </IconButton>
        </Box>

        {/* CDC status mini */}
        {!collapsed && (
          <Box sx={{ px: 2, py: 0.8, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <FiberManualRecord sx={{
                fontSize: 9,
                color: cdcRunning && lagOk ? 'success.main'
                     : cdcRunning          ? 'warning.main'
                     :                       'error.main',
              }} />
              <Typography variant="caption" color="text.secondary">
                CDC {cdcStatus?.status ?? 'N/A'}
                {lag !== null && ` · ${lag.toFixed(1)}s`}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Navigation */}
        <List dense sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 0.5 }}>
          {NAV_ITEMS.map((item, idx) => {
            if (item.divider) return <Divider key={idx} sx={{ my: 0.5 }} />;
            if (item.roles && !hasRole(...item.roles as never[])) return null;

            const isActive = location.pathname === item.path;
            const badgeCount = item.path === '/alerts' ? openAlerts : 0;

            return (
              <Tooltip key={item.path} title={collapsed ? item.label : ''} placement="right">
                <ListItemButton
                  selected={isActive}
                  onClick={() => navigate(item.path)}
                  sx={{
                    mx: 0.5, borderRadius: 1.5, mb: 0.3,
                    minHeight: 40,
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color:   'primary.contrastText',
                      '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                      '&:hover': { bgcolor: 'primary.dark' },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Badge badgeContent={badgeCount || 0} color="error" max={99}>
                      {item.icon}
                    </Badge>
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{ fontSize: 13, fontWeight: isActive ? 600 : 400 }}
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            );
          })}
        </List>

        {/* Utilisateur connecté */}
        <Box sx={{
          px: 1.5, py: 1,
          borderTop: `1px solid ${theme.palette.divider}`,
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <Avatar sx={{ width: 30, height: 30, bgcolor: 'primary.main', fontSize: 13 }}>
            {user?.username?.[0]?.toUpperCase()}
          </Avatar>
          {!collapsed && (
            <>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" fontWeight={600} noWrap display="block">
                  {user?.username}
                </Typography>
                <Chip label={user?.role} size="small"
                      sx={{ fontSize: 10, height: 16 }} />
              </Box>
              <Tooltip title="Déconnexion">
                <IconButton size="small" onClick={logout}>
                  <Logout fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      </Drawer>

      {/* ── Contenu principal ──────────────────────────────────────────────── */}
      <Box component="main" sx={{
        flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        <Outlet />
      </Box>
    </Box>
  );
};
