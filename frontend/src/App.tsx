import { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import { LoadingScreen } from './components/SpinnerColaBlanca';

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
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/recetas" element={<Recetas />} />
            <Route path="/produccion" element={<OrdenesFabricacion />} />
            <Route path="/lotes" element={<Lotes />} />
            {isAdmin && <Route path="/proveedores" element={<Proveedores />} />}
            {isAdmin && <Route path="/clientes" element={<Clientes />} />}
            <Route path="/pedidos" element={<Pedidos />} />
            {isAdmin && <Route path="/finanzas" element={<Finanzas />} />}
            {isAdmin && <Route path="/configuracion" element={<Configuracion />} />}
            {isAdmin && <Route path="/recuento" element={<Recuento />} />}
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
