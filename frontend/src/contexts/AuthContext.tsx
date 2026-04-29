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
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      api.get('/auth/me')
        .then(res => setUser(res.data as User))
        .catch(() => { localStorage.removeItem('loga_token'); sessionStorage.removeItem('loga_token'); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
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

  // Auto-refresh token every 30 minutes
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        const { token } = data as { token: string };
        const storage = localStorage.getItem('loga_token') ? localStorage : sessionStorage;
        storage.setItem('loga_token', token);
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      } catch {
        // Token expired or invalid, logout
        notify.warning('Tu sesión ha caducado');
        logout();
      }
    }, 30 * 60 * 1000); // 30 minutes
    return () => clearInterval(interval);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, completeLogin, logout, isAdmin: user?.rol === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
