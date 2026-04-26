import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface UserData {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'trabajador';
}

export default function Login() {
  const { login, completeLogin } = useAuth();
  const [email, setEmail] = useState(() => localStorage.getItem('loga_remember_email') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('loga_remember_email') !== null);
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [pendingUser, setPendingUser] = useState<UserData | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Formato de email invalido');
      return;
    }
    if (password.length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres');
      return;
    }

    setLoading(true);
    try {
      if (remember) {
        localStorage.setItem('loga_remember_email', email);
      } else {
        localStorage.removeItem('loga_remember_email');
      }
      const usuario = await login(email, password, remember);
      setPendingUser(usuario);
      setAnimating(true);
    } catch {
      setError('Email o contrasena incorrectos');
      setLoading(false);
    }
  };

  // Despues de la animacion, completar login
  useEffect(() => {
    if (animating && pendingUser) {
      const t = setTimeout(() => completeLogin(pendingUser), 1800);
      return () => clearTimeout(t);
    }
  }, [animating, pendingUser, completeLogin]);

  if (animating) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden">
        {/* Flash blanco → rojo */}
        <motion.div
          className="absolute inset-0"
          initial={{ backgroundColor: '#ffffff' }}
          animate={{ backgroundColor: ['#ffffff', '#ffffff', '#E8001C'] }}
          transition={{ duration: 0.9, times: [0, 0.35, 1], ease: 'easeIn' }}
        />

        {/* Logo rojo que aparece, late y desaparece */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.img
            src="/colas-loga.png" alt=""
            className="object-contain"
            style={{ width: 140, height: 140 }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: [0, 1, 1, 1, 0], scale: [0.3, 1, 0.93, 1.04, 1] }}
            transition={{ duration: 0.9, times: [0, 0.25, 0.5, 0.7, 1], ease: 'easeOut' }}
          />
        </div>

        {/* Logo blanco final + texto sobre fondo rojo */}
        <motion.div
          className="absolute inset-0 flex flex-col items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.2 }}
        >
          <motion.img
            src="/colas-loga.png" alt=""
            className="object-contain"
            style={{ filter: 'brightness(0) invert(1)', width: 90, height: 90 }}
            initial={{ scale: 1.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.85, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.p
            className="mt-3 text-white/40 text-[10px] tracking-[0.3em] uppercase font-medium"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.3 }}
          >
            Colas Loga
          </motion.p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <motion.img
            src="/colas-loga.png"
            alt="Loga"
            className="h-20 mx-auto mb-4"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
          <h1 className="text-xl font-bold text-gray-900">Colas Loga</h1>
          <p className="text-sm text-gray-400">ERP de Produccion</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="admin@loga.es" autoFocus autoComplete="email"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Contrasena</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 pr-10 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
              />
              <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="rounded border-gray-300 text-loga-red focus:ring-loga-red" />
            <span className="text-xs text-gray-600">Recordar sesion</span>
          </label>
          {error && <p className="text-xs text-loga-red bg-red-50 rounded-lg px-3 py-2 border border-red-100">{error}</p>}
          <button type="submit" disabled={loading || !email || !password}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-loga-red py-3 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors">
            {loading ? 'Entrando...' : <><LogIn size={16} /> Entrar</>}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
