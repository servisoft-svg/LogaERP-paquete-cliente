import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, ChevronRight, ChevronLeft, Factory,
  Check, AlertCircle, ClipboardList, Trash2, Eye, X, Send, Search, Paperclip, Pencil, Sparkles, Package,
} from 'lucide-react';
import { produccionApi, recetasApi, clientesApi, productosApi } from '../api/client';
import type { OrdenProduccion, Receta, Cliente, Producto } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import FabricacionModal from '../components/FabricacionModal';
import EnvasadoRapido from '../components/EnvasadoRapido';
import TanqueEnvasado from '../components/TanqueEnvasado';
import ConfirmModal from '../components/ConfirmModal';
import Modal from '../components/Modal';
import { FormField, Input } from '../components/FormField';
import clsx from 'clsx';
import { useAuth } from '../contexts/AuthContext';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from '../components/ToastFields';
import { checkStockBajo } from '../lib/stockAlerts';
import { withAuthToken } from '../lib/uploadsUrl';
import Paginacion from '../components/Paginacion';
import SearchSelect from '../components/SearchSelect';

// Paso a paso del formulario
type FormStep = 1 | 2 | 3;

interface ConsumoDet {
  id: string;
  tipo: string;
  cantidad: string;
  cantidad_antes: string;
  cantidad_despues: string;
  producto_nombre: string;
  producto_codigo: string;
  producto_tipo?: string;
  unidad_medida: string;
  precio_unitario: string | null;
  lote_id?: string;
  lote_interno: string | null;
  lote_proveedor: string | null;
  fecha_caducidad: string | null;
  created_at: string;
}

interface OrigenLote {
  producto_nombre: string;
  producto_codigo: string;
  cantidad: string;
  unidad_medida: string;
  lote_interno: string;
  precio_unitario: string;
}

interface NuevaOrdenForm {
  receta_id:            string;
  cantidad_planificada: string;
  fecha_planificada:    string;
  cliente:             string;
  cliente_id:          string;
  notas:               string;
  pedido_id:           string;
}

