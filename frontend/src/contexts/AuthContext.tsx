import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../api/client';
import { notify } from '../lib/notify';

interface User {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'trabajador';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<User>;
  completeLogin: (usuario: User) => void;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true, login: async () => ({ id: '', nombre: '', email: '', rol: 'trabajador' }), completeLogin: () => {}, logout: () => {}, isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token');
    if (!token) { setLoading(false); return; }
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    // El interceptor 401 ya intenta refresh automático y reintenta /me.
    // Si tras todo eso devuelve 401, sí limpiamos el token.
    api.get('/auth/me')
      .then(res => setUser(res.data as User))
      .catch(err => {
        if (err?.response?.status === 401) {
          localStorage.removeItem('loga_token');
          sessionStorage.removeItem('loga_token');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string, remember: boolean) => {
    const { data } = await api.post('/auth/login', { email, password });
    const { token, usuario } = data as { token: string; usuario: User };
    if (remember) {
      localStorage.setItem('loga_token', token);
    } else {
      sessionStorage.setItem('loga_token', token);
    }
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    // No setUser here — Login component calls completeLogin after animation
    return usuario;
  };

  const completeLogin = (usuario: User) => setUser(usuario);

  const logout = () => {
    localStorage.removeItem('loga_token');
    sessionStorage.removeItem('loga_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
    notify.info('Sesión cerrada');
  };

  // Auto-refresh proactivo cada 6h: token TTL 7d, refresca pronto para no
  // depender del 401 catch. También refresca al volver a la pestaña tras
  // estar inactivo, con cooldown de 60s para evitar spam si el usuario
  // alterna pestañas rápido (Fix #21).
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    let lastRefresh = 0;
    let inFlight: Promise<void> | null = null;
    const COOLDOWN_MS = 60 * 1000;

    const refrescar = async () => {
      // Dedup: si hay otro refresh en vuelo, espera a su resultado.
      if (inFlight) return inFlight;
      // Cooldown: no refrescar si hace menos de 60s
      if (Date.now() - lastRefresh < COOLDOWN_MS) return;
      lastRefresh = Date.now();
      inFlight = (async () => {
        try {
          const { data } = await api.post('/auth/refresh');
          const { token } = data as { token: string };
          const storage = localStorage.getItem('loga_token') ? localStorage : sessionStorage;
          storage.setItem('loga_token', token);
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } catch { /* el interceptor maneja logout si es definitivo */ }
        finally { inFlight = null; }
      })();
      return inFlight;
    };
    const interval = setInterval(refrescar, 6 * 60 * 60 * 1000); // 6 horas
    const onVisible = () => { if (mounted && document.visibilityState === 'visible') refrescar(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, completeLogin, logout, isAdmin: user?.rol === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
