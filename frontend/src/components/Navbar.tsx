import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Factory, Layers, Bell,
  Package, ChefHat, Truck, Users, ShoppingBag, BarChart3, Settings, LogOut, MoreHorizontal, X, Zap,
  Moon, Sun, ClipboardCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { useNotificaciones } from '../hooks/useNotificaciones';
import { useAuth } from '../contexts/AuthContext';
import RecordatorioModal from './RecordatorioModal';
import PerfilModal from './PerfilModal';

const LINKS = [
  { to: '/',               label: 'Dashboard',   icon: LayoutDashboard },
  { to: '/productos',      label: 'Productos',   icon: Package          },
  { to: '/recetas',        label: 'Fórmulas',     icon: ChefHat          },
  { to: '/produccion',     label: 'Produccion',  icon: Factory          },
  { to: '/lotes',          label: 'Lotes',       icon: Layers           },
  { to: '/proveedores',    label: 'Proveedores', icon: Truck            },
  { to: '/solicitudes-compra', label: 'Compras', icon: ShoppingBag       },
  { to: '/clientes',       label: 'Clientes',    icon: Users            },
  { to: '/pedidos',        label: 'Pedidos',     icon: ShoppingBag      },
  { to: '/finanzas',       label: 'Finanzas',    icon: BarChart3        },
  { to: '/control-calidad',label: 'Calidad',     icon: ClipboardCheck   },
  { to: '/automatizaciones', label: 'Auto',     icon: Zap              },
  { to: '/configuracion',  label: 'Config.',     icon: Settings         },
];

const MOBILE_MAIN = ['/', '/productos', '/produccion', '/pedidos'];

export default function Navbar() {
  const { pathname } = useLocation();
  const { count } = useNotificaciones();
  const { user, logout, isAdmin } = useAuth();
  const [mobileMenu, setMobileMenu] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('loga_dark') === '1');
  const [crearAlerta, setCrearAlerta] = useState(false);
  const [perfilAbierto, setPerfilAbierto] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.body.style.background = dark ? '#171717' : '#ffffff';
    localStorage.setItem('loga_dark', dark ? '1' : '0');
  }, [dark]);

  const visibleLinks = LINKS.filter(l => {
    if (['/proveedores', '/clientes', '/finanzas', '/configuracion', '/automatizaciones', '/solicitudes-compra'].includes(l.to)) return isAdmin;
    return true;
  });

  const initials = user ? user.nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'OP';

  return (
    <>
      {/* ── Desktop top bar ── */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-100 bg-white/95 backdrop-blur-sm hidden md:block">
        <div className="flex h-14 w-full items-center justify-between pl-3 pr-4 gap-4">
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <img src="/colas-loga.png" alt="Loga" className="h-9 w-auto object-contain" />
            <span className="text-base font-bold text-loga-red">Colas Loga</span>
          </Link>

          <nav className="flex items-center gap-0.5 flex-1 justify-center min-w-0 overflow-x-auto">
            {visibleLinks.map(({ to, label, icon: Icon }) => {
              const active = pathname === to || (to !== '/' && pathname.startsWith(to));
              return (
                <Link
                  key={to}
                  to={to}
                  title={label}
                  className={clsx(
                    'relative flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                    active ? 'text-loga-red' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                  )}
                >
                  <Icon size={14} />
                  <span className="hidden xl:inline">{label}</span>
                  {active && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute inset-0 rounded-lg bg-red-50 -z-10"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCrearAlerta(true)}
              title="Nuevo recordatorio"
              className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-red-50 transition-colors text-gray-500 hover:text-loga-red"
            >
              <Bell size={16} />
            </button>
            <button onClick={() => setDark(d => !d)} className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              {dark ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-gray-500" />}
            </button>
            <button
              onClick={() => setPerfilAbierto(true)}
              title={user ? `${user.nombre} — editar perfil` : 'Mi perfil'}
              className="w-8 h-8 rounded-full bg-loga-red flex items-center justify-center text-white text-xs font-bold select-none hover:bg-loga-red-dark transition-colors cursor-pointer"
            >
              {initials}
            </button>
            <button onClick={logout} className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-50 transition-colors text-gray-400 hover:text-gray-600" title="Salir">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile top bar (minimal) ── */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-100 bg-white/95 backdrop-blur-sm md:hidden">
        <div className="flex h-12 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <img src="/colas-loga.png" alt="Loga" className="h-7 w-auto object-contain" />
            <span className="text-sm font-bold text-loga-red">Colas Loga</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/" className="relative flex items-center justify-center w-8 h-8">
              <Bell size={16} className="text-gray-500" />
              <AnimatePresence>
                {count > 0 && (
                  <motion.span
                    key="badge-m"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-loga-red px-0.5 text-[9px] font-bold text-white leading-none"
                  >
                    {count > 99 ? '99+' : count}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Mobile bottom tab bar (max 4 + Mas) ── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm md:hidden safe-bottom">
        <div className="flex items-center justify-around h-14 px-2">
          {visibleLinks.filter(l => MOBILE_MAIN.includes(l.to)).map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to !== '/' && pathname.startsWith(to));
            return (
              <Link key={to} to={to} onClick={() => setMobileMenu(false)}
                className={clsx('flex flex-col items-center justify-center gap-0.5 flex-1 py-1', active ? 'text-loga-red' : 'text-gray-400')}>
                <Icon size={20} />
                <span className="text-[10px] font-medium">{label}</span>
              </Link>
            );
          })}
          <button onClick={() => setMobileMenu(v => !v)}
            className={clsx('flex flex-col items-center justify-center gap-0.5 flex-1 py-1', mobileMenu ? 'text-loga-red' : 'text-gray-400')}>
            {mobileMenu ? <X size={20} /> : <MoreHorizontal size={20} />}
            <span className="text-[10px] font-medium">Mas</span>
          </button>
        </div>

        {/* Panel "Mas" */}
        <AnimatePresence>
          {mobileMenu && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/20 z-[-1]"
                onClick={() => setMobileMenu(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-full left-0 right-0 bg-white border-t border-gray-200 rounded-t-2xl shadow-lg p-4"
              >
                <div className="grid grid-cols-4 gap-3">
                  {visibleLinks.filter(l => !MOBILE_MAIN.includes(l.to)).map(({ to, label, icon: Icon }) => {
                    const active = pathname === to || (to !== '/' && pathname.startsWith(to));
                    return (
                      <Link key={to} to={to} onClick={() => setMobileMenu(false)}
                        className={clsx('flex flex-col items-center gap-1 py-3 rounded-xl transition-colors',
                          active ? 'bg-red-50 text-loga-red' : 'text-gray-500 hover:bg-gray-50')}>
                        <Icon size={22} />
                        <span className="text-[10px] font-medium">{label}</span>
                      </Link>
                    );
                  })}
                  <button onClick={() => { logout(); setMobileMenu(false); }}
                    className="flex flex-col items-center gap-1 py-3 rounded-xl text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors">
                    <LogOut size={22} />
                    <span className="text-[10px] font-medium">Salir</span>
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </nav>
      <RecordatorioModal abierto={crearAlerta} onCerrar={() => setCrearAlerta(false)} />
      <PerfilModal abierto={perfilAbierto} onCerrar={() => setPerfilAbierto(false)} />
    </>
  );
}
