import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import client, { setToken, getToken, errorMessage } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `loading` covers the initial "do we already have a valid session?" check so
  // protected routes do not flash the login screen on a hard refresh.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await client.get('/auth/me');
        if (!cancelled) setUser(data.user);
      } catch {
        // Token is stale; the response interceptor already cleared it.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await client.post('/auth/login', { email, password });
      setToken(data.token);
      setUser(data.user);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error, 'Unable to sign in') };
    }
  }, []);

  const register = useCallback(async (name, email, password) => {
    try {
      const { data } = await client.post('/auth/register', { name, email, password });
      setToken(data.token);
      setUser(data.user);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: errorMessage(error, 'Unable to create the account') };
    }
  }, []);

  const logout = useCallback(() => {
    // The JWT is stateless, so logging out simply means discarding it.
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