export default function OrdenesFabricacion() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ordenes, setOrdenes]         = useState<OrdenProduccion[]>([]);
  const [recetas, setRecetas]         = useState<Receta[]>([]);
  const [clientesList, setClientesList] = useState<Cliente[]>([]);
  const [loading, setLoading]         = useState(true);
  const [busqueda, setBusqueda]       = useState('');
  const [tabProd, setTabProd]         = useState<'fabricacion' | 'envasado'>(
    searchParams.get('tipo') === 'envasado' ? 'envasado' : 'fabricacion'
  );
  const [showForm, setShowForm]       = useState(false);
  const [step, setStep]               = useState<FormStep>(1);
  const [clienteMode, setClienteMode] = useState<'select' | 'otro'>('select');
  const [form, setForm]               = useState<NuevaOrdenForm>({
    receta_id: '', cantidad_planificada: '', fecha_planificada: '', cliente: '', cliente_id: '', notas: '', pedido_id: '',
  });
  const [resultadoConfirm, setResultadoConfirm] = useState<Record<string, unknown> | null>(null);
  const [errorConfirm, setErrorConfirm]         = useState<string | null>(null);
  const [ordenFabricando, setOrdenFabricando]   = useState<OrdenProduccion | null>(null);
  const [envasadoRapidoOpen, setEnvasadoRapidoOpen] = useState(false);
  const [envasadoInitial, setEnvasadoInitial] = useState<{ producto?: string; cantidad?: string } | null>(null);

  // Envasado planificado
  const [showEnvasadoForm, setShowEnvasadoForm] = useState(false);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [envForm, setEnvForm] = useState({ producto_final_id: '', cola_id: '', envase_id: '', cantidad: '', fecha: '', cliente: '', cliente_id: '', notas: '' });
  const [envMateriales, setEnvMateriales] = useState<{ producto_id: string; cantidad: string }[]>([]);
  const [envasadoPreview, setEnvasadoPreview] = useState<{ ordenId: string; data: any } | null>(null);
  const [stockError, setStockError] = useState<{ ordenId: string; faltas: { nombre: string; necesario: number; disponible: number; unidad: string }[] } | null>(null);

  // Open fabrication modal directly
  const intentarFabricar = (o: OrdenProduccion) => {
    if (o.tipo_orden === 'envasado') {
      handleConfirmarEnvasado(o.id);
      return;
    }
    setOrdenFabricando(o);
  };
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [envasadoAnimacion, setEnvasadoAnimacion] = useState<{ ordenId: string; fillPct: number; resultado: any | null; fase: 'procesando' | 'completado' | 'error'; errorMsg?: string } | null>(null);

  // Detalle de orden (lotes consumidos)
  const [detalleOrden, setDetalleOrden]         = useState<{ orden: OrdenProduccion; consumos: ConsumoDet[]; coste_total?: number } | null>(null);
  const [origenExpandido, setOrigenExpandido]   = useState<string | null>(null);
  const [origenDatos, setOrigenDatos]           = useState<OrigenLote[]>([]);
  const [loadingDetalle, setLoadingDetalle]     = useState(false);

  // Borrar
  const [borrando, setBorrando]                 = useState<string | null>(null);
  const [confirmElim, setConfirmElim]           = useState<OrdenProduccion | null>(null);

  // Editar orden
  const [editOrden, setEditOrden]               = useState<OrdenProduccion | null>(null);
  const [editForm, setEditForm]                 = useState({ cantidad: '', fecha: '', notas: '', cliente: '' });
  const [savingEdit, setSavingEdit]             = useState(false);

  // Enviar trazabilidad por email
  const [emailOrdenId, setEmailOrdenId]     = useState<string | null>(null);
  const [emailDest, setEmailDest]           = useState('');
  const [enviandoEmail, setEnviandoEmail]   = useState(false);
  const [emailExito, setEmailExito]         = useState(false);

  const handleEnviarTrazabilidad = async () => {
    if (!emailOrdenId || !emailDest) return;
    setEnviandoEmail(true);
    try {
      await produccionApi.enviarTrazabilidad(emailOrdenId, emailDest);
      setEmailExito(true);
      setTimeout(() => { setEmailOrdenId(null); setEmailDest(''); setEmailExito(false); }, 2000);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      notify.error(apiErr?.response?.data?.error ?? 'Error al enviar');
    } finally {
      setEnviandoEmail(false);
    }
  };

  const cargar = useCallback(async () => {
    try {
      const [ordRes, recRes, cliRes] = await Promise.all([
        produccionApi.listar(),
        recetasApi.listar({ activa: true }),
        clientesApi.listar().catch(() => ({ data: [] })),
      ]);
      setOrdenes(ordRes.data as OrdenProduccion[]);
      setRecetas(recRes.data as Receta[]);
      setClientesList(cliRes.data as Cliente[]);
    } catch {
      try {
        const ordRes = await produccionApi.listar();
        setOrdenes(ordRes.data as OrdenProduccion[]);
      } catch { /* sin conexion */ }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Load productos when envasado form opens
  useEffect(() => {
    if (showEnvasadoForm && productos.length === 0) {
      productosApi.listar({ activo: 'true' }).then(res => setProductos(res.data as Producto[]));
    }
  }, [showEnvasadoForm]);

  // Auto-fill from envasado recipe when selecting producto final
  const autoFillFromRecipe = async (productoId: string) => {
    const prod = productos.find(p => p.id === productoId);
    const colaId = prod?.granel_id ?? '';
    setEnvForm(f => ({ ...f, producto_final_id: productoId, cola_id: colaId }));

    // Try to load recipe for this product
    try {
      const res = await recetasApi.listar({ activa: 'true' });
      const allRecetas = res.data as Receta[];
      const receta = allRecetas.find(r => r.tipo_receta === 'envasado' && r.producto_id === productoId);
      if (receta) {
        const detRes = await recetasApi.obtener(receta.id);
        const det = detRes.data as Receta;
        const ings = det.ingredientes ?? [];
        // Find cola, envase, materials from ingredients
        const colaIng = ings.find(i => productos.find(p => p.id === i.materia_prima_id)?.tipo === 'producto_fabricado');
        const envaseIng = ings.find(i => productos.find(p => p.id === i.materia_prima_id)?.tipo === 'material_embalaje');
        const otrosMats = ings.filter(i => {
          const p = productos.find(pp => pp.id === i.materia_prima_id);
          return p?.tipo === 'material_embalaje' && i.id !== envaseIng?.id;
        });
        setEnvForm(f => ({
          ...f,
          cola_id: colaIng?.materia_prima_id ?? colaId,
          envase_id: envaseIng?.materia_prima_id ?? '',
        }));
        setEnvMateriales(otrosMats.map(m => ({ producto_id: m.materia_prima_id, cantidad: String(m.cantidad ?? '1') })));
      }
    } catch { /* no recipe found, use granel_id only */ }
  };

  // Memoizar filtros sobre `productos` para evitar recrear arrays en cada render.
  // Sin memo, cada renderizado recreaba 3 arrays nuevos → re-render de cualquier
  // hijo que reciba estas props como referencia.
  const productosEnvasados   = useMemo(() => productos.filter(p => p.tipo === 'producto_envasado'),   [productos]);
  const colasDisponibles     = useMemo(() => productos.filter(p => p.tipo === 'producto_fabricado'),  [productos]);
  const envasesDisponibles   = useMemo(() => productos.filter(p => p.tipo === 'material_embalaje'),   [productos]);
  const prodFinalSel = productos.find(p => p.id === envForm.producto_final_id);
  const colaSelEnv = productos.find(p => p.id === envForm.cola_id);
  const envaseSelEnv = productos.find(p => p.id === envForm.envase_id);

  const handleCrearEnvasado = async () => {
    if (!envForm.cola_id || !envForm.envase_id || !envForm.cantidad) return;
    const envase = productos.find(p => p.id === envForm.envase_id);
    const prodFinal = productos.find(p => p.id === envForm.producto_final_id);
    const cantidadUd = parseInt(envForm.cantidad);
    try {
      const mats = envMateriales.filter(m => m.producto_id && parseFloat(m.cantidad) > 0).map(m => ({ producto_id: m.producto_id, cantidad: parseFloat(m.cantidad) }));
      await notify.promise(
        produccionApi.envasadoPlanificar({
          producto_final_id: envForm.producto_final_id || undefined,
          cola_id: envForm.cola_id,
          envase_id: envForm.envase_id,
          cantidad_unidades: cantidadUd,
          fecha_planificada: envForm.fecha || undefined,
          cliente: envForm.cliente || undefined,
          cliente_id: envForm.cliente_id || undefined,
          formato_label: envase?.nombre,
          notas: envForm.notas || undefined,
          materiales: mats.length > 0 ? mats : undefined,
        }),
        {
          loading: 'Planificando envasado…',
          success: 'Envasado planificado',
          successDesc: (
            <ToastBlock title={prodFinal?.nombre ?? 'Producto'}>
              <ToastField label="Cantidad" value={`${cantidadUd.toLocaleString('es-ES')} ud`} />
              <ToastField label="Envase" value={envase?.nombre} />
              <ToastField label="Cliente" value={envForm.cliente} span={2} />
            </ToastBlock>
          ),
          error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al planificar envasado',
        }
      );
      setShowEnvasadoForm(false);
      setEnvForm({ producto_final_id: '', cola_id: '', envase_id: '', cantidad: '', fecha: '', cliente: '', cliente_id: '', notas: '' });
      setEnvMateriales([]);
      cargar();
    } catch { /* notificado */ }
  };

  // Step 1: Show preview (lots to consume)
  const handleConfirmarEnvasado = async (ordenId: string) => {
    setLoadingPreview(true);
    try {
      const { data } = await produccionApi.previewEnvasado(ordenId);
      setEnvasadoPreview({ ordenId, data });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      notify.error(apiErr?.response?.data?.error ?? 'Error al cargar preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  // Step 2: Execute after user confirms
  const ejecutarEnvasado = async () => {
    if (!envasadoPreview) return;
    const ordenId = envasadoPreview.ordenId;
    setEnvasadoPreview(null);
    setEnvasadoAnimacion({ ordenId, fillPct: 10, resultado: null, fase: 'procesando' });

    const interval = setInterval(() => {
      setEnvasadoAnimacion(prev => prev ? { ...prev, fillPct: Math.min(prev.fillPct + 8, 85) } : null);
    }, 200);

    try {
      const { data } = await produccionApi.confirmarEnvasado(ordenId);
      clearInterval(interval);
      setEnvasadoAnimacion(prev => prev ? { ...prev, fillPct: 100, resultado: data } : null);
      const r = data as { producto_envasado?: string; cantidad?: number; lote?: string; peso_cola_consumido?: number };
      notify.success('Envasado completado', {
        description: (
          <ToastBlock title={r.producto_envasado}>
            <ToastField label="Unidades" value={r.cantidad !== undefined ? `${r.cantidad.toLocaleString('es-ES')} ud` : ''} />
            <ToastField label="Cola consumida" value={r.peso_cola_consumido !== undefined ? `${r.peso_cola_consumido.toLocaleString('es-ES', { maximumFractionDigits: 2 })} kg` : ''} />
            <ToastField label="Lote" value={r.lote} span={2} />
          </ToastBlock>
        ),
      });
      setTimeout(() => setEnvasadoAnimacion(prev => prev ? { ...prev, fase: 'completado' } : null), 800);
      cargar();
      setTimeout(() => checkStockBajo(), 1500);
    } catch (err: unknown) {
      clearInterval(interval);
      const apiErr = err as { response?: { data?: { error?: string } } };
      const msg = apiErr?.response?.data?.error ?? 'Error al envasar';
      notify.error('Envasado fallido', { description: msg });
      setEnvasadoAnimacion(prev => prev ? { ...prev, fillPct: 0, fase: 'error', errorMsg: msg } : null);
    }
  };

  const detalleRef = useRef<HTMLDivElement>(null);

  const verDetalle = async (o: OrdenProduccion) => {
    setLoadingDetalle(true);
    setDetalleOrden(null);
    try {
      const { data } = await produccionApi.detalle(o.id);
      setDetalleOrden(data as { orden: OrdenProduccion; consumos: ConsumoDet[]; coste_total?: number });
      setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch { /* silencioso */ }
    finally { setLoadingDetalle(false); }
  };

  const handleEliminar = (o: OrdenProduccion) => setConfirmElim(o);

  const doEliminar = async (modo: 'revertir' | 'borrar' = 'revertir') => {
    if (!confirmElim) return;
    setBorrando(confirmElim.id);
    try {
      await produccionApi.eliminar(confirmElim.id, modo);
      cargar();
      if (detalleOrden?.orden.id === confirmElim.id) setDetalleOrden(null);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { mensaje?: string; error?: string } } };
      notify.error(apiErr?.response?.data?.mensaje ?? apiErr?.response?.data?.error ?? 'Error al eliminar');
    } finally {
      setBorrando(null);
      setConfirmElim(null);
    }
  };

  // Pre-fill desde URL ?receta_id=xxx (botón "Fabricar" en Recetas)
  useEffect(() => {
    const recetaId = searchParams.get('receta_id');
    if (recetaId && recetas.length > 0) {
      setForm((f) => ({ ...f, receta_id: recetaId }));
      setStep(2);
      setShowForm(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, recetas, setSearchParams]);

  // Pre-fill desde pedido confirmado ?producto=X&cantidad=Y&cliente=Z
  useEffect(() => {
    const producto = searchParams.get('producto');
    if (!producto || recetas.length === 0) return;

    const cantidad = searchParams.get('cantidad') ?? '';
    const cliente = searchParams.get('cliente') ?? '';
    const pedidoId = searchParams.get('pedido_id') ?? '';

    // Buscar receta que produce ese producto (match parcial)
    const receta = recetas.find(r =>
      r.producto_nombre?.toLowerCase().includes(producto.toLowerCase()) ||
      r.nombre?.toLowerCase().includes(producto.toLowerCase())
    );

    const cliMatch = clientesList.find(c => c.nombre === cliente);

    setForm(f => ({
      ...f,
      receta_id: receta?.id ?? '',
      cantidad_planificada: cantidad,
      cliente: cliente,
      cliente_id: cliMatch?.id ?? '',
      pedido_id: pedidoId,
    }));

    if (cliMatch) setClienteMode('select');

    setStep(receta ? 2 : 1);
    setShowForm(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, recetas, clientesList, setSearchParams]);

  // Abrir detalle desde URL ?detalle=ORDENID (toast "Ver detalle" tras fabricar)
  useEffect(() => {
    const detalleId = searchParams.get('detalle');
    if (detalleId && ordenes.length > 0) {
      const orden = ordenes.find((o) => o.id === detalleId);
      if (orden) {
        verDetalle(orden);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, ordenes]);

  // Abrir envasado rápido desde URL ?tipo=envasado&producto=X&cantidad=Y (desde Pedidos)
  useEffect(() => {
    const tipo = searchParams.get('tipo');
    const producto = searchParams.get('producto');
    if (tipo === 'envasado' && producto && !envasadoRapidoOpen) {
      const cantidad = searchParams.get('cantidad') ?? '';
      setEnvasadoInitial({ producto, cantidad });
      setEnvasadoRapidoOpen(true);
      setTabProd('envasado');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // Abrir modal fabricación desde URL ?orden_id=xxx (botón Dashboard)
  useEffect(() => {
    const ordenId = searchParams.get('orden_id');
    if (ordenId && ordenes.length > 0) {
      const orden = ordenes.find((o) => o.id === ordenId);
      if (orden) {
        setOrdenFabricando(orden);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, ordenes, setSearchParams]);

  // Abrir detalle (trazabilidad) desde URL ?detalle_id=xxx (calendario Dashboard, ordenes completadas)
  useEffect(() => {
    const detalleId = searchParams.get('detalle_id');
    if (detalleId && ordenes.length > 0) {
      const orden = ordenes.find(o => o.id === detalleId);
      if (orden) {
        verDetalle(orden);
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, ordenes]);

  const handleCrearOrden = async () => {
    const recetaSel = recetas.find(r => r.id === form.receta_id);
    const cantidad = parseFloat(form.cantidad_planificada);
    try {
      await notify.promise(
        produccionApi.crear({
          receta_id:            form.receta_id,
          cantidad_planificada: cantidad,
          fecha_planificada:    form.fecha_planificada || undefined,
          cliente:              form.cliente || undefined,
          cliente_id:           form.cliente_id || undefined,
          notas:                form.notas || undefined,
          pedido_id:            form.pedido_id || undefined,
        }),
        {
          loading: 'Planificando orden de fabricación…',
          success: 'Orden planificada',
          successDesc: (
            <ToastBlock title={recetaSel?.nombre ?? 'Receta'}>
              <ToastField label="Cantidad" value={`${cantidad.toLocaleString('es-ES')} ${recetaSel?.unidad_medida ?? 'kg'}`} />
              <ToastField label="Cliente" value={form.cliente} />
              <ToastField label="Fecha" value={form.fecha_planificada ? new Date(form.fecha_planificada).toLocaleDateString('es-ES') : ''} span={2} />
            </ToastBlock>
          ),
          error: 'No se pudo crear la orden',
        }
      );
      setShowForm(false);
      setStep(1);
      setClienteMode('select');
      setForm({ receta_id: '', cantidad_planificada: '', fecha_planificada: '', cliente: '', cliente_id: '', notas: '', pedido_id: '' });
      cargar();
    } catch { /* notificado por notify.promise */ }
  };


  const abrirEditarOrden = (o: OrdenProduccion) => {
    setEditOrden(o);
    setEditForm({
      cantidad: parseFloat(o.cantidad_planificada).toFixed(2),
      fecha: o.fecha_planificada ? new Date(o.fecha_planificada).toLocaleDateString('en-CA') : '',
      notas: o.notas ?? '',
      cliente: o.cliente ?? '',
    });
  };

  const guardarEditOrden = async () => {
    if (!editOrden) return;
    setSavingEdit(true);
    try {
      await produccionApi.editar(editOrden.id, {
        cantidad_planificada: parseFloat(editForm.cantidad) || undefined,
        fecha_planificada: editForm.fecha || undefined,
        notas: editForm.notas || undefined,
        cliente: editForm.cliente || undefined,
      });
      setEditOrden(null);
      cargar();
    } catch { /* */ }
    finally { setSavingEdit(false); }
  };

  // Normaliza eliminando tildes/diacríticos para búsqueda accent-insensitive
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const ordenesFiltradas = ordenes.filter(o => {
    // Filtrar por tab usando tipo_orden
    const tipoOrden = o.tipo_orden ?? 'fabricacion';
    if (tabProd === 'fabricacion' && tipoOrden !== 'fabricacion') return false;
    if (tabProd === 'envasado' && tipoOrden !== 'envasado') return false;
    if (!busqueda.trim()) return true;
    const q = norm(busqueda.trim());
    const qDigits = q.replace(/\D/g, '');
    const numPart = o.numero_orden.replace(/\D/g, '');
    const fecha = o.fecha_planificada ? new Date(o.fecha_planificada).toLocaleDateString('es-ES') : '';
    const cantidad = parseFloat(o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 0 });
    return norm(o.numero_orden).includes(q)
      || (qDigits.length > 0 && numPart.endsWith(qDigits))
      || norm(o.receta_nombre ?? '').includes(q)
      || norm(o.producto_nombre ?? '').includes(q)
      || norm(o.cliente ?? '').includes(q)
      || norm(o.estado).includes(q)
      || fecha.includes(q)
      || cantidad.includes(q);
  });

  const [paginaProd, setPaginaProd] = useState(1);
  // Reset pagina al cambiar busqueda o tab (si paginaProd queda fuera de rango → página vacía)
  useEffect(() => { setPaginaProd(1); }, [busqueda, tabProd]);
  const POR_PAGINA = 25;
  const totalPaginasProd = Math.ceil(ordenesFiltradas.length / POR_PAGINA);
  const ordenesPag = ordenesFiltradas.slice((paginaProd - 1) * POR_PAGINA, paginaProd * POR_PAGINA);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Producción</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {ordenesFiltradas.length} orden{ordenesFiltradas.length !== 1 ? 'es' : ''} de {tabProd}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-none">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar orden..."
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none w-full sm:w-48"
            />
          </div>
          {tabProd === 'envasado' ? (
            <div className="flex items-center gap-2">
              <button onClick={() => { setShowEnvasadoForm(true); setEnvForm({ producto_final_id: '', cola_id: '', envase_id: '', cantidad: '', fecha: '', cliente: '', cliente_id: '', notas: '' }); setEnvMateriales([]); }}
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm shrink-0">
                <Plus size={16} />
                <span className="hidden sm:inline">Planificar envasado</span>
              </button>
              <button onClick={() => setEnvasadoRapidoOpen(true)}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors shrink-0">
                <Package size={14} />
                <span className="hidden sm:inline">Rápido</span>
              </button>
            </div>
          ) : (
            <button onClick={() => { setShowForm(true); setStep(1); }}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white bg-loga-red hover:bg-loga-red-dark transition-colors shadow-sm shrink-0">
              <Plus size={16} />
              <span className="hidden sm:inline">Nueva Fabricación</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs Fabricación / Envasado — touch-friendly for tablet */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setTabProd('fabricacion'); setPaginaProd(1); }}
          className={clsx(
            'flex items-center gap-2 rounded-xl px-5 py-3 text-base font-bold transition-all',
            tabProd === 'fabricacion'
              ? 'bg-loga-red text-white shadow-md'
              : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
          )}
        >
          <Factory size={18} />
          Fabricación
          <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold', tabProd === 'fabricacion' ? 'bg-white/20' : 'bg-gray-100')}>
            {ordenes.filter(o => (o.tipo_orden ?? 'fabricacion') === 'fabricacion').length}
          </span>
        </button>
        <button
          onClick={() => { setTabProd('envasado'); setPaginaProd(1); }}
          className={clsx(
            'flex items-center gap-2 rounded-xl px-5 py-3 text-base font-bold transition-all',
            tabProd === 'envasado'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
          )}
        >
          <ClipboardList size={18} />
          Envasado
          <span className={clsx('rounded-full px-2 py-0.5 text-xs font-bold', tabProd === 'envasado' ? 'bg-white/20' : 'bg-gray-100')}>
            {ordenes.filter(o => o.tipo_orden === 'envasado').length}
          </span>
        </button>
      </div>

      {/* Modal formulario paso a paso */}
      <AnimatePresence>
        {showForm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setShowForm(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
            >
              {/* Progress bar */}
              <div className="h-1 bg-gray-100">
                <motion.div
                  className="h-full bg-loga-red"
                  animate={{ width: `${(step / 3) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              <div className="px-6 py-5">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50">
                      <Factory size={18} className="text-loga-red" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Nueva Orden</h2>
                      <p className="text-xs text-gray-400">Paso {step} de 3</p>
                    </div>
                  </div>
                  {/* Steps indicator */}
                  <div className="flex gap-1.5">
                    {[1, 2, 3].map((s) => (
                      <div
                        key={s}
                        className={clsx(
                          'h-2 w-2 rounded-full transition-colors',
                          s <= step ? 'bg-loga-red' : 'bg-gray-200'
                        )}
                      />
                    ))}
                  </div>
                </div>

                {/* Paso 1: Selección de receta */}
                {step === 1 && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Seleccionar Receta *
                      </label>
                      {recetas.length > 0 ? (
                        <select
                          value={form.receta_id}
                          onChange={(e) => setForm((f) => ({ ...f, receta_id: e.target.value }))}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                        >
                          <option value="">— Seleccionar {tabProd === 'envasado' ? 'envasado' : 'receta'} —</option>
                          {recetas.filter(r => (r.tipo_receta ?? 'fabricacion') === tabProd).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.nombre} → {r.producto_nombre}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-400 text-center">
                          <p>No hay recetas activas. Crea una receta antes de fabricar.</p>
                          <p className="mt-1 font-mono text-gray-300">POST /api/recetas</p>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <button
                        disabled={!form.receta_id}
                        onClick={() => setStep(2)}
                        className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Siguiente <ChevronRight size={16} />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Paso 2: Cantidad y fecha */}
                {step === 2 && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    {(() => {
                      const recetaSel = recetas.find((r) => r.id === form.receta_id);
                      const unidad = recetaSel?.unidad_medida ?? 'kg';
                      return (
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Cantidad a producir * <span className="font-normal text-gray-400">({unidad})</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={form.cantidad_planificada}
                              onChange={(e) => setForm((f) => ({ ...f, cantidad_planificada: e.target.value }))}
                              placeholder="Ej: 500"
                              className="flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                            />
                            <span className="text-sm font-medium text-gray-500 bg-gray-100 rounded-lg px-3 py-2.5 whitespace-nowrap">{unidad}</span>
                          </div>
                          {recetaSel && (
                            <p className="mt-1 text-[11px] text-gray-400">
                              Rendimiento receta: {parseFloat(recetaSel.rendimiento).toLocaleString('es-ES')} {unidad}/batch
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Fecha planificada (opcional)
                      </label>
                      <input
                        type="date"
                        value={form.fecha_planificada}
                        onChange={(e) => setForm((f) => ({ ...f, fecha_planificada: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Cliente (opcional)
                      </label>
                      <select
                        value={clienteMode === 'select' ? (form.cliente_id || '') : '__otro__'}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '__otro__') {
                            setClienteMode('otro');
                            setForm((f) => ({ ...f, cliente_id: '', cliente: '' }));
                          } else if (val === '') {
                            setClienteMode('select');
                            setForm((f) => ({ ...f, cliente_id: '', cliente: '' }));
                          } else {
                            setClienteMode('select');
                            const cli = clientesList.find((c) => c.id === val);
                            setForm((f) => ({ ...f, cliente_id: val, cliente: cli?.nombre ?? '' }));
                          }
                        }}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                      >
                        <option value="">-- Sin cliente --</option>
                        {clientesList.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}{c.nif ? ` (${c.nif})` : ''}
                          </option>
                        ))}
                        <option value="__otro__">Otro...</option>
                      </select>
                      {clienteMode === 'otro' && (
                        <input
                          type="text"
                          value={form.cliente}
                          onChange={(e) => setForm((f) => ({ ...f, cliente: e.target.value }))}
                          placeholder="Nombre del cliente..."
                          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none"
                          autoFocus
                        />
                      )}
                    </div>
                    <div className="flex justify-between">
                      <button
                        onClick={() => setStep(1)}
                        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
                      >
                        <ChevronLeft size={16} /> Atrás
                      </button>
                      <button
                        disabled={!form.cantidad_planificada || Number(form.cantidad_planificada) <= 0}
                        onClick={() => setStep(3)}
                        className="flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Siguiente <ChevronRight size={16} />
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* Paso 3: Notas + confirmar */}
                {step === 3 && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Notas (opcional)
                      </label>
                      <textarea
                        rows={3}
                        value={form.notas}
                        onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-loga-red focus:ring-2 focus:ring-red-100 outline-none resize-none"
                        placeholder="Instrucciones especiales…"
                      />
                    </div>

                    {/* Resumen */}
                    <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-xs space-y-1 text-gray-600">
                      <p><span className="font-medium">Receta:</span> {recetas.find(r => r.id === form.receta_id)?.nombre}</p>
                      <p><span className="font-medium">Cantidad:</span> {form.cantidad_planificada} {recetas.find((r) => r.id === form.receta_id)?.unidad_medida ?? 'kg'}</p>
                      {form.fecha_planificada && <p><span className="font-medium">Fecha:</span> {form.fecha_planificada}</p>}
                      {form.cliente && <p><span className="font-medium">Cliente:</span> {form.cliente}</p>}
                    </div>

                    <div className="flex justify-between">
                      <button
                        onClick={() => setStep(2)}
                        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
                      >
                        <ChevronLeft size={16} /> Atrás
                      </button>
                      <button
                        onClick={handleCrearOrden}
                        className="flex items-center gap-2 rounded-lg bg-loga-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors"
                      >
                        <Check size={16} /> Crear Orden
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal planificar envasado */}
      <AnimatePresence>
        {showEnvasadoForm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowEnvasadoForm(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 w-full max-w-3xl rounded-2xl bg-white shadow-2xl max-h-[92vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-50 to-white border-b border-emerald-100 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
                    <Package size={15} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Planificar envasado</p>
                    <p className="text-[10px] text-gray-400">Producto final → Cola → Envase → Materiales</p>
                  </div>
                </div>
                <button onClick={() => setShowEnvasadoForm(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={15} /></button>
              </div>

              {/* Producto final — outside scroll so dropdown is never clipped */}
              <div className="px-5 pt-5 pb-2 shrink-0">
                <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">1. Producto final</label>
                <SearchSelect
                  options={productosEnvasados.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                  value={envForm.producto_final_id}
                  onChange={id => { if (id) autoFillFromRecipe(id); else setEnvForm(f => ({ ...f, producto_final_id: '', cola_id: '', envase_id: '' })); }}
                  placeholder="Buscar producto envasado... (ej: Logalkyl, D2, Cartonaje)"
                  selectedLabel={prodFinalSel?.nombre}
                  selectedSub={prodFinalSel?.codigo}
                  selectedRight={prodFinalSel ? `${parseFloat(prodFinalSel.stock_actual).toLocaleString('es-ES')} ud` : undefined}
                />
              </div>

              <div className="px-5 pb-5 space-y-4 overflow-y-auto flex-1">
                {/* 2. Cola (auto-selected, can override) */}
                {envForm.producto_final_id && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                    <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">2. Cola que lleva dentro</label>
                    <SearchSelect
                      options={colasDisponibles.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} kg` }))}
                      value={envForm.cola_id}
                      onChange={id => setEnvForm(f => ({ ...f, cola_id: id }))}
                      placeholder="Buscar cola granel..."
                      selectedLabel={colaSelEnv?.nombre}
                      selectedSub={colaSelEnv?.codigo}
                      selectedRight={colaSelEnv ? `${parseFloat(colaSelEnv.stock_actual).toLocaleString('es-ES')} kg` : undefined}
                    />
                    {colaSelEnv && prodFinalSel?.granel_id === colaSelEnv.id && (
                      <p className="text-[10px] text-emerald-500 mt-1">Asignada automaticamente por el producto</p>
                    )}
                  </motion.div>
                )}

                {/* 3. Envase + cantidad (side by side) */}
                {envForm.cola_id && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">3. Formato de envase</label>
                      <SearchSelect
                        options={envasesDisponibles.map(p => ({ id: p.id, label: p.nombre, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} ud` }))}
                        value={envForm.envase_id}
                        onChange={id => setEnvForm(f => ({ ...f, envase_id: id }))}
                        placeholder="Buscar envase..."
                        selectedLabel={envaseSelEnv?.nombre}
                        selectedRight={envaseSelEnv ? `${parseFloat(envaseSelEnv.stock_actual).toLocaleString('es-ES')}` : undefined}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">4. Cantidad</label>
                      <input type="number" min="1" step="1" value={envForm.cantidad} onChange={e => setEnvForm(f => ({ ...f, cantidad: e.target.value }))}
                        placeholder="Ej: 500"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-lg font-bold text-center font-mono focus:border-emerald-400 outline-none" />
                    </div>
                  </motion.div>
                )}

                {/* Materiales extra */}
                {envForm.envase_id && (
                  <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Materiales extra (cajas, etiquetas...)</label>
                      <button onClick={() => setEnvMateriales(m => [...m, { producto_id: '', cantidad: '' }])}
                        className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800">+ Añadir material</button>
                    </div>
                    {envMateriales.length === 0 && (
                      <p className="text-[10px] text-gray-300 italic">Sin materiales extra</p>
                    )}
                    {envMateriales.map((mat, i) => (
                      <div key={i} className="flex items-center gap-2 mb-2">
                        <div className="flex-1">
                          <SearchSelect
                            options={envasesDisponibles.map(p => ({ id: p.id, label: p.nombre, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')}` }))}
                            value={mat.producto_id}
                            onChange={id => setEnvMateriales(m => m.map((x, j) => j === i ? { ...x, producto_id: id } : x))}
                            placeholder="Buscar material..."
                            selectedLabel={productos.find(p => p.id === mat.producto_id)?.nombre}
                          />
                        </div>
                        <input type="number" min="1" step="1" value={mat.cantidad}
                          onChange={e => setEnvMateriales(m => m.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))}
                          placeholder="Cant."
                          className="w-20 rounded-lg border border-gray-200 px-2 py-2.5 text-xs text-center focus:border-emerald-400 outline-none" />
                        <button onClick={() => setEnvMateriales(m => m.filter((_, j) => j !== i))}
                          className="text-gray-400 hover:text-red-500 p-1"><X size={14} /></button>
                      </div>
                    ))}
                  </motion.div>
                )}

                {/* Fecha + Cliente (side by side) */}
                {envForm.envase_id && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Fecha planificada</label>
                      <input type="date" value={envForm.fecha} onChange={e => setEnvForm(f => ({ ...f, fecha: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-emerald-400 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Cliente</label>
                      <SearchSelect
                        options={clientesList.map(c => ({ id: c.id, label: c.nombre, sub: c.nif ?? '' }))}
                        value={envForm.cliente_id}
                        onChange={id => {
                          const cli = clientesList.find(c => c.id === id);
                          setEnvForm(f => ({ ...f, cliente_id: id, cliente: cli?.nombre ?? '' }));
                        }}
                        placeholder="Buscar cliente..."
                        selectedLabel={clientesList.find(c => c.id === envForm.cliente_id)?.nombre}
                      />
                    </div>
                  </div>
                )}

                {/* Resumen con calculo real */}
                {parseInt(envForm.cantidad) > 0 && envaseSelEnv && colaSelEnv && prodFinalSel && (() => {
                  // Detect multiplier from envase name
                  const multMatch = envaseSelEnv.nombre.match(/(?:caja|pal[eé]|palet)\s*(?:de\s*)?(\d+)/i);
                  const mult = multMatch ? parseInt(multMatch[1], 10) : 1;
                  const cantInput = parseInt(envForm.cantidad);
                  const totalUds = cantInput * mult;
                  const pesoUd = parseFloat(prodFinalSel.peso_unitario_kg ?? '0');
                  const colaNecesaria = totalUds * pesoUd;

                  return (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 p-4 space-y-1.5 text-xs">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Resumen</p>
                      <div className="flex justify-between"><span className="text-gray-500">Producto:</span><span className="font-bold text-gray-800">{prodFinalSel.nombre}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Cola:</span><span className="font-bold text-gray-800">{colaSelEnv.nombre}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Envase:</span><span className="font-bold text-gray-800">{envaseSelEnv.nombre}</span></div>
                      {envMateriales.filter(m => m.producto_id).map((m, i) => {
                        const matProd = productos.find(p => p.id === m.producto_id);
                        return <div key={i} className="flex justify-between"><span className="text-gray-500">+ {matProd?.nombre}</span><span className="font-semibold text-gray-600">{m.cantidad} ud</span></div>;
                      })}
                      <div className="border-t border-emerald-100 pt-2 mt-1 space-y-1">
                        {mult > 1 && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">{cantInput} × {mult} ud/envase =</span>
                            <span className="font-bold text-gray-800">{totalUds.toLocaleString('es-ES')} unidades</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cola necesaria:</span>
                          <span className={clsx('font-bold', colaNecesaria <= parseFloat(colaSelEnv.stock_actual) ? 'text-emerald-600' : 'text-loga-red')}>
                            {colaNecesaria.toLocaleString('es-ES', { maximumFractionDigits: 2 })} kg
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Produccion:</span>
                          <span className="font-black text-emerald-600 text-lg">{totalUds.toLocaleString('es-ES')} ud</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })()}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
                <button onClick={() => setShowEnvasadoForm(false)} className="text-sm text-gray-500 hover:text-gray-900">Cancelar</button>
                <button onClick={handleCrearEnvasado}
                  disabled={!envForm.cola_id || !envForm.envase_id || !envForm.cantidad || parseInt(envForm.cantidad) <= 0}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:bg-gray-300 disabled:shadow-none transition-all">
                  <Check size={16} /> Planificar envasado
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal preview envasado — confirmar lotes antes de ejecutar */}
      <AnimatePresence>
        {envasadoPreview && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEnvasadoPreview(null)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-50 to-white border-b border-emerald-100 shrink-0">
                <div>
                  <p className="text-sm font-bold text-gray-900">Confirmar envasado</p>
                  <p className="text-[10px] text-gray-400">
                    {envasadoPreview.data.multiplicador > 1
                      ? `${envasadoPreview.data.cantidad_input} × ${envasadoPreview.data.multiplicador} = ${envasadoPreview.data.total_unidades} unidades`
                      : `${envasadoPreview.data.total_unidades} unidades`}
                    {' · '}{envasadoPreview.data.peso_cola.toFixed(2)} kg cola
                  </p>
                </div>
                <button onClick={() => setEnvasadoPreview(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={15} /></button>
              </div>

              <div className="p-5 space-y-3 overflow-y-auto flex-1">
                {envasadoPreview.data.consumos.map((c: any, i: number) => (
                  <div key={i} className="rounded-xl border border-gray-100 bg-white p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-gray-900">{c.nombre}</span>
                      <span className={clsx('text-xs font-bold', c.suficiente ? 'text-emerald-600' : 'text-loga-red')}>
                        {c.cantidad_necesaria} {c.unidad} {!c.suficiente && '⚠ insuficiente'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {c.lotes.map((l: any) => (
                        <div key={l.id} className="flex items-center gap-2 text-[11px] text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5">
                          <code className="font-mono text-gray-500 flex-1 truncate">{l.lote_interno}</code>
                          <span className="tabular-nums text-gray-400">{parseFloat(l.cantidad_actual).toLocaleString('es-ES')} disp.</span>
                          <span className="tabular-nums font-bold text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">
                            -{l.cantidad_a_usar} {c.unidad}
                          </span>
                          {l.fecha_caducidad && <span className="text-gray-300">{l.fecha_caducidad}</span>}
                        </div>
                      ))}
                      {c.lotes.length === 0 && <p className="text-[10px] text-red-400 italic">Sin lotes disponibles</p>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
                <button onClick={() => setEnvasadoPreview(null)} className="text-sm text-gray-500 hover:text-gray-900">Cancelar</button>
                <button onClick={ejecutarEnvasado}
                  disabled={!envasadoPreview.data.todo_ok}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 disabled:bg-gray-300 disabled:shadow-none transition-all">
                  <Package size={16} /> Envasar {envasadoPreview.data.total_unidades} ud
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal animación envasado */}
      <AnimatePresence>
        {envasadoAnimacion && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden"
            >
              <div className="h-1 bg-gradient-to-r from-emerald-400 to-emerald-600" />
              <div className="flex flex-col items-center py-8 px-6 space-y-4">
                <TanqueEnvasado pct={envasadoAnimacion.fillPct} size={180} />

                {envasadoAnimacion.fase === 'procesando' && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-emerald-600 font-bold animate-pulse">
                    Envasando...
                  </motion.p>
                )}

                {envasadoAnimacion.fase === 'completado' && envasadoAnimacion.resultado && (
                  <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-3 w-full">
                    <div className="flex items-center justify-center gap-2 text-emerald-600">
                      <Check size={24} /><p className="text-lg font-black">¡Envasado completado!</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 border-2 border-emerald-200 p-4 space-y-1 text-sm">
                      <p className="font-bold text-gray-900">{envasadoAnimacion.resultado.producto_envasado}</p>
                      <p className="text-emerald-700 font-mono text-lg font-black">{envasadoAnimacion.resultado.cantidad?.toLocaleString('es-ES')} unidades</p>
                      <p className="text-xs text-gray-500">Cola consumida: {envasadoAnimacion.resultado.peso_cola_consumido?.toLocaleString('es-ES')} kg</p>
                      <p className="text-xs text-gray-500">Lote: <code className="bg-white rounded px-1">{envasadoAnimacion.resultado.lote}</code></p>
                    </div>
                    <button onClick={() => setEnvasadoAnimacion(null)}
                      className="w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Cerrar</button>
                  </motion.div>
                )}

                {envasadoAnimacion.fase === 'error' && (
                  <div className="text-center space-y-3 w-full">
                    <p className="text-sm font-bold text-loga-red">Error al envasar</p>
                    <p className="text-xs text-red-700 bg-red-50 rounded-lg p-3">{envasadoAnimacion.errorMsg}</p>
                    <button onClick={() => setEnvasadoAnimacion(null)} className="w-full rounded-xl border py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cerrar</button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Cards móvil */}
      <div className="flex flex-col gap-3 md:hidden">
        {ordenesFiltradas.length === 0 && (
          <div className="flex flex-col items-center py-12 text-gray-400">
            <ClipboardList size={32} className="mb-2 text-gray-200" />
            <p className="text-sm">No hay ordenes{busqueda ? ' para esa busqueda' : ''}</p>
          </div>
        )}
        {ordenesPag.map((o) => {
          const isEnv = o.tipo_orden === 'envasado';
          const unidad = isEnv ? 'ud' : (recetas.find((r) => r.id === o.receta_id)?.unidad_medida ?? 'kg');
          return (
            <div key={o.id} className={clsx('rounded-xl border bg-white shadow-sm p-4 space-y-3', isEnv ? 'border-emerald-100' : 'border-gray-100')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-gray-400">{o.numero_orden}</p>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">
                    {isEnv ? (o.formato_label ? `Envasado ${o.formato_label}` : 'Envasado') : (o.receta_nombre ?? '—')}
                  </p>
                  {isEnv && o.notas && <p className="text-[11px] text-emerald-600 truncate">{o.notas}</p>}
                  {o.cliente && <p className="text-xs text-loga-red font-medium">{o.cliente}</p>}
                </div>
                <EstadoBadge estado={o.estado} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="tabular-nums font-semibold text-gray-800">
                  {o.cantidad_real_producida && o.estado === 'completada' ? (
                    <>{parseFloat(o.cantidad_real_producida).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {unidad}
                    {parseFloat(o.merma_pct ?? '0') > 0 && <span className={clsx('ml-1 text-[10px]', parseFloat(o.merma_pct ?? '0') > 5 ? 'text-loga-red font-bold' : 'text-amber-500')}>(-{parseFloat(o.merma_pct ?? '0').toFixed(1)}%)</span>}
                    </>
                  ) : (
                    <>{parseFloat(o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {unidad}</>
                  )}
                </span>
                <span>
                  {o.fecha_planificada
                    ? new Date(o.fecha_planificada).toLocaleDateString('es-ES')
                    : new Date(o.created_at).toLocaleDateString('es-ES')}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                {['borrador', 'confirmada'].includes(o.estado) && (
                  o.tipo_orden === 'envasado' ? (
                    <button
                      onClick={() => handleConfirmarEnvasado(o.id)}
                      disabled={loadingPreview}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                    >
                      {loadingPreview ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Package size={14} />} Envasar
                    </button>
                  ) : (
                    <button
                      onClick={() => intentarFabricar(o)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors"
                    >
                      <Factory size={14} /> Fabricar
                    </button>
                  )
                )}
                <button
                  onClick={() => verDetalle(o)}
                  className="rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-blue-600 hover:border-blue-200 transition-colors"
                >
                  <Eye size={15} />
                </button>
                {['borrador', 'confirmada'].includes(o.estado) && (
                  <button onClick={() => abrirEditarOrden(o)} className="rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-blue-600 hover:border-blue-200 transition-colors" title="Editar orden">
                    <Pencil size={15} />
                  </button>
                )}
                {o.estado === 'completada' && (
                  <>
                    <button
                      onClick={() => { setEmailOrdenId(o.id); setEmailDest(o.cliente ? '' : ''); }}
                      className="rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-blue-600 hover:border-blue-200 transition-colors"
                      title="Enviar trazabilidad por email"
                    >
                      <Send size={15} />
                    </button>
                    <label className="rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-amber-600 hover:border-amber-200 transition-colors cursor-pointer inline-flex" title="Adjuntar">
                      <Paperclip size={15} />
                      <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => {
                        const files = e.target.files;
                        if (!files || files.length === 0) return;
                        await produccionApi.adjuntar(o.id, Array.from(files));
                        cargar();
                        e.target.value = '';
                      }} />
                    </label>
                  </>
                )}
                {o.estado !== 'cancelada' && (
                  <button
                    onClick={() => handleEliminar(o)}
                    disabled={borrando === o.id}
                    className="rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-loga-red hover:border-red-200 disabled:opacity-40 transition-colors"
                  >
                    {borrando === o.id
                      ? <span className="h-3.5 w-3.5 border border-loga-red border-t-transparent rounded-full animate-spin block" />
                      : <Trash2 size={15} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabla desktop */}
      <div className="hidden md:block rounded-xl border border-gray-100 overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Nº Orden', 'Receta / Producto', 'Cantidad', 'Cliente', 'Estado', 'Fecha', 'Acciones'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {ordenesPag.map((o) => {
              const isEnvRow = o.tipo_orden === 'envasado';
              const unidadRow = isEnvRow ? 'ud' : (recetas.find((r) => r.id === o.receta_id)?.unidad_medida ?? 'kg');
              return (
              <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{o.numero_orden}</td>
                <td className="px-4 py-3">
                  {isEnvRow ? (
                    <>
                      <p className="font-medium text-emerald-700 text-xs">{o.formato_label ? `Envasado ${o.formato_label}` : 'Envasado'}</p>
                      <p className="text-[11px] text-gray-400 truncate max-w-[200px]">{o.notas}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-gray-900 text-xs">{o.receta_nombre ?? '—'}</p>
                      <p className="text-[11px] text-gray-400">{o.producto_nombre}</p>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-700">
                  {o.cantidad_real_producida && o.estado === 'completada' ? (
                    <>
                      <span className="font-semibold">{parseFloat(o.cantidad_real_producida).toLocaleString('es-ES', { maximumFractionDigits: 2 })}</span>
                      <span className="ml-1 text-xs text-gray-400">{unidadRow}</span>
                      {parseFloat(o.merma_pct ?? '0') > 0 && (
                        <span className={clsx('ml-1 text-[10px]', parseFloat(o.merma_pct ?? '0') > 5 ? 'text-loga-red font-bold' : 'text-amber-500')}>
                          (-{parseFloat(o.merma_pct ?? '0').toFixed(1)}%)
                        </span>
                      )}
                      <p className="text-[10px] text-gray-300 line-through">{parseFloat(o.cantidad_planificada).toLocaleString('es-ES')} plan.</p>
                    </>
                  ) : (
                    <>
                      {parseFloat(o.cantidad_planificada).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                      <span className="ml-1 text-xs text-gray-400">{unidadRow}</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{o.cliente ?? <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-3"><EstadoBadge estado={o.estado} /></td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {o.fecha_planificada
                    ? new Date(o.fecha_planificada).toLocaleDateString('es-ES')
                    : new Date(o.created_at).toLocaleDateString('es-ES')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {['borrador', 'confirmada'].includes(o.estado) && (
                      o.tipo_orden === 'envasado' ? (
                        <button
                          onClick={() => handleConfirmarEnvasado(o.id)}
                          disabled={loadingPreview}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                        >
                          {loadingPreview ? <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Package size={15} />} Envasar
                        </button>
                      ) : (
                        <button
                          onClick={() => intentarFabricar(o)}
                          className="flex items-center gap-1.5 rounded-lg bg-loga-red px-3.5 py-2 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors"
                        >
                          <Factory size={15} /> Fabricar
                        </button>
                      )
                    )}
                    <button
                      onClick={() => verDetalle(o)}
                      className="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      <Eye size={16} />
                    </button>
                    {['borrador', 'confirmada'].includes(o.estado) && (
                      <button onClick={() => abrirEditarOrden(o)} className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Editar orden">
                        <Pencil size={14} />
                      </button>
                    )}
                    {o.estado === 'completada' && (
                      <>
                        <button
                          onClick={() => { setEmailOrdenId(o.id); setEmailDest(''); }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          title="Enviar trazabilidad por email"
                        >
                          <Send size={14} />
                        </button>
                      </>
                    )}
                    {o.estado === 'completada' && (
                      <label
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors cursor-pointer"
                        title="Adjuntar fotos/archivos"
                      >
                        <Paperclip size={14} />
                        <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={async (e) => {
                          const files = e.target.files;
                          if (!files || files.length === 0) return;
                          await produccionApi.adjuntar(o.id, Array.from(files));
                          cargar();
                          e.target.value = '';
                        }} />
                      </label>
                    )}
                    {o.estado !== 'cancelada' && (
                      <button
                        onClick={() => handleEliminar(o)}
                        disabled={borrando === o.id}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red disabled:opacity-40 transition-colors"
                      >
                        {borrando === o.id
                          ? <span className="h-3 w-3 border border-loga-red border-t-transparent rounded-full animate-spin block" />
                          : <Trash2 size={14} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );})}
            {ordenesFiltradas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <ClipboardList size={32} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">No hay ordenes{busqueda ? ' para esa busqueda' : ''}</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Banner de predicción */}
      {searchParams.get('producto') && searchParams.get('cliente') && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[150] w-full max-w-lg rounded-2xl bg-indigo-600 text-white px-5 py-3 shadow-2xl flex items-center gap-3"
        >
          <Sparkles size={18} className="shrink-0 text-indigo-200" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold">Predicción de demanda</p>
            <p className="text-[11px] text-indigo-200">
              <b className="text-white">{searchParams.get('cliente')}</b> necesita <b className="text-white">{searchParams.get('cantidad')} {searchParams.get('unidad') ?? 'kg'}</b> de <b className="text-white">{searchParams.get('producto')}</b>
            </p>
          </div>
          <button onClick={() => setSearchParams({})} className="shrink-0 rounded-lg bg-white/20 px-2 py-1 text-[10px] font-bold hover:bg-white/30 transition-colors">
            Cerrar
          </button>
        </motion.div>
      )}

      <Paginacion pagina={paginaProd} totalPaginas={totalPaginasProd} onChange={setPaginaProd} totalItems={ordenesFiltradas.length} porPagina={POR_PAGINA} />

      {/* Panel detalle de orden (lotes consumidos) */}
      <AnimatePresence>
        {(detalleOrden || loadingDetalle) && (
          <motion.div
            ref={detalleRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-xl border border-gray-200 bg-white shadow-md overflow-hidden"
          >
            {loadingDetalle ? (
              <div className="flex items-center justify-center py-10">
                <span className="h-5 w-5 border-2 border-loga-red border-t-transparent rounded-full animate-spin" />
              </div>
            ) : detalleOrden && (
              <>
                <div className="flex items-start justify-between px-5 py-3 bg-gray-50 border-b border-gray-100 gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    {(() => {
                      const fotos = detalleOrden.orden.foto_urls && detalleOrden.orden.foto_urls.length > 0
                        ? detalleOrden.orden.foto_urls
                        : detalleOrden.orden.foto_url ? [detalleOrden.orden.foto_url] : [];
                      return fotos.length > 0 && (
                        <div className="flex gap-1.5 shrink-0">
                          {fotos.slice(0, 3).map((url, i) => (
                            <img
                              key={i}
                              src={withAuthToken(url)}
                              alt={`Foto ${i + 1}`}
                              className="h-16 w-16 rounded-lg object-cover border border-gray-200 cursor-pointer hover:scale-105 transition-transform"
                              onClick={() => window.open(withAuthToken(url), '_blank')}
                              title="Ver imagen completa"
                            />
                          ))}
                          {fotos.length > 3 && <span className="text-xs text-gray-400 self-end">+{fotos.length - 3}</span>}
                        </div>
                      );
                    })()}
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900">{detalleOrden.orden.numero_orden} — Trazabilidad</p>
                      <p className="text-xs text-gray-400">
                        {detalleOrden.orden.receta_nombre} · {detalleOrden.orden.cantidad_real_producida
                          ? `${parseFloat(detalleOrden.orden.cantidad_real_producida).toLocaleString('es-ES')} kg (plan: ${parseFloat(detalleOrden.orden.cantidad_planificada).toLocaleString('es-ES')})`
                          : `${parseFloat(detalleOrden.orden.cantidad_planificada).toLocaleString('es-ES')} kg`}
                        {detalleOrden.orden.merma_pct && parseFloat(detalleOrden.orden.merma_pct) > 0 &&
                          <span className={parseFloat(detalleOrden.orden.merma_pct) > 5 ? ' text-loga-red font-bold' : ' text-amber-500'}> · Merma: {parseFloat(detalleOrden.orden.merma_pct).toFixed(1)}%</span>}
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs">
                        {detalleOrden.orden.ph != null && <span className="text-blue-600 font-medium">pH: <b>{detalleOrden.orden.ph}</b></span>}
                        {detalleOrden.orden.solidos != null && <span className="text-blue-600 font-medium">Sol: <b>{detalleOrden.orden.solidos}%</b></span>}
                        {detalleOrden.orden.viscosidad != null && <span className="text-blue-600 font-medium">Visc: <b>{detalleOrden.orden.viscosidad}</b></span>}
                        {detalleOrden.orden.fecha_fabricacion && <span className="text-gray-500">{new Date(detalleOrden.orden.fecha_fabricacion).toLocaleString('es-ES')}</span>}
                      </div>
                      {isAdmin && detalleOrden.coste_total != null && detalleOrden.coste_total > 0 && (
                        <p className="mt-1 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 font-semibold text-amber-800">
                            Coste: {detalleOrden.coste_total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR
                          </span>
                        </p>
                      )}
                      {detalleOrden.orden.notas && (
                        <p className="mt-1 text-[11px] text-amber-600 bg-amber-50 rounded px-2 py-1 border border-amber-100">{detalleOrden.orden.notas}</p>
                      )}
                      {detalleOrden.orden.registro_limpieza && (
                        <div className="mt-1.5 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2">
                          <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Limpieza / Medioambiente</p>
                          <p className="text-xs text-gray-700">{detalleOrden.orden.registro_limpieza}</p>
                        </div>
                      )}
                      {detalleOrden.orden.archivos && detalleOrden.orden.archivos.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {detalleOrden.orden.archivos.map((a, i) => (
                            <a key={i} href={a.url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-gray-100 hover:bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600 font-medium transition-colors">
                              <Paperclip size={9} />
                              {a.nombre}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setDetalleOrden(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 transition-colors shrink-0">
                    <X size={15} />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {detalleOrden.consumos.length === 0 ? (
                    <p className="px-5 py-8 text-center text-xs text-gray-400">Sin movimientos registrados</p>
                  ) : (() => {
                    // Separar PT de consumos
                    const pt       = detalleOrden.consumos.filter((c) => c.tipo === 'produccion_salida');
                    const consumos = detalleOrden.consumos.filter((c) => c.tipo !== 'produccion_salida');

                    // Agrupar consumos por ingrediente
                    const grupos = new Map<string, ConsumoDet[]>();
                    for (const c of consumos) {
                      const key = c.producto_codigo;
                      if (!grupos.has(key)) grupos.set(key, []);
                      grupos.get(key)!.push(c);
                    }

                    return (
                      <table className="min-w-full divide-y divide-gray-100 text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            {['Ingrediente / Producto', 'Total consumido', 'Lote', 'Caducidad', 'Cantidad por lote'].map((h) => (
                              <th key={h} className="px-4 py-2.5 text-left font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                          {/* Consumos agrupados */}
                          {[...grupos.entries()].map(([, lotes]) => {
                            const totalConsumo = lotes.reduce((s, c) => s + Math.abs(parseFloat(c.cantidad)), 0);
                            const multiLote    = lotes.length > 1;
                            return lotes.map((c, idx) => (
                              <tr key={c.id} className={clsx(
                                'hover:bg-gray-50 transition-colors',
                                multiLote && idx > 0 ? 'border-t-0' : ''
                              )}>
                                {/* Ingrediente — solo en primera fila del grupo */}
                                {idx === 0 ? (
                                  <td className="px-4 py-2.5 align-top" rowSpan={lotes.length}>
                                    <p className={clsx('font-semibold', c.producto_tipo === 'producto_fabricado' ? 'text-loga-red cursor-pointer hover:underline' : 'text-gray-900')}
                                      onClick={c.producto_tipo === 'producto_fabricado' && c.lote_id ? async () => {
                                        if (origenExpandido === c.lote_id) { setOrigenExpandido(null); return; }
                                        try {
                                          const { data } = await produccionApi.origenLote(c.lote_id!);
                                          setOrigenDatos(data.consumos ?? []);
                                          setOrigenExpandido(c.lote_id!);
                                        } catch { setOrigenDatos([]); setOrigenExpandido(c.lote_id!); }
                                      } : undefined}
                                    >
                                      {c.producto_nombre}
                                      {c.producto_tipo === 'producto_fabricado' && <span className="ml-1 text-[10px] text-gray-400">▶ ver trazabilidad</span>}
                                    </p>
                                    <p className="text-gray-400 font-mono">{c.producto_codigo}</p>
                                    {multiLote && (
                                      <span className="mt-1 inline-block rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold">
                                        {lotes.length} lotes
                                      </span>
                                    )}
                                  </td>
                                ) : null}
                                {/* Total — solo en primera fila */}
                                {idx === 0 ? (
                                  <td className="px-4 py-2.5 align-top font-bold tabular-nums text-orange-700" rowSpan={lotes.length}>
                                    {totalConsumo.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {c.unidad_medida}
                                  </td>
                                ) : null}
                                <td className={clsx('px-4 py-2', multiLote && 'pl-6')}>
                                  <code className="bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">{c.lote_interno ?? '—'}</code>
                                  {multiLote && <span className="ml-1.5 text-[10px] text-gray-400">lote {idx + 1}/{lotes.length}</span>}
                                </td>
                                <td className="px-4 py-2 text-gray-500">
                                  {c.fecha_caducidad ? new Date(c.fecha_caducidad).toLocaleDateString('es-ES') : '—'}
                                </td>
                                <td className="px-4 py-2 tabular-nums">
                                  <span className="font-semibold text-orange-600">
                                    {Math.abs(parseFloat(c.cantidad)).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {c.unidad_medida}
                                  </span>
                                  {multiLote && (
                                    <span className="ml-1.5 text-[10px] text-gray-400">
                                      ({(Math.abs(parseFloat(c.cantidad)) / totalConsumo * 100).toFixed(0)}%)
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ));
                          })}
                          {/* Trazabilidad expandida de cola fabricada */}
                          {origenExpandido && origenDatos.length > 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-2 bg-red-50/50">
                                <p className="text-[10px] font-bold text-loga-red uppercase mb-1">Trazabilidad de la cola usada</p>
                                <table className="w-full text-[11px]">
                                  <thead><tr className="text-gray-400">
                                    <th className="text-left py-0.5 font-medium">Materia Prima</th>
                                    <th className="text-right py-0.5 font-medium">Cantidad</th>
                                    <th className="text-left py-0.5 font-medium pl-3">Lote</th>
                                    <th className="text-right py-0.5 font-medium">Precio</th>
                                  </tr></thead>
                                  <tbody className="divide-y divide-red-100">
                                    {origenDatos.map((o, oi) => (
                                      <tr key={oi}>
                                        <td className="py-1 font-medium text-gray-700">{o.producto_nombre}</td>
                                        <td className="py-1 text-right tabular-nums text-gray-600">{Math.abs(parseFloat(o.cantidad)).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {o.unidad_medida}</td>
                                        <td className="py-1 pl-3"><code className="bg-white rounded px-1 py-0.5 text-gray-600 text-[10px]">{o.lote_interno ?? '—'}</code></td>
                                        <td className="py-1 text-right tabular-nums text-gray-500">{parseFloat(o.precio_unitario ?? '0').toFixed(4)} EUR</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}

                          {/* Producto terminado */}
                          {pt.map((c) => (
                            <tr key={c.id} className="bg-emerald-50/50">
                              <td className="px-4 py-2.5">
                                <p className="font-semibold text-emerald-800">{c.producto_nombre}</p>
                                <p className="text-emerald-600 font-mono text-[11px]">{c.producto_codigo} · Producto terminado</p>
                              </td>
                              <td className="px-4 py-2.5 font-bold tabular-nums text-emerald-700">
                                +{parseFloat(c.cantidad).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {c.unidad_medida}
                              </td>
                              <td className="px-4 py-2.5">
                                <code className="bg-emerald-100 rounded px-1.5 py-0.5 text-emerald-700">{c.lote_interno ?? '—'}</code>
                              </td>
                              <td className="px-4 py-2.5 text-gray-400">—</td>
                              <td className="px-4 py-2.5 text-xs text-emerald-600 font-medium">Producido</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alerta stock insuficiente */}
      <AnimatePresence>
        {stockError && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setStockError(null)} />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
              <div className="bg-red-50 border-b border-red-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-loga-red">
                    <AlertCircle size={20} className="text-white" />
                  </div>
                  <div>
                    <p className="text-base font-bold text-gray-900">No se puede fabricar</p>
                    <p className="text-sm text-gray-500">Falta stock de materias primas</p>
                  </div>
                </div>
              </div>
              <div className="p-5 space-y-2">
                {stockError.faltas.map((f, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-gray-900">{f.nombre}</p>
                      <p className="text-xs text-gray-500">Necesitas {f.necesario.toFixed(1)} {f.unidad}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-loga-red">{f.disponible.toFixed(1)} {f.unidad}</p>
                      <p className="text-xs text-loga-red font-semibold">Faltan {(f.necesario - f.disponible).toFixed(1)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-4">
                <button onClick={() => setStockError(null)}
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
                  Entendido
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal de fabricación con animación logo */}
      <FabricacionModal
        orden={ordenFabricando}
        onClose={() => setOrdenFabricando(null)}
        onDone={() => { cargar(); }}
      />

      <EnvasadoRapido
        open={envasadoRapidoOpen}
        onClose={() => { setEnvasadoRapidoOpen(false); setEnvasadoInitial(null); }}
        onDone={() => { cargar(); setEnvasadoInitial(null); }}
        initialProducto={envasadoInitial?.producto}
        initialCantidad={envasadoInitial?.cantidad}
      />

      {/* Modal enviar trazabilidad por email */}
      <AnimatePresence>
        {emailOrdenId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => { setEmailOrdenId(null); setEmailExito(false); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50">
                  <Send size={16} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Enviar Trazabilidad</p>
                  <p className="text-xs text-gray-400">PDF + fotos por email al cliente</p>
                </div>
              </div>

              {emailExito ? (
                <div className="flex items-center gap-2 text-emerald-600 py-4 justify-center">
                  <Check size={18} />
                  <p className="text-sm font-semibold">Enviado correctamente</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Email del cliente</label>
                    <input
                      type="email"
                      value={emailDest}
                      onChange={(e) => setEmailDest(e.target.value)}
                      placeholder="cliente@empresa.com"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setEmailOrdenId(null); setEmailExito(false); }}
                      className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleEnviarTrazabilidad}
                      disabled={!emailDest || enviandoEmail}
                      className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
                    >
                      {enviandoEmail ? 'Enviando...' : <><Send size={14} /> Enviar</>}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal editar orden */}
      <Modal open={!!editOrden} onClose={() => setEditOrden(null)} title={`Editar ${editOrden?.numero_orden ?? ''}`}>
        <div className="space-y-4">
          <FormField label="Cantidad planificada">
            <Input type="number" min="0.001" step="0.001" value={editForm.cantidad} onChange={e => setEditForm(f => ({ ...f, cantidad: e.target.value }))} className="text-lg py-3" />
          </FormField>
          <FormField label="Fecha planificada">
            <Input type="date" value={editForm.fecha} onChange={e => setEditForm(f => ({ ...f, fecha: e.target.value }))} />
          </FormField>
          <FormField label="Cliente">
            <Input value={editForm.cliente} onChange={e => setEditForm(f => ({ ...f, cliente: e.target.value }))} placeholder="Nombre del cliente" />
          </FormField>
          <FormField label="Notas">
            <Input value={editForm.notas} onChange={e => setEditForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones..." />
          </FormField>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditOrden(null)} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={guardarEditOrden} disabled={savingEdit} className="flex-1 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300">
              {savingEdit ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmElim}
        title={confirmElim?.estado === 'completada' ? 'Orden completada' : 'Eliminar orden'}
        message={confirmElim?.estado === 'completada'
          ? `Orden ${confirmElim?.numero_orden}:\n\n· Revertir: devuelve materias primas al inventario y elimina el lote producido.\n· Borrar: cancela la orden sin tocar el inventario.`
          : `Se eliminara la orden ${confirmElim?.numero_orden}.`}
        confirmText={confirmElim?.estado === 'completada' ? 'Revertir stock y cancelar' : 'Eliminar'}
        secondaryText={confirmElim?.estado === 'completada' ? 'Borrar sin revertir' : undefined}
        loading={borrando === confirmElim?.id}
        onConfirm={() => doEliminar('revertir')}
        onSecondary={confirmElim?.estado === 'completada' ? () => doEliminar('borrar') : undefined}
        onCancel={() => setConfirmElim(null)}
      />

      {/* Resultado confirmación (legacy, se puede quitar) */}
      <AnimatePresence>
        {(resultadoConfirm || errorConfirm) && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={clsx(
              'rounded-xl border p-5',
              resultadoConfirm
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-loga-red/20 bg-red-50'
            )}
          >
            {resultadoConfirm ? (
              <div className="flex gap-3">
                <Check size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-sm text-emerald-800">
                  <p className="font-semibold">Producción completada</p>
                  <p>Orden: <strong>{String((resultadoConfirm as { numero_orden?: string }).numero_orden ?? '')}</strong></p>
                  <p>Lote producido: <code className="text-xs bg-emerald-100 px-1 rounded">{String((resultadoConfirm as { lote_producido?: string }).lote_producido ?? '')}</code></p>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <AlertCircle size={18} className="text-loga-red shrink-0 mt-0.5" />
                <div className="text-sm text-red-800">
                  <p className="font-semibold">Error en producción (ROLLBACK ejecutado)</p>
                  <p className="text-xs mt-1 font-mono break-all">{errorConfirm}</p>
                </div>
              </div>
            )}
            <button
              onClick={() => { setResultadoConfirm(null); setErrorConfirm(null); }}
              className="mt-3 text-xs underline text-gray-500 hover:text-gray-900"
            >
              Cerrar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: OrdenProduccion['estado'] }) {
  const cfg: Record<OrdenProduccion['estado'], { label: string; cls: string }> = {
    borrador:    { label: 'Pendiente',   cls: 'bg-amber-100 text-amber-700' },
    confirmada:  { label: 'Confirmada',  cls: 'bg-blue-100 text-blue-700' },
    en_proceso:  { label: 'En proceso',  cls: 'bg-amber-100 text-amber-700' },
    completada:  { label: 'Completada',  cls: 'bg-emerald-100 text-emerald-700' },
    cancelada:   { label: 'Cancelada',   cls: 'bg-red-100 text-loga-red' },
  };
  const { label, cls } = cfg[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' };
  return (
    <span className={clsx('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium', cls)}>
      {label}
    </span>
  );
}
