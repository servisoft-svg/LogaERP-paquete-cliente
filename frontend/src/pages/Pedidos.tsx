import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus, Search, ShoppingBag, Clock, Check, X, Factory, Eye, Trash2, Send, Download, Pencil, ClipboardList,
} from 'lucide-react';
import { pedidosApi, productosApi, clientesApi, recetasApi } from '../api/client';
import type { Pedido, Producto, Cliente, Receta } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import { FormField, Input, Select } from '../components/FormField';
import { useAuth } from '../contexts/AuthContext';
import Paginacion from '../components/Paginacion';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField, ToastList } from '../components/ToastFields';
import { checkStockBajo } from '../lib/stockAlerts';
import clsx from 'clsx';

export default function Pedidos() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [pedidos, setPedidos]       = useState<Pedido[]>([]);
  const [productos, setProductos]   = useState<Producto[]>([]);
  const [clientes, setClientes]     = useState<Cliente[]>([]);
  const [, setRecetasEnv] = useState<Receta[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState<number | null>(null);
  const [loading, setLoading]       = useState(true);
  const [busqueda, setBusqueda]     = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');

  // Modal crear/editar
  const [modalOpen, setModalOpen]   = useState(false);
  const [editando, setEditando]     = useState<Pedido | null>(null);
  const [saving, setSaving]         = useState(false);
  interface LineaForm { producto_id: string; cantidad: string; unidad_medida: string; precio_unitario: string; presentacion: string; }
  const emptyLinea = (): LineaForm => ({ producto_id: '', cantidad: '', unidad_medida: 'kg', precio_unitario: '', presentacion: 'ud' });

  // Presentaciones por formato de bote
  const getPresentaciones = (p: Producto) => {
    if (p.tipo !== 'producto_envasado') return [];
    const nombre = p.nombre.toLowerCase();
    const opts: { value: string; label: string; mult: number }[] = [{ value: 'ud', label: 'Unidades sueltas', mult: 1 }];
    if (nombre.includes('75g'))   opts.push({ value: 'caja18', label: 'Caja 18 uds', mult: 18 });
    if (nombre.includes('250g'))  opts.push({ value: 'caja40', label: 'Caja 40 uds', mult: 40 });
    if (nombre.includes('500g'))  opts.push({ value: 'caja24', label: 'Caja 24 uds', mult: 24 });
    if (opts.length === 1 && (nombre.includes('bote') || nombre.includes('frasco'))) {
      opts.push({ value: 'caja12', label: 'Caja 12 uds', mult: 12 });
      opts.push({ value: 'caja24', label: 'Caja 24 uds', mult: 24 });
    }
    if (nombre.includes('garrafa') || nombre.includes('5kg')) {
      opts.push({ value: 'palet60', label: 'Palé 60 uds', mult: 60 });
    }
    if (nombre.includes('bidón') || nombre.includes('bidon')) {
      opts.push({ value: 'palet20', label: 'Palé 20 uds', mult: 20 });
    }
    if (nombre.includes('saco')) {
      opts.push({ value: 'palet40', label: 'Palé 40 sacos', mult: 40 });
    }
    // Siempre: opción personalizada
    opts.push({ value: 'custom', label: 'Otro formato...', mult: 0 });
    return opts;
  };

  const getMultiplicador = (linea: LineaForm) => {
    const prod = productos.find(p => p.id === linea.producto_id);
    if (!prod) return 1;
    if (linea.presentacion === 'custom') return parseInt((linea as any)._customMult || '1', 10) || 1;
    const pres = getPresentaciones(prod).find(p => p.value === linea.presentacion);
    return pres?.mult ?? 1;
  };
  // Helper: mostrar cantidad con peso para envasados
  const fmtCantidad = (cantidad: string | number, unidad: string, productoId?: string) => {
    const cant = typeof cantidad === 'string' ? parseFloat(cantidad) : cantidad;
    if (!cant || cant <= 0) return '—';
    const prod = productoId ? productos.find(p => p.id === productoId) : null;
    const peso = prod?.peso_unitario_kg ? parseFloat(prod.peso_unitario_kg) : null;
    if (peso && prod?.tipo === 'producto_envasado') {
      return `${cant.toLocaleString('es-ES')} ud (${(cant * peso).toLocaleString('es-ES')} kg)`;
    }
    return `${cant.toLocaleString('es-ES')} ${unidad ?? 'kg'}`;
  };

  const [form, setForm] = useState({
    cliente_id: '', cliente_nombre: '', fecha_entrega: '', notas: '',
  });
  const [lineas, setLineas] = useState<LineaForm[]>([emptyLinea()]);
  const [portes, setPortes] = useState('0');
  const [ivaPct, setIvaPct] = useState('21');

  // Detalle
  const [detalle, setDetalle]       = useState<Pedido | null>(null);

  // Confirmar cancelar
  const [confirmCancel, setConfirmCancel] = useState<Pedido | null>(null);

  // Email albaran
  const [emailPedido, setEmailPedido] = useState<Pedido | null>(null);
  const [emailDest, setEmailDest] = useState('');
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailExito, setEmailExito] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [pedRes, prodRes, cliRes, recRes] = await Promise.all([
        pedidosApi.listar(),
        productosApi.listar({ activo: 'true' }),
        clientesApi.listar().catch(() => ({ data: [] })),
        recetasApi.listar({ activa: 'true' }).catch(() => ({ data: [] })),
      ]);
      setPedidos(pedRes.data as Pedido[]);
      setProductos(prodRes.data as Producto[]);
      setClientes(cliRes.data as Cliente[]);
      setRecetasEnv((recRes.data as Receta[]).filter(r => r.tipo_receta === 'envasado'));
    } catch {
      // Non-critical: pedidos list will show empty
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm({ cliente_id: '', cliente_nombre: '', fecha_entrega: '', notas: '' });
    setLineas([emptyLinea()]);
    setPortes('0');
    setIvaPct('21');
    setModalOpen(true);
  };

  const abrirEditar = (p: Pedido) => {
    setEditando(p);
    setForm({
      cliente_id: p.cliente_id ?? '',
      cliente_nombre: p.cliente_nombre_rel ?? p.cliente_nombre ?? '',
      fecha_entrega: p.fecha_entrega ? new Date(p.fecha_entrega).toLocaleDateString('en-CA') : '',
      notas: p.notas ?? '',
    });
    setLineas(
      p.lineas && p.lineas.length > 0
        ? p.lineas.map(l => ({
            producto_id: l.producto_id ?? '',
            cantidad: l.cantidad ?? '',
            unidad_medida: l.unidad_medida ?? 'kg',
            precio_unitario: l.precio_unitario ?? '',
            presentacion: 'ud',
          }))
        : [{ producto_id: p.producto_id ?? '', cantidad: p.cantidad ?? '', unidad_medida: p.unidad_medida ?? 'kg', precio_unitario: '', presentacion: 'ud' }]
    );
    setPortes(p.portes ?? '0');
    setIvaPct(p.iva_porcentaje ?? '21');
    setModalOpen(true);
  };

  const handleGuardar = async () => {
    if (!form.cliente_nombre && !form.cliente_id) return;
    const lineasValidas = lineas.filter(l => l.producto_id && l.cantidad);
    if (lineasValidas.length === 0) return;
    setSaving(true);
    try {
      const cli = clientes.find(c => c.id === form.cliente_id);
      const primera = lineasValidas[0];
      const subtotalCalc = lineasValidas.reduce((s, l) => {
        const cant = parseFloat(l.cantidad || '0') * getMultiplicador(l);
        return s + (cant * parseFloat(l.precio_unitario || '0'));
      }, 0);
      const portesNum = parseFloat(portes || '0');
      const ivaPctNum = parseFloat(ivaPct || '0');
      const ivaNum = (subtotalCalc + portesNum) * ivaPctNum / 100;
      const totalCalc = subtotalCalc + portesNum + ivaNum;

      const primeraMult = getMultiplicador(primera);
      const primeraCantTotal = parseFloat(primera.cantidad) * primeraMult;
      const primeraProd = productos.find(p => p.id === primera.producto_id);
      const primeraUnidad = primeraProd?.tipo === 'producto_envasado' ? 'ud' : primera.unidad_medida;
      const payload = {
        cliente_id: form.cliente_id || undefined,
        cliente_nombre: cli?.nombre ?? form.cliente_nombre ?? undefined,
        producto_id: primera.producto_id,
        cantidad: primeraCantTotal,
        unidad_medida: primeraUnidad,
        fecha_entrega: form.fecha_entrega || undefined,
        notas: form.notas || undefined,
        subtotal: subtotalCalc,
        portes: portesNum,
        iva_porcentaje: ivaPctNum,
        total: totalCalc,
        lineas: lineasValidas.map(l => {
          const mult = getMultiplicador(l);
          const totalUds = parseFloat(l.cantidad || '0') * mult;
          const pres = mult > 1 ? ` (${l.cantidad} × ${mult})` : '';
          return {
          producto_id: l.producto_id,
          producto_nombre: (productos.find(p => p.id === l.producto_id)?.nombre ?? '') + pres,
          cantidad: totalUds,
          unidad_medida: productos.find(p => p.id === l.producto_id)?.tipo === 'producto_envasado' ? 'ud' : l.unidad_medida,
          precio_unitario: parseFloat(l.precio_unitario || '0'),
          subtotal: totalUds * parseFloat(l.precio_unitario || '0'),
        }}),
      };

      const accion = editando ? pedidosApi.editar(editando.id, payload) : pedidosApi.crear(payload);
      await notify.promise(accion, {
        loading: editando ? 'Guardando cambios…' : 'Creando pedido…',
        success: editando ? 'Pedido actualizado' : 'Pedido creado',
        successDesc: (
          <ToastBlock title={payload.cliente_nombre}>
            <ToastField label="Líneas" value={lineasValidas.length} />
            <ToastField label="Total" value={`${totalCalc.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`} span={2} />
          </ToastBlock>
        ),
        error: editando ? 'No se pudo guardar' : 'No se pudo crear el pedido',
      });

      setModalOpen(false);
      setEditando(null);
      cargar();
    } catch { /* notificado */ }
    finally { setSaving(false); }
  };

  const cambiarEstado = async (pedido: Pedido, estado: string) => {
    const labels: Record<string, string> = {
      confirmado: 'Pedido confirmado',
      en_produccion: 'Pedido enviado a producción',
      fabricado: 'Pedido marcado como fabricado',
      completado: 'Pedido completado',
      borrador: 'Pedido vuelto a borrador',
    };
    const lineas = pedido.lineas ?? [];
    try {
      await notify.promise(
        pedidosApi.editar(pedido.id, { estado }),
        {
          loading: `Actualizando ${pedido.numero_pedido ?? 'pedido'}…`,
          success: labels[estado] ?? 'Estado actualizado',
          successDesc: lineas.length > 0 ? (
            <ToastList
              title={pedido.cliente_nombre ?? 'Cliente'}
              rows={lineas.slice(0, 5).map(l => ({
                left: l.producto_nombre,
                right: `${parseFloat(String(l.cantidad)).toLocaleString('es-ES')} ${l.unidad_medida ?? ''}`,
              }))}
              emptyMore={lineas.length > 5 ? lineas.length - 5 : 0}
              footer={pedido.total ? (
                <><span>Total</span><span>{parseFloat(String(pedido.total)).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €</span></>
              ) : undefined}
            />
          ) : undefined,
          error: 'No se pudo actualizar el estado',
        }
      );
      cargar();
    } catch { /* notificado por notify.promise */ }
  };

  const cancelar = async () => {
    if (!confirmCancel) return;
    try {
      await pedidosApi.cancelar(confirmCancel.id);
      setConfirmCancel(null);
      cargar();
    } catch { /* error silencioso */ }
  };

  const fabricar = (p: Pedido) => {
    const prodId = p.producto_id ?? p.lineas?.[0]?.producto_id;
    const prod = productos.find(pr => pr.id === prodId);
    const cantidad = p.cantidad ?? p.lineas?.[0]?.cantidad ?? '';
    const cliente = encodeURIComponent(p.cliente_nombre_rel ?? p.cliente_nombre ?? '');

    if (!prod) { navigate('/produccion'); return; }

    const accion = getAccionPedido(p);

    if ((accion === 'envasar' || p.estado === 'fabricado') && prod.tipo === 'producto_envasado') {
      // Navegar a produccion envasado con producto pre-seleccionado
      navigate(`/produccion?tipo=envasado&producto=${encodeURIComponent(prod.nombre)}&cantidad=${cantidad}&cliente=${cliente}&pedido_id=${p.id}`);
    } else if (accion === 'fabricar') {
      cambiarEstado(p, 'en_produccion');
      navigate(`/produccion?producto=${encodeURIComponent(prod.nombre)}&cantidad=${cantidad}&cliente=${cliente}&pedido_id=${p.id}`);
    } else {
      navigate(`/produccion?producto=${encodeURIComponent(prod.nombre)}&cantidad=${cantidad}&cliente=${cliente}&pedido_id=${p.id}`);
    }
  };

  // Modal consumir con seleccion de lotes
  const [consumirPedido, setConsumirPedido] = useState<Pedido | null>(null);
  const [lotesDisp, setLotesDisp] = useState<Record<string, any[]>>({});
  // lotesSeleccion: { loteId: cantidad a usar de ese lote }
  const [lotesSeleccion, setLotesSeleccion] = useState<Record<string, Record<string, number>>>({});
  const [consumiendo, setConsumiendo] = useState(false);

  const abrirConsumir = async (p: Pedido) => {
    setConsumirPedido(p);
    try {
      const res = await pedidosApi.lotesDisponibles(p.id);
      const data = res.data as Record<string, any[]>;
      setLotesDisp(data);
      // Auto-seleccionar FIFO
      const sel: typeof lotesSeleccion = {};
      for (const [prodId, lotes] of Object.entries(data)) {
        const cantPedida = parseFloat(lotes[0]?.cantidad_pedida ?? '0');
        let falta = cantPedida;
        sel[prodId] = {};
        for (const l of lotes) {
          if (falta <= 0) break;
          const disp = parseFloat(l.cantidad_actual);
          const usar = Math.min(disp, falta);
          sel[prodId][l.id] = usar;
          falta -= usar;
        }
      }
      setLotesSeleccion(sel);
    } catch { /* */ }
  };

  const setCantidadLote = (prodId: string, loteId: string, valor: number, maxLote: number, cantPedida: number) => {
    setLotesSeleccion(prev => {
      const prodSel = { ...(prev[prodId] ?? {}) };
      prodSel[loteId] = Math.max(0, Math.min(valor, maxLote));
      // No permitir que la suma supere lo pedido
      const suma = Object.values(prodSel).reduce((s, v) => s + v, 0);
      if (suma > cantPedida) {
        prodSel[loteId] = Math.max(0, prodSel[loteId] - (suma - cantPedida));
      }
      return { ...prev, [prodId]: prodSel };
    });
  };

  const ejecutarConsumir = async () => {
    if (!consumirPedido) return;
    setConsumiendo(true);
    try {
      // Convertir seleccion a override: solo los lotes con cantidad > 0, en orden
      const override: Record<string, string[]> = {};
      for (const [prodId, lotes] of Object.entries(lotesSeleccion)) {
        override[prodId] = Object.entries(lotes).filter(([, v]) => v > 0).map(([id]) => id);
      }
      await notify.promise(
        pedidosApi.consumir(consumirPedido.id, override),
        {
          loading: 'Consumiendo stock FEFO…',
          success: 'Stock consumido',
          successDesc: (
            <ToastBlock title={consumirPedido.numero_pedido ?? ''}>
              <ToastField label="Estado" value="Completado" span={2} />
            </ToastBlock>
          ),
          error: 'Error al consumir stock',
        }
      );
      setConsumirPedido(null);
      cargar();
      setTimeout(() => checkStockBajo(), 1500);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { mensaje?: string; error?: string } } };
      notify.error(apiErr?.response?.data?.mensaje ?? apiErr?.response?.data?.error ?? 'Error al consumir stock');
    } finally { setConsumiendo(false); }
  };

  const handleEnviarAlbaran = async () => {
    if (!emailPedido || !emailDest) return;
    setEnviandoEmail(true);
    try {
      await notify.promise(
        pedidosApi.enviarAlbaran(emailPedido.id, emailDest),
        {
          loading: 'Enviando albaran…',
          success: 'Albaran enviado',
          successDesc: emailDest,
          error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al enviar',
        }
      );
      setEmailExito(true);
      setTimeout(() => { setEmailPedido(null); setEmailDest(''); setEmailExito(false); }, 2000);
    } catch { /* notificado */ }
    finally {
      setEnviandoEmail(false);
    }
  };

  const getStock = (p: Pedido) => {
    const prodId = p.producto_id ?? p.lineas?.[0]?.producto_id;
    const prod = productos.find(pr => pr.id === prodId);
    return prod ? parseFloat(prod.stock_actual) : 0;
  };

  const tieneStock = (p: Pedido) => {
    const cant = parseFloat(p.cantidad ?? p.lineas?.[0]?.cantidad ?? '0');
    return cant > 0 && getStock(p) >= cant;
  };

  // Info envasado: stock del bote + stock cola granel
  const getInfoEnvasado = (p: Pedido) => {
    const prodId = p.producto_id ?? p.lineas?.[0]?.producto_id;
    const prod = productos.find(pr => pr.id === prodId);
    if (!prod || prod.tipo !== 'producto_envasado') return null;
    const stockBotes = parseFloat(prod.stock_actual ?? '0');
    const granelNombre = prod.granel_nombre;
    const granelStock = parseFloat(prod.granel_stock ?? '0');
    const granelUnidad = prod.granel_unidad ?? 'kg';
    return { stockBotes, granelNombre, granelStock, granelUnidad, prod };
  };

  // Qué acción necesita: consumir / envasar / fabricar
  const getAccionPedido = (p: Pedido): 'consumir' | 'envasar' | 'fabricar' => {
    const cant = parseFloat(p.cantidad ?? p.lineas?.[0]?.cantidad ?? '0');
    if (cant <= 0) return 'fabricar';
    const info = getInfoEnvasado(p);
    if (!info) return tieneStock(p) ? 'consumir' : 'fabricar';
    if (info.stockBotes >= cant) return 'consumir';
    if (info.granelStock > 0) return 'envasar';
    return 'fabricar';
  };

  const [paginaPed, setPaginaPed] = useState(1);
  const POR_PAGINA_PED = 25;

  const filtrados = pedidos
    .filter(p => !filtroEstado || p.estado === filtroEstado)
    .filter(p => {
      if (!busqueda) return true;
      const q = busqueda.toLowerCase();
      return (p.numero_pedido?.toLowerCase().includes(q))
        || (p.cliente_nombre_rel ?? p.cliente_nombre ?? '').toLowerCase().includes(q)
        || (p.producto_nombre_rel ?? p.producto_nombre ?? '').toLowerCase().includes(q);
    });

  const totalPaginasPed = Math.ceil(filtrados.length / POR_PAGINA_PED);
  const filtradosPag = filtrados.slice((paginaPed - 1) * POR_PAGINA_PED, paginaPed * POR_PAGINA_PED);

  // Reset página al cambiar filtro
  useEffect(() => { setPaginaPed(1); }, [filtroEstado, busqueda]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><SpinnerColaBlanca /></div>;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Pedidos</h1>
          <p className="text-xs text-gray-400 mt-0.5">{pedidos.length} pedido{pedidos.length !== 1 ? 's' : ''}</p>
        </div>
        {isAdmin && (
          <button onClick={abrirNuevo} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm">
            <Plus size={16} /> Nuevo Pedido
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar pedido..." className="pl-8 w-full sm:w-52" />
        </div>
        {[
          { v: '', l: 'Todos' }, { v: 'confirmado', l: 'Confirmados' },
          { v: 'en_produccion', l: 'En prod.' }, { v: 'fabricado', l: 'Fabricados' },
          { v: 'envasado', l: 'Envasados' }, { v: 'completado', l: 'Completados' }, { v: 'cancelado', l: 'Cancelados' },
        ].map(({ v: e, l }) => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            className={clsx('rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap',
              filtroEstado === e ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            )}>
            {l}
          </button>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {filtradosPag.length === 0 && (
          <div className="flex flex-col items-center py-12 text-gray-400">
            <ShoppingBag size={32} className="mb-2 text-gray-200" />
            <p className="text-sm">No hay pedidos</p>
          </div>
        )}
        {filtradosPag.map(p => (
          <div key={p.id} className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-mono text-gray-400">{p.numero_pedido}</p>
                <p className="text-sm font-semibold text-gray-900">{p.cliente_nombre_rel ?? p.cliente_nombre ?? p.cliente_email ?? '—'}</p>
              </div>
              <EstadoBadge estado={p.estado} />
            </div>
            <p className="text-xs text-gray-600">
              {p.producto_nombre_rel ?? p.producto_nombre ?? 'Sin producto'}
              {p.cantidad && <span className="ml-1 font-bold">{fmtCantidad(p.cantidad, p.unidad_medida ?? 'kg', p.producto_id)}</span>}
            </p>
            {p.producto_id && (() => {
              const info = getInfoEnvasado(p);
              if (info) {
                return (
                  <div className="rounded-lg border border-gray-100 overflow-hidden text-[11px] mt-1">
                    <table className="w-full">
                      <tbody>
                        <tr className={info.stockBotes > 0 ? 'bg-emerald-50' : 'bg-gray-50'}>
                          <td className="px-2 py-1 text-gray-500">Envasado</td>
                          <td className={clsx('px-2 py-1 text-right font-bold font-mono', info.stockBotes > 0 ? 'text-emerald-600' : 'text-gray-400')}>
                            {info.stockBotes.toLocaleString('es-ES')} ud
                          </td>
                        </tr>
                        <tr className={info.granelStock > 0 ? 'bg-emerald-50' : 'bg-red-50'}>
                          <td className="px-2 py-1 text-gray-500">{info.granelNombre}</td>
                          <td className={clsx('px-2 py-1 text-right font-bold font-mono', info.granelStock > 0 ? 'text-emerald-600' : 'text-loga-red')}>
                            {info.granelStock.toLocaleString('es-ES')} {info.granelUnidad}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              }
              return (
                <div className="rounded-lg border border-gray-100 overflow-hidden text-[11px] mt-1">
                  <table className="w-full">
                    <tbody>
                      <tr className={tieneStock(p) ? 'bg-emerald-50' : 'bg-red-50'}>
                        <td className="px-2 py-1 text-gray-500">Stock</td>
                        <td className={clsx('px-2 py-1 text-right font-bold font-mono', tieneStock(p) ? 'text-emerald-600' : 'text-loga-red')}>
                          {getStock(p).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {productos.find(pr => pr.id === p.producto_id)?.unidad_medida ?? 'kg'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })()}
            {isAdmin && p.total && parseFloat(p.total) > 0 && (
              <p className="text-[11px] font-bold text-gray-700">Total: {parseFloat(p.total).toFixed(2)} EUR</p>
            )}
            {p.fecha_entrega && <p className="text-[11px] text-gray-400 flex items-center gap-1"><Clock size={10} /> {new Date(p.fecha_entrega).toLocaleDateString('es-ES')}</p>}
            {p.origen === 'email' && <span className="inline-block text-[9px] bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium">via email</span>}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {isAdmin && p.estado === 'confirmado' && (() => {
                const accion = getAccionPedido(p);
                return (
                  <>
                    {accion === 'consumir' && (
                      <button onClick={() => abrirConsumir(p)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><Check size={12} /> Consumir</button>
                    )}
                    {accion === 'envasar' && (
                      <button onClick={() => fabricar(p)} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><ClipboardList size={12} /> Envasar</button>
                    )}
                    {accion === 'fabricar' && (
                      <button onClick={() => fabricar(p)} className="flex-1 rounded-lg bg-loga-red py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><Factory size={12} /> Fabricar</button>
                    )}
                  </>
                );
              })()}
              {isAdmin && p.estado === 'en_produccion' && (
                <button onClick={() => cambiarEstado(p, 'fabricado')} className="flex-1 rounded-lg bg-orange-500 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><Check size={12} /> Marcar fabricado</button>
              )}
              {isAdmin && p.estado === 'fabricado' && (() => {
                const prod = productos.find(pr => pr.id === (p.producto_id ?? p.lineas?.[0]?.producto_id));
                const esEnvasado = prod?.tipo === 'producto_envasado';
                return esEnvasado ? (
                  <button onClick={() => fabricar(p)} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><ClipboardList size={12} /> Envasar</button>
                ) : (
                  <button onClick={() => abrirConsumir(p)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><Check size={12} /> Consumir y completar</button>
                );
              })()}
              {isAdmin && p.estado === 'envasado' && (
                <button onClick={() => abrirConsumir(p)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><Check size={12} /> Consumir y completar</button>
              )}
              {isAdmin && p.estado !== 'completado' && p.estado !== 'cancelado' && (
                <button onClick={() => abrirEditar(p)} className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:text-blue-600"><Pencil size={14} /></button>
              )}
              <button onClick={() => setDetalle(p)} className="rounded-lg border border-gray-200 p-2 text-gray-400"><Eye size={14} /></button>
              {isAdmin && (p.estado === 'completado' || p.estado === 'confirmado') && (
                <>
                  <button onClick={async () => {
                    try {
                      const res = await pedidosApi.descargarAlbaran(p.id);
                      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                      const a = document.createElement('a'); a.href = url; a.download = `albaran-${p.numero_pedido}.pdf`; a.click(); URL.revokeObjectURL(url);
                    } catch { /* */ }
                  }} className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors" title="Descargar albaran">
                    <Download size={14} />
                  </button>
                  <button onClick={() => { setEmailPedido(p); setEmailDest(p.cliente_email ?? p.cliente_email_rel ?? ''); }} className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Enviar albaran por email">
                    <Send size={14} />
                  </button>
                </>
              )}
              {isAdmin && p.estado !== 'cancelado' && p.estado !== 'completado' && <button onClick={() => setConfirmCancel(p)} className="rounded-lg border border-gray-200 p-2 text-gray-400"><X size={14} /></button>}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-xl border border-gray-100 overflow-hidden shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Pedido', 'Cliente', 'Producto', 'Cantidad', 'Entrega', 'Acción', 'Estado', 'Acciones'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {filtradosPag.map(p => (
              <tr key={p.id} className="transition-colors hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.numero_pedido}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900 text-xs">{p.cliente_nombre_rel ?? p.cliente_nombre ?? '—'}</p>
                  {p.cliente_email && <p className="text-[11px] text-gray-400">{p.cliente_email}</p>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-700">
                  {p.lineas && p.lineas.length > 0 ? (
                    <div className="space-y-0.5">
                      {p.lineas.map((l, i) => (
                        <p key={i}>
                          <span className="font-medium">{l.producto_nombre_rel ?? l.producto_nombre ?? '—'}</span>
                          <span className="ml-1 text-gray-500">{l.cantidad ? `${parseFloat(l.cantidad).toLocaleString('es-ES')} ${l.unidad_medida ?? 'kg'}` : ''}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <span>{p.producto_nombre_rel ?? p.producto_nombre ?? <span className="text-gray-300">Sin asignar</span>}</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-xs">
                  <span className="font-semibold text-gray-700">{p.cantidad ? fmtCantidad(p.cantidad, p.unidad_medida ?? 'kg', p.producto_id) : '—'}</span>
                  {p.producto_id && p.estado !== 'completado' && p.estado !== 'cancelado' && (() => {
                    const info = getInfoEnvasado(p);
                    if (info) return (
                      <div className="mt-0.5 space-y-0.5">
                        <p className={clsx('text-[10px] font-semibold', info.stockBotes > 0 ? 'text-emerald-600' : 'text-gray-400')}>
                          Envasado: {info.stockBotes.toLocaleString('es-ES')} ud
                        </p>
                        <p className={clsx('text-[10px] font-semibold', info.granelStock > 0 ? 'text-emerald-600' : 'text-loga-red')}>
                          {info.granelNombre}: {info.granelStock.toLocaleString('es-ES')} {info.granelUnidad}
                        </p>
                      </div>
                    );
                    return (
                      <p className={clsx('text-[10px] font-semibold', tieneStock(p) ? 'text-emerald-600' : 'text-loga-red')}>
                        Stock: {getStock(p).toLocaleString('es-ES', { maximumFractionDigits: 0 })} {productos.find(pr => pr.id === p.producto_id)?.unidad_medida ?? ''}
                      </p>
                    );
                  })()}
                  {isAdmin && p.total && parseFloat(p.total) > 0 && (
                    <p className="text-[10px] font-semibold text-gray-500">{parseFloat(p.total).toFixed(2)} EUR</p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {p.fecha_entrega ? new Date(p.fecha_entrega).toLocaleDateString('es-ES') : '—'}
                </td>
                <td className="px-4 py-3">
                  {p.estado === 'completado' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-700 rounded-md px-2 py-1 font-bold"><Check size={10} /> Listo</span>
                  ) : p.estado === 'cancelado' ? (
                    <span className="text-[10px] bg-gray-100 text-gray-400 rounded-md px-2 py-1 font-medium">—</span>
                  ) : (() => {
                    const accion = getAccionPedido(p);
                    if (accion === 'consumir') return <span className="inline-flex items-center gap-1 text-[10px] bg-emerald-100 text-emerald-700 rounded-md px-2 py-1 font-bold whitespace-nowrap"><Check size={10} /> Preparar envío</span>;
                    if (accion === 'envasar') return <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 rounded-md px-2 py-1 font-bold whitespace-nowrap"><ClipboardList size={10} /> Envasar</span>;
                    return <span className="inline-flex items-center gap-1 text-[10px] bg-red-100 text-loga-red rounded-md px-2 py-1 font-bold whitespace-nowrap"><Factory size={10} /> Fabricar</span>;
                  })()}
                </td>
                <td className="px-4 py-3"><EstadoBadge estado={p.estado} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {isAdmin && p.estado === 'confirmado' && (() => {
                      const accion = getAccionPedido(p);
                      return (
                        <>
                          {accion === 'consumir' && (
                            <button onClick={() => abrirConsumir(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1">
                              <Check size={11} /> Consumir
                            </button>
                          )}
                          {accion === 'envasar' && (
                            <button onClick={() => fabricar(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center gap-1">
                              <ClipboardList size={11} /> Envasar
                            </button>
                          )}
                          {accion === 'fabricar' && (
                            <button onClick={() => fabricar(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-loga-red text-white hover:bg-loga-red-dark transition-colors flex items-center gap-1">
                              <Factory size={11} /> Fabricar
                            </button>
                          )}
                        </>
                      );
                    })()}
                    {isAdmin && p.estado === 'en_produccion' && (
                      <button onClick={() => cambiarEstado(p, 'fabricado')} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-orange-500 text-white hover:bg-orange-600 transition-colors flex items-center gap-1">
                        <Check size={11} /> Fabricado
                      </button>
                    )}
                    {isAdmin && p.estado === 'fabricado' && (() => {
                      const prodF = productos.find(pr => pr.id === (p.producto_id ?? p.lineas?.[0]?.producto_id));
                      return prodF?.tipo === 'producto_envasado' ? (
                        <button onClick={() => fabricar(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center gap-1">
                          <ClipboardList size={11} /> Envasar
                        </button>
                      ) : (
                        <button onClick={() => abrirConsumir(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1">
                          <Check size={11} /> Consumir
                        </button>
                      );
                    })()}
                    {isAdmin && p.estado === 'envasado' && (
                      <button onClick={() => abrirConsumir(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1">
                        <Check size={11} /> Consumir
                      </button>
                    )}
                    {isAdmin && p.estado !== 'completado' && p.estado !== 'cancelado' && (
                      <button onClick={() => abrirEditar(p)} className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Editar pedido"><Pencil size={13} /></button>
                    )}
                    <button onClick={() => setDetalle(p)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors"><Eye size={13} /></button>
                    {isAdmin && (p.estado === 'completado' || p.estado === 'confirmado') && (
                      <>
                        <button onClick={async () => {
                          try {
                            const res = await pedidosApi.descargarAlbaran(p.id);
                            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                            const a = document.createElement('a'); a.href = url; a.download = `albaran-${p.numero_pedido}.pdf`; a.click(); URL.revokeObjectURL(url);
                          } catch { /* */ }
                        }} className="rounded-lg p-1.5 text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors" title="Descargar albaran">
                          <Download size={13} />
                        </button>
                        <button onClick={() => { setEmailPedido(p); setEmailDest(p.cliente_email ?? p.cliente_email_rel ?? ''); }} className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Enviar albaran por email">
                          <Send size={13} />
                        </button>
                      </>
                    )}
                    {isAdmin && p.estado !== 'cancelado' && p.estado !== 'completado' && (
                      <button onClick={() => setConfirmCancel(p)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"><X size={13} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtradosPag.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center"><ShoppingBag size={32} className="mx-auto mb-2 text-gray-200" /><p className="text-sm text-gray-400">No hay pedidos</p></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacion pagina={paginaPed} totalPaginas={totalPaginasPed} onChange={setPaginaPed} totalItems={filtrados.length} porPagina={POR_PAGINA_PED} />

      {/* Modal crear pedido */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditando(null); }} title={editando ? `Editar ${editando.numero_pedido}` : 'Nuevo Pedido'} subtitle="Configura el pedido del cliente">
        <div className="space-y-5">
          {/* Cliente */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cliente</p>
            <Select value={form.cliente_id} onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value, cliente_nombre: '' }))}>
              <option value="">— Seleccionar cliente —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}{c.nif ? ` (${c.nif})` : ''}</option>)}
            </Select>
            {!form.cliente_id && (
              <Input value={form.cliente_nombre} onChange={e => setForm(f => ({ ...f, cliente_nombre: e.target.value }))} placeholder="O escribir nombre del cliente..." />
            )}
          </div>

          {/* Lineas del pedido */}
          <div className="rounded-xl border border-loga-red/20 bg-red-50/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-loga-red uppercase tracking-wider">Productos del pedido</p>
              <button type="button" onClick={() => setLineas(l => [...l, emptyLinea()])}
                className="flex items-center gap-1 rounded-md bg-loga-red/10 px-2 py-1 text-[11px] font-semibold text-loga-red hover:bg-loga-red/20 transition-colors">
                <Plus size={11} /> Añadir producto
              </button>
            </div>

            {lineas.map((linea, idx) => {
              const prod = productos.find(p => p.id === linea.producto_id);
              const pres = prod ? getPresentaciones(prod) : [];
              const mult = getMultiplicador(linea);
              const cant = parseFloat(linea.cantidad || '0');
              const totalUds = cant * mult;
              const subtotalLinea = totalUds * parseFloat(linea.precio_unitario || '0');

              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5 shadow-sm"
                >
                  {/* Buscador de producto */}
                  <div className="relative">
                    <p className="text-[10px] text-gray-400 font-medium mb-1">Producto</p>
                    {linea.producto_id && prod ? (
                      <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <span className={clsx('rounded px-1.5 py-0.5 text-[9px] font-bold',
                          prod.tipo === 'producto_fabricado' ? 'bg-loga-red/10 text-loga-red' : 'bg-emerald-100 text-emerald-700'
                        )}>
                          {prod.tipo === 'producto_fabricado' ? 'Granel' : 'Envasado'}
                        </span>
                        <span className="font-semibold text-sm text-gray-900 flex-1">{prod.nombre}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{parseFloat(prod.stock_actual).toFixed(0)} {prod.unidad_medida}</span>
                        <button onClick={() => { const nl = [...lineas]; (nl[idx] as any)._search = ''; nl[idx] = { ...nl[idx], producto_id: '' }; setLineas(nl); }}
                          className="text-gray-400 hover:text-loga-red"><X size={14} /></button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                          <Input
                            value={(linea as any)._search ?? ''}
                            onChange={e => { const nl = [...lineas]; (nl[idx] as any)._search = e.target.value; nl[idx] = { ...nl[idx], producto_id: '' }; setLineas(nl); setDropdownOpen(idx); }}
                            onFocus={() => setDropdownOpen(idx)}
                            onBlur={() => setTimeout(() => setDropdownOpen(null), 200)}
                            placeholder="Buscar cola, bote, garrafa..."
                            className="pl-8"
                            autoComplete="off"
                          />
                        </div>
                        {dropdownOpen === idx && (() => {
                          const q = ((linea as any)._search ?? '').toLowerCase();
                          const vendibles = productos.filter(p => p.activo && p.tipo !== 'materia_prima' && p.tipo !== 'material_embalaje');
                          const filtered = q ? vendibles.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)) : vendibles;
                          const granel = filtered.filter(p => p.tipo === 'producto_fabricado');
                          const envasado = filtered.filter(p => p.tipo === 'producto_envasado');
                          if (filtered.length === 0 && q) return <p className="text-xs text-gray-400 text-center py-2">Sin resultados para "{q}"</p>;
                          if (filtered.length === 0) return null;
                          const selectProd = (p: Producto) => {
                            const nl = [...lineas];
                            nl[idx] = { ...nl[idx], producto_id: p.id, unidad_medida: p.tipo === 'producto_envasado' ? 'ud' : (p.unidad_medida ?? 'kg'), precio_unitario: p.precio_venta ?? '0', presentacion: 'ud' };
                            delete (nl[idx] as any)._search;
                            setLineas(nl);
                          };
                          return (
                            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-56 overflow-y-auto">
                              {granel.length > 0 && <>
                                <p className="px-3 py-1.5 text-[10px] font-bold text-loga-red uppercase bg-red-50 sticky top-0 border-b border-red-100">Granel (kg)</p>
                                {granel.map(p => (
                                  <button key={p.id} onClick={() => selectProd(p)} className="w-full text-left px-3 py-2 hover:bg-red-50/50 flex items-center gap-2 text-xs transition-all border-b border-gray-50">
                                    <span className="w-2 h-2 rounded-full bg-loga-red shrink-0" />
                                    <span className="font-semibold text-gray-800 flex-1">{p.nombre}</span>
                                    <span className={clsx('font-mono text-[10px]', parseFloat(p.stock_actual) > 0 ? 'text-emerald-600' : 'text-gray-300')}>
                                      {parseFloat(p.stock_actual).toLocaleString('es-ES')} {p.unidad_medida}
                                    </span>
                                  </button>
                                ))}
                              </>}
                              {envasado.length > 0 && <>
                                <p className="px-3 py-1.5 text-[10px] font-bold text-emerald-700 uppercase bg-emerald-50 sticky top-0 border-b border-emerald-100">Envasado (botes/garrafas)</p>
                                {envasado.map(p => (
                                  <button key={p.id} onClick={() => selectProd(p)} className="w-full text-left px-3 py-2 hover:bg-emerald-50/50 flex items-center gap-2 text-xs transition-all border-b border-gray-50">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                                    <span className="font-semibold text-gray-800 flex-1">{p.nombre}</span>
                                    <span className={clsx('font-mono text-[10px]', parseFloat(p.stock_actual) > 0 ? 'text-emerald-600' : 'text-gray-300')}>
                                      {parseFloat(p.stock_actual).toLocaleString('es-ES')} ud
                                    </span>
                                  </button>
                                ))}
                              </>}
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>

                  {/* Cantidad + formato + precio */}
                  {linea.producto_id && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {/* Presentación */}
                        {pres.length > 1 && (
                          <div className={linea.presentacion === 'custom' ? 'col-span-2' : ''}>
                            <p className="text-[10px] text-gray-400 font-medium mb-1">Formato</p>
                            <div className="flex gap-1.5">
                              <Select value={linea.presentacion} onChange={e => {
                                const nl = [...lineas]; nl[idx] = { ...nl[idx], presentacion: e.target.value }; setLineas(nl);
                              }} className="flex-1">
                                {pres.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                              </Select>
                              {linea.presentacion === 'custom' && (
                                <Input
                                  type="number" min="1" step="1"
                                  value={(linea as any)._customMult ?? ''}
                                  onChange={e => { const nl = [...lineas]; (nl[idx] as any)._customMult = e.target.value; setLineas([...nl]); }}
                                  placeholder="Uds/caja"
                                  className="w-20 text-center"
                                />
                              )}
                            </div>
                          </div>
                        )}

                        {/* Cantidad */}
                        <div>
                          <p className="text-[10px] text-gray-400 font-medium mb-1">{mult > 1 ? 'Cajas' : 'Cantidad'}</p>
                          <Input type="number" min="1" step="1" value={linea.cantidad} onChange={e => {
                            const nl = [...lineas]; nl[idx] = { ...nl[idx], cantidad: e.target.value }; setLineas(nl);
                          }} placeholder="0" className="text-center font-bold text-lg" />
                        </div>

                        {/* Precio */}
                        {isAdmin && (
                          <div>
                            <p className="text-[10px] text-gray-400 font-medium mb-1">Precio/ud</p>
                            <Input type="number" min="0" step="0.01" value={linea.precio_unitario} onChange={e => {
                              const nl = [...lineas]; nl[idx] = { ...nl[idx], precio_unitario: e.target.value }; setLineas(nl);
                            }} placeholder="0" className="text-center" />
                          </div>
                        )}

                        {/* Unidad — solo para granel, envasado siempre es ud */}
                        {prod?.tipo !== 'producto_envasado' && (
                          <div>
                            <p className="text-[10px] text-gray-400 font-medium mb-1">Unidad</p>
                            <Select value={linea.unidad_medida} onChange={e => {
                              const nl = [...lineas]; nl[idx] = { ...nl[idx], unidad_medida: e.target.value }; setLineas(nl);
                            }}>
                              {['kg', 'L', 'ud', 'caja'].map(u => <option key={u} value={u}>{u}</option>)}
                            </Select>
                          </div>
                        )}
                        {prod?.tipo === 'producto_envasado' && (
                          <div>
                            <p className="text-[10px] text-gray-400 font-medium mb-1">Unidad</p>
                            <p className="py-2 text-xs font-semibold text-gray-600 text-center">ud</p>
                          </div>
                        )}
                      </div>

                      {/* Resumen de la línea */}
                      {cant > 0 && (
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                          <div className="flex items-center gap-3">
                            {mult > 1 && (
                              <span className="font-semibold text-loga-red">
                                {cant.toLocaleString('es-ES')} caja{cant !== 1 ? 's' : ''} × {mult} = <span className="text-base">{totalUds.toLocaleString('es-ES')}</span> ud
                              </span>
                            )}
                            {mult === 1 && (
                              <span className="font-semibold text-gray-700">{cant.toLocaleString('es-ES')} {linea.unidad_medida}</span>
                            )}
                          </div>
                          {isAdmin && subtotalLinea > 0 && (
                            <span className="font-bold text-gray-900">{subtotalLinea.toLocaleString('es-ES', { minimumFractionDigits: 2 })} EUR</span>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  )}

                  {/* Botón eliminar línea */}
                  {lineas.length > 1 && (
                    <div className="flex justify-end">
                      <button onClick={() => setLineas(l => l.filter((_, i) => i !== idx))}
                        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-loga-red transition-colors">
                        <Trash2 size={11} /> Quitar
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
            {/* Totals */}
            {(() => {
              const subtotalCalc = lineas.reduce((s, l) => {
                const cant = parseFloat(l.cantidad || '0') * getMultiplicador(l);
                return s + (cant * parseFloat(l.precio_unitario || '0'));
              }, 0);
              const portesNum = parseFloat(portes || '0');
              const ivaNum = (subtotalCalc + portesNum) * parseFloat(ivaPct || '0') / 100;
              const totalCalc = subtotalCalc + portesNum + ivaNum;
              return (
                <div className={clsx('border-t border-blue-200 pt-2 mt-2 space-y-1 text-xs', !isAdmin && 'hidden')}>
                  <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold">{subtotalCalc.toFixed(2)} EUR</span></div>
                  <div className="flex justify-between items-center gap-2">
                    <span>Portes</span>
                    <Input type="number" min="0" step="0.01" value={portes} onChange={e => setPortes(e.target.value)} className="w-24 text-right text-xs" placeholder="0" />
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span>IVA</span>
                    <div className="flex items-center gap-1">
                      <Input type="number" min="0" max="100" step="1" value={ivaPct} onChange={e => setIvaPct(e.target.value)} className="w-14 text-right text-xs" />
                      <span>%</span>
                    </div>
                    <span className="font-semibold">{ivaNum.toFixed(2)} EUR</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-gray-900 pt-1 border-t border-blue-200">
                    <span>TOTAL</span><span>{totalCalc.toFixed(2)} EUR</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Fecha entrega">
              <Input type="date" value={form.fecha_entrega} onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))} />
            </FormField>
            <FormField label="Notas">
              <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones..." />
            </FormField>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setModalOpen(false); setEditando(null); }} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button onClick={handleGuardar} disabled={saving || (!form.cliente_id && !form.cliente_nombre) || lineas.every(l => !l.producto_id || !l.cantidad)} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300">
              {saving ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear pedido'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal detalle */}
      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle?.numero_pedido ?? ''} subtitle={detalle?.cliente_nombre_rel ?? detalle?.cliente_nombre ?? ''}>
        {detalle && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400">Estado</p><EstadoBadge estado={detalle.estado} /></div>
              <div><p className="text-xs text-gray-400">Origen</p><p className="font-medium">{detalle.origen === 'email' ? 'Email' : 'Manual'}</p></div>
              <div><p className="text-xs text-gray-400">Producto</p><p className="font-medium">{detalle.producto_nombre_rel ?? detalle.producto_nombre ?? '—'}</p></div>
              <div><p className="text-xs text-gray-400">Cantidad</p><p className="font-medium">{detalle.cantidad ? `${parseFloat(detalle.cantidad).toLocaleString('es-ES')} ${detalle.unidad_medida}` : '—'}</p></div>
              <div><p className="text-xs text-gray-400">Entrega</p><p className="font-medium">{detalle.fecha_entrega ? new Date(detalle.fecha_entrega).toLocaleDateString('es-ES') : '—'}</p></div>
              <div><p className="text-xs text-gray-400">Creado</p><p className="font-medium">{new Date(detalle.created_at).toLocaleString('es-ES')}</p></div>
            </div>
            {detalle.lineas && detalle.lineas.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3">
                <p className="text-[11px] font-semibold text-blue-600 uppercase mb-2">Lineas del pedido</p>
                <div className="space-y-1">
                  {detalle.lineas.map((l, i) => (
                    <div key={i} className="flex justify-between text-xs gap-2">
                      <span className="font-medium text-gray-800 flex-1">{l.producto_nombre_rel ?? l.producto_nombre ?? '—'}</span>
                      <span className="text-gray-600 tabular-nums">{l.cantidad ? `${parseFloat(l.cantidad).toLocaleString('es-ES')} ${l.unidad_medida ?? 'kg'}` : ''}</span>
                      {isAdmin && l.precio_unitario && parseFloat(l.precio_unitario) > 0 && (
                        <span className="text-gray-500 tabular-nums">x {parseFloat(l.precio_unitario).toFixed(2)}</span>
                      )}
                      {isAdmin && l.subtotal && parseFloat(l.subtotal) > 0 && (
                        <span className="font-semibold text-gray-700 tabular-nums">{parseFloat(l.subtotal).toFixed(2)} EUR</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detalle.total && parseFloat(detalle.total) > 0 && (
              <div className={clsx('rounded-lg border border-green-100 bg-green-50/30 p-3 space-y-1 text-xs', !isAdmin && 'hidden')}>
                <p className="text-[11px] font-semibold text-green-700 uppercase mb-2">Totales</p>
                <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-medium tabular-nums">{parseFloat(detalle.subtotal ?? '0').toFixed(2)} EUR</span></div>
                {detalle.portes && parseFloat(detalle.portes) > 0 && (
                  <div className="flex justify-between"><span className="text-gray-600">Portes</span><span className="font-medium tabular-nums">{parseFloat(detalle.portes).toFixed(2)} EUR</span></div>
                )}
                <div className="flex justify-between"><span className="text-gray-600">IVA ({detalle.iva_porcentaje ?? '21'}%)</span><span className="font-medium tabular-nums">{((parseFloat(detalle.subtotal ?? '0') + parseFloat(detalle.portes ?? '0')) * parseFloat(detalle.iva_porcentaje ?? '21') / 100).toFixed(2)} EUR</span></div>
                <div className="flex justify-between pt-1 border-t border-green-200 text-sm font-bold text-gray-900"><span>TOTAL</span><span>{parseFloat(detalle.total).toFixed(2)} EUR</span></div>
              </div>
            )}
            {detalle.email_asunto && (
              <div className="rounded-lg bg-purple-50 border border-purple-100 p-3">
                <p className="text-[11px] font-semibold text-purple-600 uppercase mb-1">Email original</p>
                <p className="text-xs font-medium text-gray-800">{detalle.email_asunto}</p>
                <p className="text-xs text-gray-600 mt-1 whitespace-pre-line max-h-40 overflow-y-auto">{detalle.email_cuerpo}</p>
              </div>
            )}
            {detalle.notas && <div><p className="text-xs text-gray-400">Notas</p><p className="text-xs text-gray-700">{detalle.notas}</p></div>}
            {detalle.numero_orden && <div><p className="text-xs text-gray-400">Orden produccion</p><p className="text-xs font-mono text-blue-600">{detalle.numero_orden}</p></div>}
          </div>
        )}
      </Modal>

      {/* Modal enviar albaran */}
      {emailPedido && (
        <Modal open={!!emailPedido} onClose={() => { setEmailPedido(null); setEmailExito(false); }} title="Enviar Albaran" subtitle={emailPedido.numero_pedido}>
          {emailExito ? (
            <div className="flex flex-col items-center py-6 gap-2 text-emerald-600">
              <Check size={32} />
              <p className="text-sm font-semibold">Enviado correctamente</p>
            </div>
          ) : enviandoEmail ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <SpinnerColaBlanca size="md" />
              <p className="text-sm text-gray-500">Enviando albaran…</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Se enviara el albaran PDF + trazabilidad + fotos adjuntas al email indicado.</p>
              <FormField label="Email destinatario">
                <Input type="email" value={emailDest} onChange={e => setEmailDest(e.target.value)} placeholder="cliente@empresa.com" autoFocus />
              </FormField>
              <div className="flex gap-3">
                <button onClick={() => setEmailPedido(null)} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button onClick={handleEnviarAlbaran} disabled={!emailDest} className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300">
                  <Send size={14} /> Enviar
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Modal seleccion de lotes para consumir */}
      <Modal open={!!consumirPedido} onClose={() => setConsumirPedido(null)} title="Consumir stock" subtitle={consumirPedido?.numero_pedido}>
        <div className="space-y-4">
          {Object.entries(lotesDisp).map(([prodId, lotes]) => {
            const cantPedida = parseFloat(lotes[0]?.cantidad_pedida ?? '0');
            const seleccionado = Object.values(lotesSeleccion[prodId] ?? {}).reduce((s, v) => s + v, 0);
            const completo = Math.abs(seleccionado - cantPedida) < 0.01;
            const ud = lotes[0]?.unidad_medida ?? 'kg';

            return (
              <div key={prodId} className="rounded-xl border border-gray-200 overflow-hidden">
                {/* Header producto */}
                <div className={clsx('px-3 py-2 flex items-center justify-between', completo ? 'bg-emerald-50' : 'bg-amber-50')}>
                  <p className="text-xs font-semibold text-gray-800">{lotes[0]?.producto_nombre}</p>
                  <div className="text-xs tabular-nums">
                    <span className={clsx('font-bold', completo ? 'text-emerald-700' : 'text-amber-700')}>{seleccionado.toFixed(2)}</span>
                    <span className="text-gray-400"> / {cantPedida.toFixed(2)} {ud}</span>
                    {completo && <span className="ml-1 text-emerald-600">✓</span>}
                  </div>
                </div>
                {/* Barra progreso */}
                <div className="h-1.5 bg-gray-100">
                  <div className={clsx('h-full transition-all', completo ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${Math.min(100, (seleccionado / cantPedida) * 100)}%` }} />
                </div>
                {/* Lotes */}
                <div className="divide-y divide-gray-100">
                  {lotes.map((l: any) => {
                    const disp = parseFloat(l.cantidad_actual);
                    const usado = lotesSeleccion[prodId]?.[l.id] ?? 0;
                    const activo = usado > 0;

                    return (
                      <div key={l.id} className={clsx('px-3 py-2 flex items-center gap-2 text-xs', activo ? 'bg-blue-50/50' : '')}>
                        {/* Checkbox visual */}
                        <div className={clsx('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors',
                          activo ? 'bg-blue-600 border-blue-600' : 'border-gray-300 hover:border-blue-400'
                        )} onClick={() => {
                          if (activo) {
                            setCantidadLote(prodId, l.id, 0, disp, cantPedida);
                          } else {
                            const falta = cantPedida - seleccionado;
                            setCantidadLote(prodId, l.id, Math.min(disp, falta > 0 ? falta : disp), disp, cantPedida);
                          }
                        }}>
                          {activo && <Check size={10} className="text-white" />}
                        </div>

                        {/* Info lote */}
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-gray-700">{l.lote_interno}</p>
                          <p className="text-[10px] text-gray-400">
                            Disponible: {disp.toFixed(2)} {ud}
                            {l.precio_compra && ` · ${parseFloat(l.precio_compra).toFixed(2)} EUR/${ud}`}
                            {l.fecha_caducidad && ` · cad. ${new Date(l.fecha_caducidad).toLocaleDateString('es-ES')}`}
                          </p>
                        </div>

                        {/* Input cantidad */}
                        {activo && (
                          <input
                            type="number" min="0" max={disp} step="0.01"
                            value={usado || ''}
                            onChange={e => setCantidadLote(prodId, l.id, parseFloat(e.target.value) || 0, disp, cantPedida)}
                            className="w-20 rounded border border-blue-300 px-2 py-1 text-xs text-center font-mono bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Resumen */}
          {(() => {
            const todosCompletos = Object.entries(lotesDisp).every(([prodId, lotes]) => {
              const pedido = parseFloat(lotes[0]?.cantidad_pedida ?? '0');
              const sel = Object.values(lotesSeleccion[prodId] ?? {}).reduce((s, v) => s + v, 0);
              return Math.abs(sel - pedido) < 0.01;
            });
            return (
              <div className="flex gap-3 pt-2">
                <button onClick={() => setConsumirPedido(null)} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button onClick={ejecutarConsumir} disabled={consumiendo || !todosCompletos}
                  className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300 transition-colors">
                  {consumiendo ? 'Consumiendo...' : todosCompletos ? 'Consumir stock' : 'Selecciona todos los lotes'}
                </button>
              </div>
            );
          })()}
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmCancel}
        title="Cancelar pedido"
        message={`Se cancelara el pedido ${confirmCancel?.numero_pedido}.`}
        confirmText="Cancelar pedido"
        onConfirm={cancelar}
        onCancel={() => setConfirmCancel(null)}
      />

    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    nuevo:          { label: 'Nuevo',         cls: 'bg-blue-100 text-blue-700' },
    confirmado:     { label: 'Confirmado',    cls: 'bg-amber-100 text-amber-700' },
    en_produccion:  { label: 'En producción', cls: 'bg-purple-100 text-purple-700' },
    fabricado:      { label: 'Fabricado',     cls: 'bg-orange-100 text-orange-700' },
    envasado:       { label: 'Envasado',      cls: 'bg-cyan-100 text-cyan-700' },
    completado:     { label: 'Completado',    cls: 'bg-emerald-100 text-emerald-700' },
    cancelado:      { label: 'Cancelado',     cls: 'bg-red-100 text-loga-red' },
  };
  const { label, cls } = cfg[estado] ?? { label: estado, cls: 'bg-gray-100 text-gray-600' };
  return <span className={clsx('inline-block rounded-md px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</span>;
}
