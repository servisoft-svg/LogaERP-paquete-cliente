import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import SpinnerColaBlanca, { LoadingScreen } from './components/SpinnerColaBlanca';
import { Toaster } from 'sileo';
import 'sileo/styles.css';
import { useAutomatizacionesLive } from './hooks/useAutomatizacionesLive';
import { useCronHealth } from './hooks/useCronHealth';
import { useAlertas } from './hooks/useAlertas';
import AlertaModal from './components/AlertaModal';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Productos = lazy(() => import('./pages/Productos'));
const Recetas = lazy(() => import('./pages/Recetas'));
const OrdenesFabricacion = lazy(() => import('./pages/OrdenesFabricacion'));
const Envasado = lazy(() => import('./pages/Envasado'));
const Lotes = lazy(() => import('./pages/Lotes'));
const Proveedores = lazy(() => import('./pages/Proveedores'));
const Clientes = lazy(() => import('./pages/Clientes'));
const Pedidos = lazy(() => import('./pages/Pedidos'));
const Configuracion = lazy(() => import('./pages/Configuracion'));
const Finanzas = lazy(() => import('./pages/Finanzas'));
const Recuento = lazy(() => import('./pages/Recuento'));
const Automatizaciones = lazy(() => import('./pages/Automatizaciones'));
const ControlCalidad = lazy(() => import('./pages/ControlCalidad'));
const PedidosProveedor = lazy(() => import('./pages/PedidosProveedor'));

function AppContent() {
  const { user, loading, isAdmin } = useAuth();
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1800);
    return () => clearTimeout(t);
  }, []);

  // Hook live de automatizaciones (polling 30s + sileo toasts)
  useAutomatizacionesLive();
  // Watchdog de crons internos: avisa con sileo.error si alguno cae.
  useCronHealth();
  // Alertas programadas: polling 30s + sonido + Notification API
  const { cola, marcarVista } = useAlertas(!!user);

  if (loading || splash) return <LoadingScreen />;
  if (!user) return <Login />;

  return (
    <div>
      <Navbar />
      <main className="mx-auto max-w-screen-xl px-4 py-6 sm:px-6 pb-20 md:pb-8">
        <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca size="sm" /></div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/recetas" element={<Recetas />} />
            <Route path="/produccion" element={<OrdenesFabricacion />} />
            <Route path="/envasado" element={<Envasado />} />
            <Route path="/lotes" element={<Lotes />} />
            <Route path="/proveedores" element={isAdmin ? <Proveedores /> : <Navigate to="/" replace />} />
            <Route path="/clientes" element={isAdmin ? <Clientes /> : <Navigate to="/" replace />} />
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/finanzas" element={isAdmin ? <Finanzas /> : <Navigate to="/" replace />} />
            <Route path="/configuracion" element={isAdmin ? <Configuracion /> : <Navigate to="/" replace />} />
            <Route path="/recuento" element={isAdmin ? <Recuento /> : <Navigate to="/" replace />} />
            <Route path="/automatizaciones" element={isAdmin ? <Automatizaciones /> : <Navigate to="/" replace />} />
            <Route path="/control-calidad" element={<ControlCalidad />} />
            <Route path="/solicitudes-compra" element={isAdmin ? <PedidosProveedor /> : <Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <AlertaModal alerta={cola[0] ?? null} onCerrar={marcarVista} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppContent />
          <Toaster
            position="bottom-center"
            theme="system"
            offset={16}
            options={{
              roundness: 18,
              styles: {
                title: 'text-[13px]! font-semibold!',
                description: 'text-[12px]! opacity-80!',
                badge: 'scale-95',
                button: 'text-[12px]! font-medium!',
              },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
