import React, { createContext, useContext, useState, useCallback } from 'react';
import { authApi } from '../lib/api';
import type { CurrentUser, UserRole } from '../lib/types';

interface AuthContextValue {
  user:    CurrentUser | null;
  token:   string | null;
  login:   (username: string, password: string) => Promise<void>;
  logout:  () => void;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null, token: null,
  login: async () => {}, logout: () => {}, hasRole: () => false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('token')
  );
  const [user, setUser] = useState<CurrentUser | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await authApi.login(username, password);
    localStorage.setItem('token', data.access_token);
    const tokenParts = data.access_token.split('.');
    const payloadBase64Url = tokenParts[1];
    const payload = JSON.parse(
      atob(payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/'))
    );
    const decoded: Record<string, unknown> = {
      sub: Number(payload.sub),
      username: payload.username,
      role: payload.role,
    };
    const currentUser: CurrentUser = {
      user_id: decoded.sub as number,
      username: decoded.username as string,
      role: decoded.role as UserRole,
    };
    localStorage.setItem('user', JSON.stringify(currentUser));
    setToken(data.access_token);
    setUser(currentUser);
    localStorage.setItem('user', JSON.stringify(currentUser));
    setToken(data.access_token);
    setUser(currentUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }, []);

  const hasRole = useCallback((...roles: UserRole[]) => {
    return user ? roles.includes(user.role) : false;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
