import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import SpinnerColaBlanca, { LoadingScreen } from './components/SpinnerColaBlanca';
import { Toaster } from 'sileo';
import 'sileo/styles.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Productos = lazy(() => import('./pages/Productos'));
const Recetas = lazy(() => import('./pages/Recetas'));
const OrdenesFabricacion = lazy(() => import('./pages/OrdenesFabricacion'));
const Lotes = lazy(() => import('./pages/Lotes'));
const Proveedores = lazy(() => import('./pages/Proveedores'));
const Clientes = lazy(() => import('./pages/Clientes'));
const Pedidos = lazy(() => import('./pages/Pedidos'));
const Configuracion = lazy(() => import('./pages/Configuracion'));
const Finanzas = lazy(() => import('./pages/Finanzas'));
const Recuento = lazy(() => import('./pages/Recuento'));

function AppContent() {
  const { user, loading, isAdmin } = useAuth();
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1800);
    return () => clearTimeout(t);
  }, []);

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
            <Route path="/lotes" element={<Lotes />} />
            <Route path="/proveedores" element={isAdmin ? <Proveedores /> : <Navigate to="/" replace />} />
            <Route path="/clientes" element={isAdmin ? <Clientes /> : <Navigate to="/" replace />} />
            <Route path="/pedidos" element={<Pedidos />} />
            <Route path="/finanzas" element={isAdmin ? <Finanzas /> : <Navigate to="/" replace />} />
            <Route path="/configuracion" element={isAdmin ? <Configuracion /> : <Navigate to="/" replace />} />
            <Route path="/recuento" element={isAdmin ? <Recuento /> : <Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
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
