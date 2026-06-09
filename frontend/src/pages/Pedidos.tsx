import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, ShoppingBag, Clock, Check, X, Factory, Eye, Trash2, Send, Download, Pencil, ClipboardList, Package,
} from 'lucide-react';
import { pedidosApi, productosApi, clientesApi, recetasApi, recetasEnvasadoApi } from '../api/client';
import FotosPedidoSection from '../components/FotosPedidoSection';
import type { Pedido, Producto, Cliente, Receta } from '../types';
import { cpAProvincia, cpAZona, ZONA_LABEL } from '../lib/provincia';

interface RecetaEnvasadoPorte {
  id: string;
  producto_envasado_id: string;
  liquido_cantidad: string;
  envases_por_bote?: number | null;
  lleva_caja?: boolean | null;
  caja_uds?: number | null;            // multiplicador: envases dentro de 1 caja
  peso_envase_vacio_kg?: string | number | null;
  unidades_por_caja?:    string | number | null;
  peso_caja_vacia_kg?:   string | number | null;
  cajas_por_pale?:       string | number | null;
  peso_pale_vacio_kg?:   string | number | null;
}
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import SearchSelect from '../components/SearchSelect';
import PortesSelector from '../components/PortesSelector';
import AgenciaBadge from '../components/AgenciaBadge';
import TanqueBadge from '../components/TanqueBadge';
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
  const [recetasEnvasado, setRecetasEnvasado] = useState<RecetaEnvasadoPorte[]>([]);
  // Mapa de precio histórico cliente → producto. Se carga al elegir cliente.
  interface PrecioHist { precio_unitario: string; num_usos: number; ultimo_uso_at: string }
  const [preciosCliente, setPreciosCliente] = useState<Record<string, PrecioHist>>({});
  const [dropdownOpen, setDropdownOpen] = useState<number | null>(null);
  const [loading, setLoading]       = useState(true);
  const [busqueda, setBusqueda]     = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');

  // Modal crear/editar
  const [modalOpen, setModalOpen]   = useState(false);
  const [editando, setEditando]     = useState<Pedido | null>(null);

  // Material embalaje EXTRA del pedido (palets, film, etc.) — no entran en
  // albarán/factura. Solo se suma en el informe de materiales + coste interno.
  // En edición se persisten al servidor inmediatamente. En creación nueva se
  // bufferan local y se POSTean tras crear el pedido.
  type EmbExtra = {
    id: string; // server id, o "tmp-N" para drafts en creación
    producto_id: string;
    cantidad: string | number;
    notas: string | null;
    codigo: string;
    nombre: string;
    unidad_medida: string;
    stock_actual?: string | number;
    precio_unitario?: string | number; // €/ud · si >0 sale en albarán
    precio_venta?: string | number;    // del producto (default al añadir)
  };
  const [embExtras, setEmbExtras] = useState<EmbExtra[]>([]);
  const [embExtraDraft, setEmbExtraDraft] = useState<{ producto_id: string; cantidad: string; notas: string; precio_unitario: string }>({ producto_id: '', cantidad: '', notas: '', precio_unitario: '' });
  const [embExtraBusy, setEmbExtraBusy] = useState(false);
  const materialesEmbalaje = useMemo(
    () => productos.filter(p => p.tipo === 'material_embalaje' && p.activo !== false),
    [productos]
  );
  const cargarEmbExtras = async (pedidoId: string) => {
    try {
      const { data } = await pedidosApi.listarEmbalajesExtra(pedidoId);
      setEmbExtras(data as EmbExtra[]);
    } catch (e) { console.error('embalajes-extra fetch', e); }
  };
  const addEmbExtra = async () => {
    const cant = Number(embExtraDraft.cantidad);
    if (!embExtraDraft.producto_id || !Number.isFinite(cant) || cant <= 0) {
      notify.error('Selecciona producto y cantidad > 0'); return;
    }
    const prod = productos.find(p => p.id === embExtraDraft.producto_id);
    if (!prod) return;
    // Precio: lo que tecleó el admin, o el precio_venta del producto si vacío.
    const precioVenta = parseFloat((prod as any).precio_venta ?? '0') || 0;
    const precioFinal = embExtraDraft.precio_unitario
      ? (parseFloat(embExtraDraft.precio_unitario) || 0)
      : precioVenta;
    if (editando) {
      setEmbExtraBusy(true);
      try {
        await pedidosApi.agregarEmbalajeExtra(editando.id, {
          producto_id: embExtraDraft.producto_id,
          cantidad: cant,
          notas: embExtraDraft.notas.trim() || undefined,
          precio_unitario: precioFinal,
        });
        setEmbExtraDraft({ producto_id: '', cantidad: '', notas: '', precio_unitario: '' });
        await cargarEmbExtras(editando.id);
        notify.success('Extra añadido');
      } catch (e: any) {
        notify.error(e?.response?.data?.error?.mensaje ?? 'Error añadiendo extra');
      } finally { setEmbExtraBusy(false); }
    } else {
      // Buffer local — se POSTea tras crear el pedido
      setEmbExtras(prev => [...prev, {
        id: `tmp-${Date.now()}-${Math.random()}`,
        producto_id: embExtraDraft.producto_id,
        cantidad: cant,
        notas: embExtraDraft.notas.trim() || null,
        codigo: prod.codigo,
        nombre: prod.nombre,
        unidad_medida: prod.unidad_medida ?? 'ud',
        precio_unitario: precioFinal,
      }]);
      setEmbExtraDraft({ producto_id: '', cantidad: '', notas: '', precio_unitario: '' });
    }
  };

  // Editar precio inline de un extra ya guardado (sólo en edición de pedido).
  const cambiarPrecioExtra = async (extraId: string, nuevoPrecio: number) => {
    if (!editando) {
      // Buffer local
      setEmbExtras(prev => prev.map(e => e.id === extraId ? { ...e, precio_unitario: nuevoPrecio } : e));
      return;
    }
    try {
      await pedidosApi.editarEmbalajeExtra(editando.id, extraId, { precio_unitario: nuevoPrecio });
      setEmbExtras(prev => prev.map(e => e.id === extraId ? { ...e, precio_unitario: nuevoPrecio } : e));
    } catch { notify.error('No se pudo actualizar precio'); }
  };
  const delEmbExtra = async (extraId: string) => {
    if (extraId.startsWith('tmp-')) {
      setEmbExtras(prev => prev.filter(e => e.id !== extraId));
      return;
    }
    if (!editando) return;
    try {
      await pedidosApi.borrarEmbalajeExtra(editando.id, extraId);
      await cargarEmbExtras(editando.id);
    } catch { notify.error('Error eliminando'); }
  };
  // Cargar extras al entrar en modo edición; resetear al salir.
  useEffect(() => {
    if (modalOpen && editando) cargarEmbExtras(editando.id);
    else if (!modalOpen) setEmbExtras([]); // limpia al cerrar
  }, [modalOpen, editando]);
  const [saving, setSaving]         = useState(false);
  interface LineaForm {
    producto_id: string;
    cantidad: string;             // total botes (= cajas × N + sueltos)
    unidad_medida: string;
    precio_unitario: string;
    presentacion: string;
    _customMult?: string;
    _search?: string;
    // ── Nuevo modelo PE = bote, caja autoenlazada ───────────────
    cantidad_cajas?: string;       // cajas completas
    cantidad_botes_sueltos?: string;
    caja_id?: string;              // caja seleccionada (de cajas_compatibles)
  }
  const emptyLinea = (): LineaForm => ({ producto_id: '', cantidad: '', unidad_medida: 'kg', precio_unitario: '', presentacion: 'ud', _customMult: '', _search: '', cantidad_cajas: '', cantidad_botes_sueltos: '', caja_id: '' });

  // Cache cajas compatibles por bote_id (se carga al elegir producto en línea)
  type CajaCompat = { id: string; codigo: string; nombre: string; botes_por_caja: number | null; unidades_por_envase: number | null; stock_actual: string };
  const [cajasCompatPor, setCajasCompatPor] = useState<Record<string, CajaCompat[]>>({});
  const cargarCajasCompat = async (boteId: string) => {
    if (cajasCompatPor[boteId]) return cajasCompatPor[boteId];
    try {
      const r = await pedidosApi.cajasCompatiblesPara(boteId);
      const data = r.data as CajaCompat[];
      setCajasCompatPor(prev => ({ ...prev, [boteId]: data }));
      return data;
    } catch { return []; }
  };
  const cajasParaLinea = (linea: LineaForm): CajaCompat[] => {
    if (!linea.producto_id) return [];
    return cajasCompatPor[linea.producto_id] ?? [];
  };

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
    if (linea.presentacion === 'custom') return parseInt(linea._customMult || '1', 10) || 1;
    const pres = getPresentaciones(prod).find(p => p.value === linea.presentacion);
    return pres?.mult ?? 1;
  };
  // Cálculo de peso desglosado por línea para estimar porte.
  // Envasado: usa receta-envasado (liquido + envase + caja + palé).
  // Granel: cantidad × unidad (kg/L = peso directo; ud = 0).
  const getPesoLinea = (linea: LineaForm) => {
    const prod = productos.find(p => p.id === linea.producto_id);
    if (!prod) return null;
    const cant = parseFloat(linea.cantidad || '0');
    if (cant <= 0) return null;
    const mult = getMultiplicador(linea);
    const totalUds = cant * mult;

    if (prod.tipo !== 'producto_envasado') {
      // Granel: estimación palets según capacidad típica (1 palet cada 1000 kg).
      // Peso palet vacío ~25 kg. TODO: configurable por producto.
      const PESO_PALET_KG     = 25;
      const KG_POR_PALET      = 1000;
      const pesoKg = (linea.unidad_medida === 'kg' || linea.unidad_medida === 'L') ? totalUds : 0;
      const nPales = pesoKg > 0 ? Math.ceil(pesoKg / KG_POR_PALET) : 0;
      const pesoPales = nPales * PESO_PALET_KG;
      return {
        tipo: 'granel' as const,
        uds: totalUds, unidad: linea.unidad_medida,
        pesoTotal: pesoKg + pesoPales,
        desglose: { liquido: pesoKg, envase: 0, caja: 0, pale: pesoPales },
        cajas: 0, pales: nPales, udC: 1, cPal: 0, sinReceta: false,
      };
    }

    const rec = recetasEnvasado.find(r => r.producto_envasado_id === prod.id);
    if (!rec || (parseFloat(String(rec.liquido_cantidad)) || 0) <= 0) {
      const pesoUnit = parseFloat(prod.peso_unitario_kg ?? '0') || 0;
      return {
        tipo: 'envasado' as const,
        uds: totalUds, pesoTotal: pesoUnit * totalUds,
        desglose: { liquido: pesoUnit * totalUds, envase: 0, caja: 0, pale: 0 },
        cajas: 0, pales: 0, udC: 1, cPal: 0, sinReceta: true,
      };
    }

    const liq    = parseFloat(String(rec.liquido_cantidad)) || 0;
    const envVac = parseFloat(String(rec.peso_envase_vacio_kg ?? 0)) || 0;
    const udC    = Math.max(1, parseInt(String(rec.unidades_por_caja ?? 1), 10) || 1);
    const cVac   = parseFloat(String(rec.peso_caja_vacia_kg ?? 0)) || 0;
    const cPal   = parseInt(String(rec.cajas_por_pale ?? 0), 10) || 0;
    const pVac   = parseFloat(String(rec.peso_pale_vacio_kg ?? 0)) || 0;

    // M = envases dentro de 1 unidad PE. Si la receta lleva caja con
    // multiplicador (caja_uds > 1), usamos ese valor. Si no, envases_por_bote.
    // Caso típico cola domus: M = 177 frascos por caja-PE.
    const M = (rec.lleva_caja && Number(rec.caja_uds ?? 0) > 1)
      ? Number(rec.caja_uds)
      : Math.max(1, Number(rec.envases_por_bote ?? 1));
    const totalEnvasesIndiv = totalUds * M;
    const pesoLiquido = liq * totalEnvasesIndiv;
    const pesoEnvases = envVac * totalEnvasesIndiv;
    const nCajas = udC > 0 ? Math.ceil(totalUds / udC) : 0;
    const pesoCajas = cVac * nCajas;
    const nPales = cPal > 0 ? Math.ceil(nCajas / cPal) : 0;
    const pesoPales = pVac * nPales;
    const pesoTotal = pesoLiquido + pesoEnvases + pesoCajas + pesoPales;

    return {
      tipo: 'envasado' as const,
      uds: totalUds, pesoTotal,
      desglose: { liquido: pesoLiquido, envase: pesoEnvases, caja: pesoCajas, pale: pesoPales },
      cajas: nCajas, pales: nPales, udC, cPal, sinReceta: false,
    };
  };

  // Helper: mostrar cantidad con peso para envasados
  const fmtCantidad = (cantidad: string | number, unidad: string, productoId?: string) => {
    const cant = typeof cantidad === 'string' ? parseFloat(cantidad) : cantidad;
    if (!cant || cant <= 0) return '—';
    const prod = productoId ? productos.find(p => p.id === productoId) : null;
    const peso = prod?.peso_unitario_kg ? parseFloat(prod.peso_unitario_kg) : null;
    // PE siempre se mide en "ud" (envases vendidos). Si hay peso, mostramos
    // también el equivalente kg entre paréntesis. Sin peso, solo "ud" — antes
    // caía al fallback que mostraba "kg" heredado del producto base, confuso.
    if (prod?.tipo === 'producto_envasado') {
      return peso
        ? `${cant.toLocaleString('es-ES')} ud (${(cant * peso).toLocaleString('es-ES')} kg)`
        : `${cant.toLocaleString('es-ES')} ud`;
    }
    return `${cant.toLocaleString('es-ES')} ${unidad ?? 'kg'}`;
  };

  const [form, setForm] = useState({
    cliente_id: '', cliente_nombre: '', fecha_entrega: '', notas: '',
  });
  const [lineas, setLineas] = useState<LineaForm[]>([emptyLinea()]);
  const [portes, setPortes] = useState('0');
  const [ivaPct, setIvaPct] = useState('21');
  const [porteAgencia, setPorteAgencia] = useState<string | null>(null);
  const [portePesoKg, setPortePesoKg] = useState<number | null>(null);

  // Auto-scroll progresivo: al completar un paso scrollea al siguiente
  const productosRef = useRef<HTMLDivElement>(null);
  const fechasRef    = useRef<HTMLDivElement>(null);
  const prevCliOK    = useRef(false);
  const prevProdOK   = useRef(false);

  // Snapshot del estado al abrir el modal (para no scrollear en edición de un pedido ya completo)
  useEffect(() => {
    if (!modalOpen) return;
    const cliOK = !!form.cliente_id || !!form.cliente_nombre.trim();
    const prodOK = lineas.some(l => l.producto_id && parseFloat(l.cantidad || '0') > 0);
    prevCliOK.current = cliOK;
    prevProdOK.current = prodOK;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen]);

  // Detecta transición false→true y scrollea al siguiente bloque
  useEffect(() => {
    if (!modalOpen) return;
    const cliOK = !!form.cliente_id || !!form.cliente_nombre.trim();
    const prodOK = lineas.some(l => l.producto_id && parseFloat(l.cantidad || '0') > 0);

    if (cliOK && !prevCliOK.current && !prodOK) {
      productosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (prodOK && !prevProdOK.current) {
      fechasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevCliOK.current = cliOK;
    prevProdOK.current = prodOK;
  }, [modalOpen, form.cliente_id, form.cliente_nombre, lineas]);

  // Cargar cajas compatibles cuando una línea cambia su producto_id.
  // Si hay exactamente 1 caja → autoseleccionar caja_id en la línea.
  useEffect(() => {
    for (const l of lineas) {
      const prod = productos.find(p => p.id === l.producto_id);
      if (!prod || prod.tipo !== 'producto_envasado') continue;
      if (cajasCompatPor[l.producto_id] !== undefined) {
        const cajas = cajasCompatPor[l.producto_id];
        if (cajas.length === 1 && !l.caja_id) {
          setLineas(prev => prev.map(x => x.producto_id === l.producto_id && !x.caja_id ? { ...x, caja_id: cajas[0].id } : x));
        }
        continue;
      }
      cargarCajasCompat(l.producto_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas.map(l => l.producto_id).join(','), productos.length]);

  // Detalle
  const [detalle, setDetalle]       = useState<Pedido | null>(null);
  const [detalleExtras, setDetalleExtras] = useState<EmbExtra[]>([]);
  const [detalleFotos, setDetalleFotos] = useState<string[]>([]);
  useEffect(() => {
    if (!detalle) { setDetalleExtras([]); setDetalleFotos([]); return; }
    pedidosApi.listarEmbalajesExtra(detalle.id)
      .then(r => setDetalleExtras(r.data as EmbExtra[]))
      .catch(() => setDetalleExtras([]));
    pedidosApi.listarFotos(detalle.id)
      .then(r => setDetalleFotos((r.data as { fotos: string[] }).fotos ?? []))
      .catch(() => setDetalleFotos([]));
  }, [detalle]);
  // Descarga directa de una foto (force download via fetch+blob)
  const descargarFoto = async (url: string) => {
    const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token') || '';
    try {
      const r = await fetch(`${url}?token=${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error('No se pudo descargar');
      const blob = await r.blob();
      const filename = url.split('/').pop() ?? 'foto.jpg';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch { notify.error('No se pudo descargar la foto'); }
  };

  // Confirmar cancelar
  const [confirmCancel, setConfirmCancel] = useState<Pedido | null>(null);

  // Email albaran
  const [emailPedido, setEmailPedido] = useState<Pedido | null>(null);
  const [emailDest, setEmailDest] = useState('');
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailExito, setEmailExito] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [pedRes, prodRes, cliRes, recRes, recEnvRes] = await Promise.all([
        pedidosApi.listar(),
        productosApi.listar({ activo: 'true' }),
        clientesApi.listar().catch(() => ({ data: [] })),
        recetasApi.listar({ activa: 'true' }).catch(() => ({ data: [] })),
        recetasEnvasadoApi.listar().catch(() => ({ data: [] })),
      ]);
      setPedidos(pedRes.data as Pedido[]);
      setProductos(prodRes.data as Producto[]);
      setClientes(cliRes.data as Cliente[]);
      setRecetasEnv((recRes.data as Receta[]).filter(r => r.tipo_receta === 'envasado'));
      setRecetasEnvasado(recEnvRes.data as RecetaEnvasadoPorte[]);
    } catch {
      // Non-critical: pedidos list will show empty
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Atajos teclado en el modal: Esc cierra, Cmd/Ctrl+Enter guarda
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setModalOpen(false); setEditando(null); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleGuardar(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, form, lineas, portes, ivaPct]);

  // Cargar precios históricos cuando se selecciona un cliente
  useEffect(() => {
    if (!form.cliente_id) { setPreciosCliente({}); return; }
    let cancelado = false;
    clientesApi.precios(form.cliente_id)
      .then(({ data }) => {
        if (cancelado) return;
        const map: Record<string, PrecioHist> = {};
        for (const r of (data as Array<PrecioHist & { producto_id: string }>)) {
          map[r.producto_id] = { precio_unitario: r.precio_unitario, num_usos: r.num_usos, ultimo_uso_at: r.ultimo_uso_at };
        }
        setPreciosCliente(map);
      })
      .catch(() => { if (!cancelado) setPreciosCliente({}); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cliente_id]);

  // Devuelve el precio sugerido para un producto: precio histórico del cliente
  // si existe, sino precio_venta del producto, sino 0.
  const getPrecioSugerido = useCallback((producto_id: string): { precio: string; historico: PrecioHist | null } => {
    const hist = preciosCliente[producto_id];
    if (hist) return { precio: hist.precio_unitario, historico: hist };
    const p = productos.find(x => x.id === producto_id);
    return { precio: p?.precio_venta ?? '0', historico: null };
  }, [preciosCliente, productos]);

  // Buscador de clientes archivados (modal secundario en el flujo de pedido).
  // Si el usuario no encuentra a un cliente, abre este buscador → recupera +
  // selecciona en 1 paso.
  const [buscarArchivadosOpen, setBuscarArchivadosOpen] = useState(false);
  const [archivadosBusqueda, setArchivadosBusqueda] = useState('');
  const [archivadosLista, setArchivadosLista] = useState<Cliente[]>([]);
  const [archivadosLoading, setArchivadosLoading] = useState(false);

  useEffect(() => {
    if (!buscarArchivadosOpen) return;
    setArchivadosLoading(true);
    clientesApi.listar({ archivados: 'true' })
      .then(({ data }) => setArchivadosLista(data as Cliente[]))
      .catch(() => setArchivadosLista([]))
      .finally(() => setArchivadosLoading(false));
  }, [buscarArchivadosOpen]);

  const recuperarYSeleccionar = async (c: Cliente) => {
    try {
      await clientesApi.recuperar(c.id);
      // Refrescar lista principal y seleccionar
      const { data } = await clientesApi.listar();
      setClientes(data as Cliente[]);
      setForm(f => ({ ...f, cliente_id: c.id, cliente_nombre: '' }));
      setBuscarArchivadosOpen(false);
      setArchivadosBusqueda('');
      notify.success(`${c.nombre} recuperado y seleccionado`);
    } catch { notify.error('No se pudo recuperar el cliente'); }
  };

  // CP inline para clientes sin código postal — input rápido que actualiza
  // el cliente en BD sin salir del modal de pedidos.
  const [cpInline, setCpInline] = useState('');
  const [cpSaving, setCpSaving] = useState(false);
  const guardarCpInline = async () => {
    if (!form.cliente_id || !/^\d{5}$/.test(cpInline.trim())) return;
    setCpSaving(true);
    try {
      await clientesApi.editar(form.cliente_id, { codigo_postal: cpInline.trim() });
      // Refrescar lista de clientes para que el chip actualice
      const { data } = await clientesApi.listar();
      setClientes(data as Cliente[]);
      setCpInline('');
    } catch { notify.error('No se pudo guardar el CP'); }
    finally { setCpSaving(false); }
  };

  const abrirNuevo = () => {
    setEditando(null);
    setForm({ cliente_id: '', cliente_nombre: '', fecha_entrega: '', notas: '' });
    setLineas([emptyLinea()]);
    setPortes('0');
    setIvaPct('21');
    setPorteAgencia(null);
    setPortePesoKg(null);
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
    setPorteAgencia((p as any).porte_agencia ?? null);
    setPortePesoKg((p as any).porte_peso_kg != null ? parseFloat(String((p as any).porte_peso_kg)) : null);
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
        porte_agencia: porteAgencia,
        porte_peso_kg: portePesoKg,
        lineas: lineasValidas.map(l => {
          const mult = getMultiplicador(l);
          const totalUds = parseFloat(l.cantidad || '0') * mult;
          const pres = mult > 1 ? ` (${l.cantidad} × ${mult})` : '';
          const cajasComp = cajasParaLinea(l);
          const tieneVinc = cajasComp.length > 0;
          // Re-computar cajas/sueltos desde totalUds + M de la caja seleccionada
          // (no fiamos del state stale; UI puede no haber persistido los valores).
          let cantidadCajas = 0;
          let cantidadSueltos = 0;
          let cajaIdFinal: string | null = null;
          if (tieneVinc) {
            const cajaActual = cajasComp.find(c => c.id === l.caja_id) ?? cajasComp[0];
            cajaIdFinal = cajaActual?.id ?? null;
            const M = Number(cajaActual?.botes_por_caja ?? cajaActual?.unidades_por_envase ?? 0) || 0;
            cantidadCajas = M > 0 ? Math.floor(totalUds / M) : 0;
            cantidadSueltos = M > 0 ? totalUds - cantidadCajas * M : totalUds;
          }
          return {
            producto_id: l.producto_id,
            producto_nombre: (productos.find(p => p.id === l.producto_id)?.nombre ?? '') + pres,
            cantidad: totalUds,
            unidad_medida: productos.find(p => p.id === l.producto_id)?.tipo === 'producto_envasado' ? 'ud' : l.unidad_medida,
            precio_unitario: parseFloat(l.precio_unitario || '0'),
            subtotal: totalUds * parseFloat(l.precio_unitario || '0'),
            // Vinculación caja (nuevo modelo)
            ...(tieneVinc ? {
              cantidad_cajas: cantidadCajas,
              cantidad_botes_sueltos: cantidadSueltos,
              caja_id: cajaIdFinal,
            } : {}),
          };
        }),
      };

      const accion = editando ? pedidosApi.editar(editando.id, payload) : pedidosApi.crear(payload);
      const resp = await notify.promise(accion, {
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

      // Si era pedido nuevo + hay extras bufferados, postearlos ahora con precio.
      if (!editando && embExtras.length > 0) {
        const nuevoPedidoId = (resp?.data?.id ?? resp?.data?.pedido?.id) as string | undefined;
        if (nuevoPedidoId) {
          await Promise.all(embExtras.map(e =>
            pedidosApi.agregarEmbalajeExtra(nuevoPedidoId, {
              producto_id: e.producto_id,
              cantidad: Number(e.cantidad),
              notas: e.notas ?? undefined,
              precio_unitario: Number(e.precio_unitario ?? 0),
            }).catch(err => console.error('extra falló', err))
          ));
        }
      }

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
    const p = confirmCancel;
    const eraCompletado = p.estado === 'completado';
    try {
      await notify.promise(
        pedidosApi.cancelar(p.id) as Promise<{ data: { ok: boolean; reversiones?: number } }>,
        {
          loading: eraCompletado ? 'Cancelando y devolviendo stock…' : 'Cancelando pedido…',
          success: eraCompletado ? 'Pedido cancelado y stock devuelto' : 'Pedido cancelado',
          successDesc: (res) => {
            const rev = (res as { data?: { reversiones?: number } })?.data?.reversiones ?? 0;
            return (
              <ToastBlock title={p.numero_pedido ?? '—'}>
                <ToastField label="Cliente" value={p.cliente_nombre_rel ?? p.cliente_nombre ?? '—'} span={2} />
                {eraCompletado && (
                  <ToastField
                    label="Stock devuelto"
                    value={rev > 0 ? `${rev} movimiento${rev !== 1 ? 's' : ''} revertidos` : 'sin movimientos previos'}
                    span={2}
                  />
                )}
              </ToastBlock>
            );
          },
          error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo cancelar',
        }
      );
      setConfirmCancel(null);
      cargar();
      setTimeout(() => checkStockBajo(), 1500);
    } catch { /* notificado por notify.promise */ }
  };

  const fabricar = (p: Pedido) => {
    const prodId = p.producto_id ?? p.lineas?.[0]?.producto_id;
    const prod = productos.find(pr => pr.id === prodId);
    const cantidadPedida = parseFloat(String(p.cantidad ?? p.lineas?.[0]?.cantidad ?? '0')) || 0;
    const cliente = encodeURIComponent(p.cliente_nombre_rel ?? p.cliente_nombre ?? '');

    if (!prod) { navigate('/produccion'); return; }

    // Cantidad recomendada = lo que FALTA (cantidad pedida − stock actual).
    // Si stock cubre todo, mantén la cantidad pedida (sería raro caer aquí).
    const stockActual = parseFloat(prod.stock_actual ?? '0') || 0;
    const falta = Math.max(0, cantidadPedida - stockActual);
    const cantidadParam = falta > 0 ? String(falta) : String(cantidadPedida);

    // Decisión por TIPO de producto:
    //  - producto_envasado (PE) → siempre envasado. Envasado decide si necesita granel.
    //  - producto_fabricado (granel) → fabricar.
    if (prod.tipo === 'producto_envasado') {
      navigate(`/produccion?tipo=envasado&producto=${encodeURIComponent(prod.nombre)}&cantidad=${cantidadParam}&cliente=${cliente}&pedido_id=${p.id}`);
    } else {
      cambiarEstado(p, 'en_produccion');
      navigate(`/produccion?producto=${encodeURIComponent(prod.nombre)}&cantidad=${cantidadParam}&cliente=${cliente}&pedido_id=${p.id}`);
    }
  };

  // Modal consumir con seleccion de lotes
  const [consumirPedido, setConsumirPedido] = useState<Pedido | null>(null);
  const [lotesDisp, setLotesDisp] = useState<Record<string, any[]>>({});
  // lotesSeleccion: { loteId: cantidad a usar de ese lote }
  const [lotesSeleccion, setLotesSeleccion] = useState<Record<string, Record<string, number>>>({});
  const [consumiendo, setConsumiendo] = useState(false);

  // Extras del pedido al abrir consumir — para mostrar en preparación
  const [consumirExtras, setConsumirExtras] = useState<EmbExtra[]>([]);
  const abrirConsumir = async (p: Pedido) => {
    setConsumirPedido(p);
    setConsumirExtras([]);
    pedidosApi.listarEmbalajesExtra(p.id)
      .then(r => setConsumirExtras(r.data as EmbExtra[]))
      .catch(() => setConsumirExtras([]));
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
      // Convertir seleccion a override: cada lote con su cantidad exacta.
      // El backend respeta la cantidad pedida por lote (no FEFO).
      const override: Record<string, Array<{ lote_id: string; cantidad: number }>> = {};
      for (const [prodId, lotes] of Object.entries(lotesSeleccion)) {
        override[prodId] = Object.entries(lotes)
          .filter(([, v]) => v > 0)
          .map(([id, v]) => ({ lote_id: id, cantidad: v }));
      }
      await notify.promise(
        pedidosApi.consumir(consumirPedido.id, override as any),
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
              <div className="flex flex-col items-end gap-1">
                <EstadoBadge estado={p.estado} />
                {p.porte_agencia && <AgenciaBadge agencia={p.porte_agencia} pesoKg={p.porte_peso_kg} />}
              </div>
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
            {/* Coste real: solo admin, solo si hay lotes consumidos. Compara
                contra total para colorear margen (verde +, rojo -). */}
            {isAdmin && p.coste_real != null && parseFloat(p.coste_real) > 0 && (() => {
              const cr = parseFloat(p.coste_real);
              const tot = parseFloat(p.total ?? '0');
              const margen = tot > 0 ? tot - cr : 0;
              const margenPct = tot > 0 ? (margen / tot) * 100 : 0;
              return (
                <p className="text-[11px] flex items-center gap-1.5" title="Coste calculado con el precio_compra de los lotes concretos consumidos (no precio ficha)">
                  <span className="text-gray-500">Coste lotes:</span>
                  <span className="font-bold text-amber-700">{cr.toFixed(2)} EUR</span>
                  {tot > 0 && (
                    <span className={clsx('font-bold tabular-nums', margen >= 0 ? 'text-emerald-600' : 'text-loga-red')}>
                      → margen {margen >= 0 ? '+' : ''}{margen.toFixed(2)} EUR ({margenPct.toFixed(0)}%)
                    </span>
                  )}
                </p>
              );
            })()}
            {p.fecha_entrega && <p className="text-[11px] text-gray-400 flex items-center gap-1"><Clock size={10} /> {new Date(p.fecha_entrega).toLocaleDateString('es-ES')}</p>}
            {p.origen === 'email' && <span className="inline-block text-[9px] bg-purple-100 text-purple-700 rounded px-1.5 py-0.5 font-medium">via email</span>}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {isAdmin && p.estado === 'confirmado' && (() => {
                const accion = getAccionPedido(p);
                const prodId = p.producto_id ?? p.lineas?.[0]?.producto_id;
                const prod = productos.find(pr => pr.id === prodId);
                const esEnvasado = prod?.tipo === 'producto_envasado';
                return (
                  <>
                    {accion === 'consumir' && (
                      <button onClick={() => abrirConsumir(p)} className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><Check size={12} /> Consumir</button>
                    )}
                    {accion !== 'consumir' && esEnvasado && (
                      <button onClick={() => fabricar(p)} className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white flex items-center justify-center gap-1"><ClipboardList size={12} /> Envasar</button>
                    )}
                    {accion !== 'consumir' && !esEnvasado && (
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
              {isAdmin && p.estado !== 'cancelado' && p.estado !== 'completado' && (
                <button onClick={() => setConfirmCancel(p)}
                  title="Cancelar pedido"
                  className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors">
                  <X size={14} />
                </button>
              )}
              {isAdmin && p.estado === 'completado' && (
                <button onClick={() => setConfirmCancel(p)}
                  title="Borrar y devolver stock"
                  className="rounded-lg border border-red-200 bg-red-50 p-2 text-loga-red hover:bg-red-100 transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
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
                  {/* Coste real (lotes consumidos): sólo admin */}
                  {isAdmin && p.coste_real != null && parseFloat(p.coste_real) > 0 && (() => {
                    const cr = parseFloat(p.coste_real);
                    const tot = parseFloat(p.total ?? '0');
                    const margen = tot > 0 ? tot - cr : 0;
                    return (
                      <p className="text-[10px] text-amber-700 font-semibold tabular-nums" title="Coste real con precio_compra de los lotes concretos consumidos">
                        Coste: {cr.toFixed(2)} €
                        {tot > 0 && (
                          <span className={clsx('ml-1', margen >= 0 ? 'text-emerald-600' : 'text-loga-red')}>
                            ({margen >= 0 ? '+' : ''}{margen.toFixed(2)})
                          </span>
                        )}
                      </p>
                    );
                  })()}
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
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <EstadoBadge estado={p.estado} />
                    {p.porte_agencia && <AgenciaBadge agencia={p.porte_agencia} pesoKg={p.porte_peso_kg} />}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {isAdmin && p.estado === 'confirmado' && (() => {
                      const accion = getAccionPedido(p);
                      const prodId = p.producto_id ?? p.lineas?.[0]?.producto_id;
                      const prod = productos.find(pr => pr.id === prodId);
                      const esEnvasado = prod?.tipo === 'producto_envasado';
                      return (
                        <>
                          {accion === 'consumir' && (
                            <button onClick={() => abrirConsumir(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1">
                              <Check size={11} /> Consumir
                            </button>
                          )}
                          {accion !== 'consumir' && esEnvasado && (
                            <button onClick={() => fabricar(p)} className="rounded-lg px-2 py-1 text-[11px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors flex items-center gap-1">
                              <ClipboardList size={11} /> Envasar
                            </button>
                          )}
                          {accion !== 'consumir' && !esEnvasado && (
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
                      <button onClick={() => setConfirmCancel(p)}
                        title="Cancelar pedido"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors">
                        <X size={13} />
                      </button>
                    )}
                    {isAdmin && p.estado === 'completado' && (
                      <button onClick={() => setConfirmCancel(p)}
                        title="Borrar pedido y devolver stock a los lotes"
                        className="rounded-lg p-1.5 text-loga-red hover:bg-red-100 bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
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
      <Modal
        open={modalOpen}
        onClose={() => {
          const hayCambios = !!form.cliente_id || !!form.cliente_nombre.trim() ||
            lineas.some(l => l.producto_id || l.cantidad) || portes !== '0';
          if (hayCambios && !editando && !window.confirm('Tienes cambios sin guardar. ¿Cerrar de todas formas?')) return;
          setModalOpen(false); setEditando(null);
        }}
        maxWidth="max-w-5xl"
        title={editando ? `Editar ${editando.numero_pedido}` : 'Nuevo pedido'}
        subtitle={editando ? 'Modifica los datos del pedido' : 'Cliente → productos → envío'}>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* Stepper visual — full width */}
          <div className="xl:col-span-3">
          {(() => {
            const cliOK = !!form.cliente_id || !!form.cliente_nombre.trim();
            const prodOK = lineas.some(l => l.producto_id && parseFloat(l.cantidad || '0') > 0);
            const cli = form.cliente_id ? clientes.find(c => c.id === form.cliente_id) : null;
            const envioOK = !!cli?.codigo_postal;
            const pasos = [
              { num: 1, label: 'Cliente', ok: cliOK },
              { num: 2, label: 'Productos', ok: prodOK },
              { num: 3, label: 'Envío', ok: envioOK, opcional: true },
            ];
            return (
              <div className="flex items-center gap-1.5 sm:gap-3 -mt-1">
                {pasos.map((p, i) => (
                  <div key={p.num} className="flex items-center gap-1.5 sm:gap-3 flex-1">
                    <div className={clsx(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg flex-1 transition-colors',
                      p.ok ? 'bg-emerald-50 text-emerald-800' :
                      p.opcional ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'
                    )}>
                      <span className={clsx(
                        'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0',
                        p.ok ? 'bg-emerald-600 text-white' :
                        p.opcional ? 'bg-amber-500 text-white' : 'bg-gray-300 text-white'
                      )}>
                        {p.ok ? '✓' : p.num}
                      </span>
                      <span className="text-xs font-semibold truncate">
                        {p.label}{p.opcional && !p.ok && ' (recomendado)'}
                      </span>
                    </div>
                    {i < pasos.length - 1 && (
                      <div className={clsx('h-0.5 w-3 sm:w-6 shrink-0', p.ok ? 'bg-emerald-300' : 'bg-gray-200')} />
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          </div>

          {/* Cliente — sidebar derecha en xl */}
          <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-4 space-y-3 xl:col-start-3 xl:row-start-2 xl:self-start">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cliente</p>
            <SearchSelect
              options={clientes.map(c => ({
                id: c.id,
                label: c.nombre,
                sub: [c.nif, c.email].filter(Boolean).join(' · ') || undefined,
                right: c.nivel ? c.nivel.toUpperCase() : undefined,
                group: c.nivel === 'oro' ? 'Oro' : c.nivel === 'plata' ? 'Plata' : c.nivel === 'bronce' ? 'Bronce' : 'Sin nivel',
              }))}
              value={form.cliente_id}
              onChange={id => setForm(f => ({ ...f, cliente_id: id, cliente_nombre: '' }))}
              placeholder={`Escribe para buscar entre ${clientes.length} clientes…`}
              selectedLabel={clientes.find(c => c.id === form.cliente_id)?.nombre}
              selectedSub={(() => {
                const c = clientes.find(x => x.id === form.cliente_id);
                if (!c) return undefined;
                return [c.nif, c.email].filter(Boolean).join(' · ') || undefined;
              })()}
              selectedRight={clientes.find(c => c.id === form.cliente_id)?.nivel?.toUpperCase()}
            />
            {!form.cliente_id && (
              <Input value={form.cliente_nombre} onChange={e => setForm(f => ({ ...f, cliente_nombre: e.target.value }))} placeholder="O escribir nombre del cliente nuevo..." />
            )}
            {!form.cliente_id && (
              <button
                type="button"
                onClick={() => setBuscarArchivadosOpen(true)}
                className="text-[10px] text-gray-500 hover:text-indigo-700 underline decoration-dotted self-start"
              >
                ¿No aparece? Buscar en archivados
              </button>
            )}
            {(() => {
              if (!form.cliente_id) return null;
              const cli = clientes.find(c => c.id === form.cliente_id);
              if (!cli) return null;
              const prov = cpAProvincia(cli.codigo_postal);
              const zona = cpAZona(cli.codigo_postal);
              if (!cli.codigo_postal) {
                return (
                  <div className="flex items-center gap-1.5 text-[11px] bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                    <span className="text-amber-700 font-medium shrink-0">Sin CP:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      value={cpInline}
                      onChange={e => setCpInline(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      placeholder="28001"
                      className="w-16 rounded border border-amber-300 px-1.5 py-0.5 text-[11px] font-mono outline-none focus:border-amber-500"
                    />
                    {cpInline.length === 5 && cpAProvincia(cpInline) && (
                      <span className="text-emerald-700 font-semibold text-[10px]">→ {cpAProvincia(cpInline)}</span>
                    )}
                    <button
                      type="button"
                      disabled={cpSaving || !/^\d{5}$/.test(cpInline)}
                      onClick={guardarCpInline}
                      className="ml-auto rounded bg-amber-600 text-white px-2 py-0.5 text-[10px] font-bold hover:bg-amber-700 disabled:bg-gray-300 transition-colors"
                    >
                      {cpSaving ? '…' : 'Guardar'}
                    </button>
                  </div>
                );
              }
              return (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-mono text-gray-600">{cli.codigo_postal}</span>
                  {prov && (
                    <span className="rounded-md bg-indigo-100 text-indigo-700 px-2 py-0.5 font-bold">{prov}</span>
                  )}
                  {zona && (
                    <span className="rounded-md bg-gray-100 text-gray-600 px-2 py-0.5 font-medium">{ZONA_LABEL[zona]}</span>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Lineas del pedido — columna izquierda ancha, alto completo */}
          <div ref={productosRef} className="rounded-xl border border-loga-red/20 bg-red-50/20 p-4 space-y-3 xl:col-span-2 xl:col-start-1 xl:row-start-2 xl:row-span-2 scroll-mt-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-loga-red uppercase tracking-wider">Productos del pedido</p>
              <button type="button" onClick={() => setLineas(l => [...l, emptyLinea()])}
                className="flex items-center gap-1 rounded-md bg-loga-red/10 px-2 py-1 text-[11px] font-semibold text-loga-red hover:bg-loga-red/20 transition-colors">
                <Plus size={11} /> Añadir producto
              </button>
            </div>

            {/* Atajos: productos frecuentes del cliente */}
            {form.cliente_id && Object.keys(preciosCliente).length > 0 && (() => {
              const idsUsados = new Set(lineas.map(l => l.producto_id).filter(Boolean));
              const top = Object.entries(preciosCliente)
                .sort((a, b) => (b[1].num_usos ?? 0) - (a[1].num_usos ?? 0))
                .filter(([pid]) => !idsUsados.has(pid))
                .slice(0, 6);
              if (top.length === 0) return null;
              return (
                <div className="rounded-lg bg-white/80 border border-loga-red/10 p-2 space-y-1.5">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Productos frecuentes del cliente</p>
                  <div className="flex flex-wrap gap-1.5">
                    {top.map(([pid, hist]) => {
                      const prod = productos.find(p => p.id === pid);
                      if (!prod) return null;
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={() => {
                            const vacia = lineas.findIndex(l => !l.producto_id && !l.cantidad);
                            const nueva: LineaForm = {
                              ...emptyLinea(),
                              producto_id: pid,
                              precio_unitario: hist.precio_unitario,
                              unidad_medida: prod.unidad_medida ?? 'kg',
                            };
                            if (vacia >= 0) {
                              const nl = [...lineas]; nl[vacia] = nueva; setLineas(nl);
                            } else {
                              setLineas(l => [...l, nueva]);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-full bg-loga-red/10 hover:bg-loga-red/20 px-2.5 py-1 text-[11px] font-medium text-loga-red transition-colors"
                          title={`${hist.num_usos ?? 0} usos · último: ${hist.ultimo_uso_at ? new Date(hist.ultimo_uso_at).toLocaleDateString('es-ES') : '—'}`}
                        >
                          <Plus size={10} />
                          {prod.nombre.length > 35 ? prod.nombre.slice(0, 33) + '…' : prod.nombre}
                          <span className="text-[9px] text-loga-red/70 font-mono">×{hist.num_usos ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <AnimatePresence initial={false}>
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
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
                  className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5 shadow-sm"
                >
                  {/* Buscador de producto · agrupado por tipo + origen */}
                  <div className="relative">
                    <p className="text-[10px] text-gray-400 font-medium mb-1">Producto</p>
                    {linea.producto_id && prod ? (
                      <div className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <span className={clsx('rounded px-1.5 py-0.5 text-[9px] font-bold',
                          prod.tipo === 'producto_fabricado' ? 'bg-loga-red/10 text-loga-red' : 'bg-emerald-100 text-emerald-700'
                        )}>
                          {prod.tipo === 'producto_fabricado' ? 'Producto fabricado' : 'Producto envasado'}
                        </span>
                        {prod.subcategoria_pf && (
                          <span className={clsx('rounded px-1.5 py-0.5 text-[9px] font-bold',
                            prod.subcategoria_pf === 'propia' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                          )}>
                            {prod.subcategoria_pf === 'propia' ? 'Propia' : 'Terceros'}
                          </span>
                        )}
                        <span className="font-semibold text-sm text-gray-900 flex-1">{prod.nombre}</span>
                        <span className="text-[10px] text-gray-400 font-mono">{parseFloat(prod.stock_actual).toFixed(0)} {prod.unidad_medida}</span>
                        <button onClick={() => { const nl = [...lineas]; nl[idx]._search = ''; nl[idx] = { ...nl[idx], producto_id: '' }; setLineas(nl); }}
                          className="text-gray-400 hover:text-loga-red"><X size={14} /></button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
                          <Input
                            value={linea._search ?? ''}
                            onChange={e => { const nl = [...lineas]; nl[idx]._search = e.target.value; nl[idx] = { ...nl[idx], producto_id: '' }; setLineas(nl); setDropdownOpen(idx); }}
                            onFocus={() => setDropdownOpen(idx)}
                            onBlur={() => setTimeout(() => setDropdownOpen(null), 200)}
                            placeholder="Escribe nombre, código o tipo de producto…"
                            className="pl-8"
                            autoComplete="off"
                          />
                        </div>
                        {dropdownOpen === idx && (() => {
                          const q = (linea._search ?? '').trim().toLowerCase();
                          const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
                          const match = (p: Producto) =>
                            !q || norm(p.nombre).includes(norm(q)) || norm(p.codigo).includes(norm(q));
                          const vendibles = productos.filter(p => p.activo && p.tipo !== 'materia_prima' && p.tipo !== 'material_embalaje');
                          const filtered = vendibles.filter(match);

                          // 4 grupos visibles + 1 "sin clasificar"
                          const grupos: Array<{
                            key: string;
                            titulo: string;
                            subtitulo: string;
                            color: string;          // bg pastel del header
                            colorTxt: string;       // texto header + dot
                            dot: string;            // bg del dot lateral
                            unidadFmt: (p: Producto) => string;
                            items: Producto[];
                          }> = [
                            {
                              key: 'granel_propia',
                              titulo: 'Producto fabricado · Propio',
                              subtitulo: 'colas a granel (kg) fabricadas en planta',
                              color: 'bg-red-50 border-red-100',
                              colorTxt: 'text-loga-red',
                              dot: 'bg-loga-red',
                              unidadFmt: p => `${parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${p.unidad_medida ?? 'kg'}`,
                              items: filtered.filter(p => p.tipo === 'producto_fabricado' && p.subcategoria_pf === 'propia'),
                            },
                            {
                              key: 'granel_terceros',
                              titulo: 'Producto fabricado · Terceros',
                              subtitulo: 'colas a granel compradas a otros',
                              color: 'bg-orange-50 border-orange-100',
                              colorTxt: 'text-orange-700',
                              dot: 'bg-orange-500',
                              unidadFmt: p => `${parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${p.unidad_medida ?? 'kg'}`,
                              items: filtered.filter(p => p.tipo === 'producto_fabricado' && p.subcategoria_pf === 'terceros'),
                            },
                            {
                              key: 'envasado_propia',
                              titulo: 'Producto envasado · Propio',
                              subtitulo: 'botes, garrafas, frascos envasados en planta',
                              color: 'bg-emerald-50 border-emerald-100',
                              colorTxt: 'text-emerald-700',
                              dot: 'bg-emerald-500',
                              unidadFmt: p => `${parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 0 })} ud`,
                              items: filtered.filter(p => p.tipo === 'producto_envasado' && p.subcategoria_pf === 'propia'),
                            },
                            {
                              key: 'envasado_terceros',
                              titulo: 'Producto envasado · Terceros',
                              subtitulo: 'envasados ya comprados de reventa',
                              color: 'bg-amber-50 border-amber-100',
                              colorTxt: 'text-amber-700',
                              dot: 'bg-amber-500',
                              unidadFmt: p => `${parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 0 })} ud`,
                              items: filtered.filter(p => p.tipo === 'producto_envasado' && p.subcategoria_pf === 'terceros'),
                            },
                            {
                              key: 'sin_clasificar',
                              titulo: 'Sin clasificar',
                              subtitulo: 'asigna su origen en la ficha del producto',
                              color: 'bg-gray-50 border-gray-200',
                              colorTxt: 'text-gray-600',
                              dot: 'bg-gray-400',
                              unidadFmt: p => `${parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${p.tipo === 'producto_envasado' ? 'ud' : (p.unidad_medida ?? 'kg')}`,
                              items: filtered.filter(p =>
                                (p.tipo === 'producto_fabricado' || p.tipo === 'producto_envasado') &&
                                p.subcategoria_pf !== 'propia' && p.subcategoria_pf !== 'terceros'
                              ),
                            },
                          ];

                          const selectProd = (p: Producto) => {
                            const nl = [...lineas];
                            const { precio } = getPrecioSugerido(p.id);
                            nl[idx] = { ...nl[idx], producto_id: p.id, unidad_medida: p.tipo === 'producto_envasado' ? 'ud' : (p.unidad_medida ?? 'kg'), precio_unitario: precio, presentacion: 'ud' };
                            delete nl[idx]._search;
                            setLineas(nl);
                          };

                          // Crear producto envasado al vuelo desde el buscador.
                          // Útil cuando el cliente pide un producto nuevo que aún no está dado de alta.
                          const crearEnvasadoYSeleccionar = async () => {
                            const nombre = q.trim();
                            if (!nombre) return;
                            try {
                              const r = await productosApi.crear({
                                nombre,
                                tipo: 'producto_envasado',
                                unidad_medida: 'ud',
                              });
                              const nuevo = r.data as Producto;
                              setProductos(prev => [...prev, nuevo]);
                              selectProd(nuevo);
                              setDropdownOpen(null);
                              notify.success(`Producto "${nombre}" creado como envasado`);
                            } catch (e) {
                              const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
                              notify.error(msg ?? 'No se pudo crear el producto');
                            }
                          };

                          if (filtered.length === 0) {
                            return (
                              <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl p-3 space-y-2">
                                <p className="text-xs text-gray-400 text-center">
                                  {q ? `Sin resultados para "${q}"` : 'No hay productos vendibles activos'}
                                </p>
                                {q && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={crearEnvasadoYSeleccionar}
                                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors"
                                  >
                                    <Plus size={13} />
                                    Crear "{q}" como producto envasado
                                  </button>
                                )}
                              </div>
                            );
                          }

                          return (
                            <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-80 overflow-y-auto">
                              {q && (
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={crearEnvasadoYSeleccionar}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 border-b border-gray-100 transition-colors"
                                >
                                  <Plus size={13} />
                                  Crear "{q}" como producto envasado
                                </button>
                              )}
                              {grupos.filter(g => g.items.length > 0).map(g => (
                                <div key={g.key}>
                                  <div className={clsx('sticky top-0 px-3 py-1.5 border-b z-10', g.color)}>
                                    <p className={clsx('text-[10px] font-bold uppercase tracking-wider', g.colorTxt)}>
                                      {g.titulo}
                                      <span className="ml-1.5 text-[9px] font-mono opacity-60">({g.items.length})</span>
                                    </p>
                                    <p className="text-[9px] text-gray-400 normal-case font-medium">{g.subtitulo}</p>
                                  </div>
                                  {g.items.map(p => {
                                    const stock = parseFloat(p.stock_actual);
                                    return (
                                      <button
                                        key={p.id}
                                        onClick={() => selectProd(p)}
                                        className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2.5 text-xs transition-colors border-b border-gray-50 last:border-b-0"
                                      >
                                        <span className={clsx('w-2 h-2 rounded-full shrink-0', g.dot)} />
                                        <div className="flex-1 min-w-0">
                                          <p className="font-semibold text-gray-900 truncate">{p.nombre}</p>
                                          <p className="text-[9px] text-gray-400 font-mono">{p.codigo}</p>
                                        </div>
                                        <span className={clsx(
                                          'font-mono text-[10px] tabular-nums shrink-0 px-1.5 py-0.5 rounded',
                                          stock > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-gray-400 bg-gray-50'
                                        )}>
                                          {g.unidadFmt(p)}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ))}
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
                                  value={linea._customMult ?? ''}
                                  onChange={e => { const nl = [...lineas]; nl[idx]._customMult = e.target.value; setLineas([...nl]); }}
                                  placeholder="Uds/caja"
                                  className="w-20 text-center"
                                />
                              )}
                            </div>
                          </div>
                        )}

                        {/* Cantidad · dual input cuando hay cajas compatibles vinculadas */}
                        {(() => {
                          const cajasComp = cajasParaLinea(linea);
                          const tieneVinc = prod?.tipo === 'producto_envasado' && cajasComp.length > 0;
                          if (!tieneVinc) {
                            return (
                              <div>
                                <p className="text-[10px] text-gray-400 font-medium mb-1">{mult > 1 ? 'Cajas' : 'Cantidad'}</p>
                                <Input type="number" min="1" step="1" value={linea.cantidad} onChange={e => {
                                  const nl = [...lineas]; nl[idx] = { ...nl[idx], cantidad: e.target.value }; setLineas(nl);
                                }} placeholder="0" className="text-center font-bold text-lg" />
                              </div>
                            );
                          }
                          const cajaSel = cajasComp.find(c => c.id === linea.caja_id) ?? cajasComp[0];
                          const M = Number(cajaSel?.botes_por_caja ?? cajaSel?.unidades_por_envase ?? 0) || 0;
                          const total = Number(linea.cantidad || 0);
                          // SIEMPRE computamos desglose desde total+M (no leemos stored values).
                          // Esto garantiza que ver = realidad incluso en pedidos viejos sin desglose.
                          const cajasAuto = M > 0 ? Math.floor(total / M) : 0;
                          const sueltosAuto = M > 0 ? total - cajasAuto * M : total;
                          // Reparte un total dado entre cajas/sueltos según M.
                          // Cuando cambia caja (cambia M), recalcula sobre el MISMO total.
                          const repartir = (t: number, m: number) => {
                            if (m <= 0) return { cajas: 0, sueltos: t };
                            const cajas = Math.floor(t / m);
                            const sueltos = t - cajas * m;
                            return { cajas, sueltos };
                          };
                          const setLinea = (patch: Partial<LineaForm>) => {
                            const nl = [...lineas];
                            nl[idx] = { ...nl[idx], ...patch };
                            setLineas(nl);
                          };
                          const onTotal = (valor: string) => {
                            const t = Math.max(0, Math.floor(Number(valor) || 0));
                            const { cajas, sueltos } = repartir(t, M);
                            setLinea({
                              cantidad: String(t),
                              cantidad_cajas: String(cajas),
                              cantidad_botes_sueltos: String(sueltos),
                            });
                          };
                          const onCaja = (nuevoCajaId: string) => {
                            const nueva = cajasComp.find(c => c.id === nuevoCajaId);
                            const mNuevo = Number(nueva?.botes_por_caja ?? nueva?.unidades_por_envase ?? 0) || 0;
                            const { cajas, sueltos } = repartir(total, mNuevo);
                            setLinea({
                              caja_id: nuevoCajaId,
                              cantidad_cajas: String(cajas),
                              cantidad_botes_sueltos: String(sueltos),
                            });
                          };
                          // Si la línea aún no tiene caja_id y solo hay 1 caja, autoseleccionarla
                          const cajaIdEfectivo = linea.caja_id || cajasComp[0]?.id || '';
                          const sinM = M <= 0; // la caja existe pero sin botes_por_caja configurado
                          return (
                            <div className="col-span-2 rounded-lg border-2 border-indigo-300 bg-indigo-50/60 p-2 space-y-2">
                              {/* Caja a usar (1 o varias) */}
                              {cajasComp.length > 1 ? (
                                <div>
                                  <p className="text-[10px] text-indigo-900 font-bold mb-0.5">📦 Caja a usar</p>
                                  <Select value={cajaIdEfectivo} onChange={e => onCaja(e.target.value)}>
                                    {cajasComp.map(c => {
                                      const mc = Number(c.botes_por_caja ?? c.unidades_por_envase ?? 0) || 0;
                                      return (
                                        <option key={c.id} value={c.id}>
                                          {c.nombre} {mc > 0 ? `— ${mc} botes/caja` : '— (sin botes/caja configurado)'}
                                        </option>
                                      );
                                    })}
                                  </Select>
                                </div>
                              ) : (
                                <p className="text-[10px] text-indigo-900 bg-white border border-indigo-200 rounded px-2 py-1">
                                  📦 <b>{cajaSel?.nombre ?? '?'}</b> · <span className="text-indigo-700">{M > 0 ? `${M} botes/caja` : '⚠ sin botes/caja'}</span>
                                </p>
                              )}
                              {sinM && (
                                <div className="rounded border-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900">
                                  ⚠ La caja <b>{cajaSel?.nombre}</b> no tiene <b>"Botes dentro de 1 caja"</b> configurado.
                                  Edítala en Productos (ficha de la caja → bloque embalaje → "Botes dentro de 1 caja"). Sin esto no podemos repartir botes en cajas.
                                </div>
                              )}
                              {/* Total botes input */}
                              <div>
                                <p className="text-[10px] text-gray-600 font-bold mb-0.5">Total botes</p>
                                <Input type="number" min="0" step="1" value={total > 0 ? String(total) : ''}
                                  onChange={e => onTotal(e.target.value)}
                                  placeholder="Pon cuántos botes"
                                  className="text-center font-bold text-base" />
                              </div>
                              {/* Desglose abajo (siempre que haya M) */}
                              {!sinM && (
                                <div className="flex items-center justify-center gap-1.5 bg-white rounded border border-indigo-200 px-2 py-1.5 text-[11px] font-mono">
                                  {total > 0 ? (
                                    <>
                                      <span><b className="text-indigo-700 text-sm">{cajasAuto}</b> caja{cajasAuto !== 1 ? 's' : ''}</span>
                                      <span className="text-gray-300">+</span>
                                      <span><b className="text-indigo-700 text-sm">{sueltosAuto}</b> suelto{sueltosAuto !== 1 ? 's' : ''}</span>
                                      <span className="text-gray-300">=</span>
                                      <span className="text-gray-700 font-semibold">{total} botes</span>
                                    </>
                                  ) : (
                                    <span className="text-gray-400 italic">→ pon total botes y verás cuántas cajas</span>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Precio · auto-rellenado con histórico del cliente */}
                        {isAdmin && (
                          <div>
                            <p className="text-[10px] text-gray-400 font-medium mb-1 flex items-center gap-1">
                              {prod?.tipo === 'producto_envasado' ? 'Precio/bote' : 'Precio/ud'}
                              {linea.producto_id && form.cliente_id && (() => {
                                const sug = getPrecioSugerido(linea.producto_id);
                                if (!sug.historico) return null;
                                const precioActual = parseFloat(linea.precio_unitario || '0');
                                const precioHist = parseFloat(sug.historico.precio_unitario);
                                const igual = Math.abs(precioActual - precioHist) < 0.001;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const nl = [...lineas];
                                      nl[idx] = { ...nl[idx], precio_unitario: sug.historico!.precio_unitario };
                                      setLineas(nl);
                                    }}
                                    title={`Última venta a este cliente: ${precioHist.toFixed(2)} €/ud (${sug.historico.num_usos} pedido${sug.historico.num_usos !== 1 ? 's' : ''})`}
                                    className={clsx(
                                      'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold transition-colors',
                                      igual
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                    )}
                                  >
                                    {igual ? '✓ histórico' : `↺ ${precioHist.toFixed(2)} €`}
                                  </button>
                                );
                              })()}
                            </p>
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
                      {/* Indicador de stock por línea (verde/amarillo/rojo) */}
                      {cant > 0 && linea.producto_id && (() => {
                        const prodLn = productos.find(pp => pp.id === linea.producto_id);
                        if (!prodLn) return null;
                        const stockProd = parseFloat(prodLn.stock_actual || '0');
                        const necesario = totalUds;
                        let bg = 'bg-emerald-50 border-emerald-200 text-emerald-700';
                        let icon = '✓';
                        let texto = `Stock suficiente — ${stockProd.toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${prodLn.unidad_medida ?? 'ud'} disponibles`;
                        if (stockProd < necesario) {
                          bg = 'bg-red-50 border-red-200 text-loga-red';
                          icon = '⚠';
                          texto = `Falta stock — necesitas ${necesario.toLocaleString('es-ES')} y solo hay ${stockProd.toLocaleString('es-ES', { maximumFractionDigits: 0 })} ${prodLn.unidad_medida ?? 'ud'}`;
                        } else if (necesario > stockProd * 0.7) {
                          bg = 'bg-amber-50 border-amber-200 text-amber-700';
                          icon = '!';
                          texto = `Stock justo — pides ${Math.round((necesario / stockProd) * 100)}% del disponible`;
                        }
                        return (
                          <div className={clsx('rounded-md border px-2 py-1 text-[10px] font-medium flex items-center gap-1.5', bg)}>
                            <span className="font-bold text-sm leading-none">{icon}</span>
                            <span>{texto}</span>
                          </div>
                        );
                      })()}
                      {/* Desglose de peso bruto */}
                      {cant > 0 && (() => {
                        const p = getPesoLinea(linea);
                        if (!p || p.pesoTotal <= 0) return null;
                        const fmt = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
                        return (
                          <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2 text-[10px] space-y-1">
                            <div className="flex items-center justify-between font-bold text-indigo-700">
                              <span>Peso bruto estimado</span>
                              <span className="font-mono text-sm">{fmt(p.pesoTotal)} kg</span>
                            </div>
                            {p.tipo === 'envasado' && p.sinReceta && (
                              <p className="text-amber-700 italic">⚠ sin receta-envasado; usa peso_unitario_kg del producto</p>
                            )}
                            {p.tipo === 'envasado' && !p.sinReceta && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-gray-600 font-mono">
                                <span>líquido: <b className="text-gray-800">{fmt(p.desglose.liquido)}</b></span>
                                <span>envases ({p.uds}): <b className="text-gray-800">{fmt(p.desglose.envase)}</b></span>
                                <span>cajas ({p.cajas}): <b className="text-gray-800">{fmt(p.desglose.caja)}</b></span>
                                <span>palés ({p.pales}): <b className="text-gray-800">{fmt(p.desglose.pale)}</b></span>
                              </div>
                            )}
                            {p.tipo === 'granel' && (
                              <p className="text-gray-600 font-mono">{p.uds.toLocaleString('es-ES')} {p.unidad} → {fmt(p.pesoTotal)} kg</p>
                            )}
                          </div>
                        );
                      })()}
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
            </AnimatePresence>
            {/* Resumen porte: peso total + cajas + palés + extras */}
            {(() => {
              const totals = lineas.reduce((acc, l) => {
                const p = getPesoLinea(l);
                if (!p) return acc;
                acc.peso += p.pesoTotal;
                acc.liquido += p.desglose.liquido;
                acc.envase  += p.desglose.envase;
                acc.caja    += p.desglose.caja;
                acc.pale    += p.desglose.pale;
                acc.cajas   += p.cajas;
                acc.pales   += p.pales;
                acc.uds     += p.uds;
                return acc;
              }, { peso: 0, liquido: 0, envase: 0, caja: 0, pale: 0, cajas: 0, pales: 0, uds: 0 });
              // Suma peso de extras: cantidad × peso_material_vacio_kg (fallback peso_unitario_kg)
              let pesoExtras = 0;
              let udExtras = 0;
              for (const ex of embExtras) {
                const prod = productos.find(pp => pp.id === ex.producto_id);
                if (!prod) continue;
                const pesoUd = parseFloat((prod as any).peso_material_vacio_kg ?? '0')
                  || parseFloat(prod.peso_unitario_kg ?? '0') || 0;
                const cantNum = Number(ex.cantidad) || 0;
                pesoExtras += pesoUd * cantNum;
                udExtras   += cantNum;
              }
              totals.peso += pesoExtras;
              if (totals.peso <= 0) return null;
              const cli = form.cliente_id ? clientes.find(c => c.id === form.cliente_id) : null;
              const prov = cpAProvincia(cli?.codigo_postal);
              const zona = cpAZona(cli?.codigo_postal);
              const fmt = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
              return (
                <div className="border-t border-indigo-200 pt-2 mt-2 rounded-lg bg-indigo-50/40 border border-indigo-100 px-3 py-2 space-y-1 text-xs">
                  <div className="flex items-center justify-between font-bold text-indigo-800">
                    <span className="flex items-center gap-2">
                      Peso total · porte
                      {prov && <span className="rounded bg-indigo-200 text-indigo-800 px-1.5 py-0.5 text-[10px]">{prov}</span>}
                      {zona && <span className="rounded bg-gray-200 text-gray-700 px-1.5 py-0.5 text-[10px]">{ZONA_LABEL[zona]}</span>}
                    </span>
                    <span className="font-mono text-sm">{fmt(totals.peso)} kg</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-[10px] text-gray-700 font-mono">
                    <span>líquido: <b className="text-gray-900">{fmt(totals.liquido)} kg</b></span>
                    <span>envases: <b className="text-gray-900">{fmt(totals.envase)} kg</b></span>
                    <span>cajas ({totals.cajas}): <b className="text-gray-900">{fmt(totals.caja)} kg</b></span>
                    <span>palés ({totals.pales}): <b className="text-gray-900">{fmt(totals.pale)} kg</b></span>
                    {pesoExtras > 0 && (
                      <span className="col-span-2 sm:col-span-4 text-amber-700">
                        extras ({udExtras} ud): <b>{fmt(pesoExtras)} kg</b>
                      </span>
                    )}
                  </div>
                  {!cli?.codigo_postal && form.cliente_id && (
                    <p className="text-[10px] text-amber-700 italic">Añade el CP al cliente para identificar la provincia.</p>
                  )}
                  {isAdmin && prov && (
                    <PortesSelector
                      pesoSugeridoKg={totals.peso}
                      provincia={prov}
                      agenciaActual={porteAgencia}
                      pesoActual={portePesoKg}
                      onElegir={({ agencia, importe, pesoUsado }) => {
                        setPorteAgencia(agencia);
                        setPortePesoKg(pesoUsado);
                        setPortes(importe != null ? importe.toFixed(2) : '0');
                      }}
                    />
                  )}
                </div>
              );
            })()}
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

          <div ref={fechasRef} className="rounded-xl border border-gray-100 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 xl:col-span-3 xl:row-start-4 scroll-mt-2">
            <FormField label="Fecha entrega">
              <Input type="date" value={form.fecha_entrega} onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))} />
            </FormField>
            <FormField label="Notas">
              <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones..." />
            </FormField>
          </div>
          {/* Material embalaje EXTRA — no albarán ni factura, suma a coste interno */}
          {(
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2 xl:col-span-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-bold text-amber-900">Material de embalaje extra para el pedido</p>
                <span className="text-[10px] text-amber-700">Con precio &gt; 0 sale en albarán/factura · siempre cuenta en informe materiales</span>
              </div>
              {embExtras.length > 0 && (
                <ul className="space-y-1">
                  {embExtras.map(e => {
                    const cant = Number(e.cantidad);
                    const precio = Number(e.precio_unitario ?? 0);
                    const subtotal = cant * precio;
                    const enAlbaran = precio > 0;
                    return (
                      <li key={e.id} className="flex items-center gap-2 text-xs bg-white border border-amber-200 rounded px-2 py-1">
                        <span className="font-mono text-gray-500 shrink-0">{e.codigo}</span>
                        <span className="flex-1 text-gray-800 truncate">{e.nombre}</span>
                        <span className="font-mono shrink-0">{cant.toLocaleString('es-ES')} {e.unidad_medida ?? 'ud'}</span>
                        <span className="text-gray-300 shrink-0">·</span>
                        <span className="inline-flex items-center gap-0.5 shrink-0">
                          <input type="number" min="0" step="0.01"
                            value={precio || ''}
                            onChange={ev => {
                              const n = parseFloat(ev.target.value) || 0;
                              cambiarPrecioExtra(e.id, n);
                            }}
                            placeholder="0"
                            className="w-16 rounded border border-amber-300 px-1 py-0.5 text-[11px] font-mono text-right outline-none focus:border-amber-500" />
                          <span className="text-[10px] text-gray-500">€/ud</span>
                        </span>
                        {subtotal > 0 && (
                          <span className="font-bold text-emerald-700 tabular-nums shrink-0">= {subtotal.toFixed(2)} €</span>
                        )}
                        <span className={clsx('text-[9px] uppercase font-bold rounded px-1 py-0.5 shrink-0',
                          enAlbaran ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                        )}>{enAlbaran ? 'Albarán' : 'Interno'}</span>
                        <button onClick={() => delEmbExtra(e.id)} className="text-gray-400 hover:text-red-600 p-1 rounded shrink-0" title="Eliminar">
                          <X size={11} />
                        </button>
                      </li>
                    );
                  })}
                  {/* Subtotal extras facturables */}
                  {(() => {
                    const subTotalExtras = embExtras.reduce((s, e) => s + Number(e.cantidad) * Number(e.precio_unitario ?? 0), 0);
                    return subTotalExtras > 0 ? (
                      <li className="flex items-center justify-between text-[11px] font-bold text-emerald-800 px-2 py-1 border-t border-amber-200 mt-1">
                        <span>Subtotal extras facturables al cliente</span>
                        <span className="font-mono tabular-nums">{subTotalExtras.toFixed(2)} €</span>
                      </li>
                    ) : null;
                  })()}
                </ul>
              )}
              <div className="grid grid-cols-12 gap-1.5">
                <select value={embExtraDraft.producto_id}
                  onChange={e => {
                    const id = e.target.value;
                    const prod = materialesEmbalaje.find(p => p.id === id);
                    // Autocompletar precio con precio_venta del producto
                    const pv = prod ? parseFloat((prod as any).precio_venta ?? '0') || 0 : 0;
                    setEmbExtraDraft({ ...embExtraDraft, producto_id: id, precio_unitario: pv > 0 ? String(pv) : embExtraDraft.precio_unitario });
                  }}
                  className="col-span-4 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-amber-500">
                  <option value="">Material…</option>
                  {materialesEmbalaje.map(p => (
                    <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>
                  ))}
                </select>
                <input type="number" min="0" step="0.01" placeholder="Cantidad"
                  value={embExtraDraft.cantidad}
                  onChange={e => setEmbExtraDraft({ ...embExtraDraft, cantidad: e.target.value })}
                  className="col-span-2 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs text-right font-mono outline-none focus:border-amber-500" />
                <input type="number" min="0" step="0.01" placeholder="€/ud (0=interno)"
                  value={embExtraDraft.precio_unitario}
                  onChange={e => setEmbExtraDraft({ ...embExtraDraft, precio_unitario: e.target.value })}
                  className="col-span-2 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs text-right font-mono outline-none focus:border-amber-500" />
                <input type="text" placeholder="Notas (opcional)"
                  value={embExtraDraft.notas}
                  onChange={e => setEmbExtraDraft({ ...embExtraDraft, notas: e.target.value })}
                  className="col-span-3 rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-amber-500" />
                <button onClick={addEmbExtra} disabled={embExtraBusy || !embExtraDraft.producto_id || !embExtraDraft.cantidad}
                  className="col-span-1 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:bg-gray-300">
                  +
                </button>
              </div>
              {!editando && embExtras.length > 0 && (
                <p className="text-[10px] text-amber-700 italic">Se añadirán al crear el pedido.</p>
              )}
            </div>
          )}
          {/* Footer sticky: total grande + estado + acciones */}
          {(() => {
            const subtotalCalc = lineas.reduce((s, l) => {
              const cant = parseFloat(l.cantidad || '0') * getMultiplicador(l);
              return s + (cant * parseFloat(l.precio_unitario || '0'));
            }, 0);
            const portesNum = parseFloat(portes || '0');
            const ivaNum = (subtotalCalc + portesNum) * parseFloat(ivaPct || '0') / 100;
            const totalCalc = subtotalCalc + portesNum + ivaNum;

            const faltas: string[] = [];
            if (!form.cliente_id && !form.cliente_nombre.trim()) faltas.push('Cliente');
            const lineasValidas = lineas.filter(l => l.producto_id && l.cantidad);
            if (lineasValidas.length === 0) faltas.push('1 producto con cantidad');
            else lineas.forEach((l, i) => {
              if (l.producto_id && !l.cantidad) faltas.push(`Cantidad línea ${i + 1}`);
              if (!l.producto_id && l.cantidad) faltas.push(`Producto línea ${i + 1}`);
            });
            const puedeGuardar = faltas.length === 0 && !saving;

            return (
              <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-5 mt-3 border-t border-gray-200 bg-white shadow-[0_-4px_10px_-6px_rgba(0,0,0,0.08)] xl:col-span-3">
                <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    {faltas.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-amber-700 text-xs">
                        <span className="font-bold">Falta:</span>
                        <span className="truncate">{faltas.join(' · ')}</span>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Total</span>
                        <span className="text-xl font-bold text-gray-900 tabular-nums">{totalCalc.toFixed(2)} €</span>
                        <span className="text-[10px] text-gray-400">IVA incl.</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setModalOpen(false); setEditando(null); }}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                    Cancelar
                  </button>
                  <button onClick={handleGuardar} disabled={!puedeGuardar}
                    className={clsx(
                      'rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors',
                      puedeGuardar ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-gray-300 cursor-not-allowed'
                    )}>
                    {saving ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear pedido'}
                    <kbd className="ml-1.5 text-[9px] text-blue-100 font-mono">⌘↵</kbd>
                  </button>
                </div>
              </div>
            );
          })()}
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
            {detalleExtras.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-[11px] font-semibold text-amber-700 uppercase mb-2">Material embalaje extra</p>
                <p className="text-[10px] text-amber-600 mb-2 italic">Aparece en albarán/factura · consumido del stock · contado en informe materiales</p>
                <div className="space-y-1">
                  {detalleExtras.map(e => {
                    const cant = Number(e.cantidad);
                    const precio = Number(e.precio_unitario ?? 0);
                    const subtotal = cant * precio;
                    return (
                      <div key={e.id} className="flex justify-between text-xs gap-2">
                        <span className="font-mono text-gray-500 shrink-0">{e.codigo}</span>
                        <span className="flex-1 text-gray-800 truncate">{e.nombre}</span>
                        <span className="font-mono shrink-0">{cant.toLocaleString('es-ES')} {e.unidad_medida ?? 'ud'}</span>
                        {precio > 0 && (
                          <span className="font-mono text-gray-500 shrink-0">× {precio.toFixed(2)} €</span>
                        )}
                        {subtotal > 0 && (
                          <span className="font-bold text-emerald-700 tabular-nums shrink-0">= {subtotal.toFixed(2)} €</span>
                        )}
                        {e.notas && <span className="text-gray-500 italic max-w-[30%] truncate">· {e.notas}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Galería fotos del pedido empaquetado · click para descargar */}
            {detalleFotos.length > 0 && (() => {
              const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token') || '';
              return (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                  <p className="text-[11px] font-semibold text-indigo-700 uppercase mb-2">Fotos del pedido empaquetado</p>
                  <p className="text-[10px] text-indigo-600 mb-2 italic">Click en cualquier foto para descargarla.</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {detalleFotos.map(url => (
                      <button key={url} onClick={() => descargarFoto(url)}
                        title="Descargar foto"
                        className="group relative aspect-square rounded-lg overflow-hidden border-2 border-indigo-200 hover:border-indigo-500 transition-colors">
                        <img src={`${url}?token=${encodeURIComponent(token)}`}
                          alt="foto pedido" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <Download size={20} className="text-white opacity-0 group-hover:opacity-100 drop-shadow-lg" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
            {detalle.total && parseFloat(detalle.total) > 0 && (
              <div className={clsx('rounded-lg border border-green-100 bg-green-50/30 p-3 space-y-1 text-xs', !isAdmin && 'hidden')}>
                <p className="text-[11px] font-semibold text-green-700 uppercase mb-2">Totales</p>
                <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-medium tabular-nums">{parseFloat(detalle.subtotal ?? '0').toFixed(2)} EUR</span></div>
                {detalle.portes && parseFloat(detalle.portes) > 0 && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      Portes
                      <AgenciaBadge agencia={detalle.porte_agencia} pesoKg={detalle.porte_peso_kg} />
                    </span>
                    <span className="font-medium tabular-nums">{parseFloat(detalle.portes).toFixed(2)} EUR</span>
                  </div>
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
              <p className="text-xs text-gray-500">Se enviará el albarán PDF al email indicado.</p>
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
          {/* ── Acciones rápidas: descargar hoja preparación + galería fotos ── */}
          {consumirPedido && (() => {
            return (
              <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button onClick={async () => {
                    try {
                      const r = await pedidosApi.descargarPreparacion(consumirPedido.id);
                      const url = URL.createObjectURL(r.data as Blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `preparacion-${consumirPedido.numero_pedido}.pdf`;
                      document.body.appendChild(a); a.click(); document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    } catch { notify.error('No se pudo descargar'); }
                  }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 hover:bg-indigo-700">
                    <Download size={12} /> Descargar pedido (hoja preparación)
                  </button>
                  <FotosPedidoSection pedidoId={consumirPedido.id} numeroPedido={consumirPedido.numero_pedido ?? ''} />
                </div>
              </div>
            );
          })()}

          {/* ── Preparación: desglose por línea (botes, etiquetas, cajas, líquido) ── */}
          {consumirPedido?.lineas && consumirPedido.lineas.length > 0 && (
            <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 overflow-hidden">
              <div className="px-3 py-2 bg-indigo-100/60">
                <p className="text-[11px] font-bold text-indigo-800 uppercase tracking-wider">Preparación necesaria</p>
                <p className="text-[10px] text-indigo-700 mt-0.5">Lo que hay que sacar del almacén para este pedido.</p>
              </div>
              <div className="p-3 space-y-3">
                {consumirPedido.lineas.map((linea: any, i: number) => {
                  const prod = productos.find(p => p.id === linea.producto_id);
                  if (!prod) return null;
                  const cant = parseFloat(linea.cantidad ?? '0');
                  if (cant <= 0) return null;
                  if (prod.tipo !== 'producto_envasado') {
                    return (
                      <div key={i} className="rounded-lg border border-gray-200 bg-white p-2 text-xs">
                        <p className="font-semibold">{prod.nombre}</p>
                        <p className="text-gray-600 font-mono">{cant.toLocaleString('es-ES')} {linea.unidad_medida ?? prod.unidad_medida}</p>
                      </div>
                    );
                  }
                  const rec = recetasEnvasado.find(r => r.producto_envasado_id === prod.id);
                  if (!rec) {
                    return (
                      <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
                        <p className="font-semibold">{prod.nombre} · {cant.toLocaleString('es-ES')} ud</p>
                        <p className="text-amber-700 italic">⚠ Sin receta-envasado configurada · no podemos desglosar componentes.</p>
                      </div>
                    );
                  }
                  // ── Renderizado visual cajas+sueltos ───────────────────
                  const cajaId = (linea as any).caja_id;
                  const necCajas = Number((linea as any).cantidad_cajas ?? 0);
                  const necSueltos = Number((linea as any).cantidad_botes_sueltos ?? 0);
                  const cajaProd = cajaId ? productos.find(p => p.id === cajaId) : null;
                  const botesPorCaja = cajaProd ? Number((cajaProd as any).botes_por_caja ?? (cajaProd as any).unidades_por_envase ?? 0) : 0;
                  const stockCaja = cajaProd ? parseFloat(cajaProd.stock_actual ?? '0') : 0;
                  const okStockCaja = cajaProd ? stockCaja >= necCajas : true;
                  // Caja legacy desde receta (modelo viejo)
                  const cajaLegacyNombre = !cajaProd && rec.lleva_caja ? (rec as any).caja_nombre : null;
                  return (
                    <div key={i} className="rounded-xl border-2 border-indigo-200 bg-white shadow-sm overflow-hidden">
                      {/* Encabezado total botes */}
                      <div className="bg-indigo-50 px-3 py-2 border-b border-indigo-100">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-bold text-indigo-900 truncate">{prod.nombre}</p>
                          <p className="text-lg font-mono font-bold text-indigo-700 tabular-nums shrink-0">
                            {cant.toLocaleString('es-ES')} <span className="text-[10px] uppercase font-semibold">botes</span>
                          </p>
                        </div>
                      </div>

                      {/* Desglose visual (cajas + sueltos) */}
                      {cajaProd && (necCajas > 0 || necSueltos > 0) ? (
                        <div className="p-3 space-y-2">
                          <p className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Cómo se reparte</p>

                          {necCajas > 0 && (
                            <div className={clsx(
                              'rounded-lg border p-2.5 flex items-center gap-3',
                              okStockCaja ? 'border-loga-red/30 bg-loga-red/5' : 'border-red-400 bg-red-100'
                            )}>
                              {/* Icono minimalista de caja (Lucide Package) */}
                              <Package size={28} strokeWidth={1.5} className="text-loga-red shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-900">
                                  {necCajas} caja{necCajas !== 1 ? 's' : ''} completa{necCajas !== 1 ? 's' : ''}
                                </p>
                                <p className="text-[11px] text-gray-600 truncate">
                                  {cajaProd.nombre}
                                  {botesPorCaja > 0 && <span className="text-gray-400"> · {botesPorCaja} botes/caja</span>}
                                </p>
                                {!okStockCaja && (
                                  <p className="text-[10px] text-red-700 font-bold mt-0.5">⚠ Stock: {stockCaja.toFixed(0)} ud · faltan {(necCajas - stockCaja).toFixed(0)}</p>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                {okStockCaja
                                  ? <span className="text-emerald-600 font-bold text-lg">✓</span>
                                  : <span className="text-red-700 font-bold text-lg">⚠</span>}
                                {botesPorCaja > 0 && (
                                  <p className="text-[10px] text-gray-500 tabular-nums">= {necCajas * botesPorCaja} botes</p>
                                )}
                              </div>
                            </div>
                          )}

                          {necSueltos > 0 && (
                            <div className="rounded-lg border border-loga-red/30 bg-loga-red/5 p-2.5 flex items-center gap-3">
                              {/* Icono SVG inline · bote de cola estilizado */}
                              <svg width="24" height="32" viewBox="0 0 24 32" fill="none" strokeWidth="1.5" stroke="currentColor" className="text-loga-red shrink-0">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 2h6v3h-1v2c0 1.5 1 2 2 3 1.5 1.5 2 3 2 5v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V15c0-2 .5-3.5 2-5 1-1 2-1.5 2-3V5H9V2z"/>
                                <line x1="6" y1="14" x2="18" y2="14"/>
                              </svg>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-900">
                                  {necSueltos} bote{necSueltos !== 1 ? 's' : ''} suelto{necSueltos !== 1 ? 's' : ''}
                                </p>
                                <p className="text-[11px] text-gray-600">sin caja · entregar individual</p>
                              </div>
                              <p className="text-[10px] text-gray-500 tabular-nums shrink-0">= {necSueltos} botes</p>
                            </div>
                          )}

                          {/* Suma visual */}
                          {botesPorCaja > 0 && (
                            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-1.5 text-center">
                              <p className="text-[11px] text-gray-600 font-mono">
                                {necCajas > 0 && <span>{necCajas} × {botesPorCaja}</span>}
                                {necCajas > 0 && necSueltos > 0 && <span className="text-gray-400 mx-1">+</span>}
                                {necSueltos > 0 && <span>{necSueltos}</span>}
                                <span className="text-gray-400 mx-1.5">=</span>
                                <b className="text-indigo-700">{cant.toLocaleString('es-ES')} botes</b>
                              </p>
                            </div>
                          )}
                        </div>
                      ) : cajaLegacyNombre ? (
                        <div className="p-3">
                          <div className="rounded-lg border border-loga-red/30 bg-loga-red/5 p-2.5 flex items-center gap-3">
                            <Package size={28} strokeWidth={1.5} className="text-loga-red shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-900">{cant.toLocaleString('es-ES')} caja{cant !== 1 ? 's' : ''}</p>
                              <p className="text-[11px] text-gray-600 truncate">{cajaLegacyNombre}</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3">
                          <p className="text-[11px] text-gray-500 italic text-center">Sin caja vinculada — entregar como botes sueltos.</p>
                        </div>
                      )}

                      {/* Nota: botes ya envasados */}
                      <p className="text-[10px] text-gray-400 italic px-3 pb-2 border-t border-gray-100 pt-2">
                        💡 Los botes ya vienen llenos de cola con su frasco y etiqueta. Solo hay que empaquetar.
                      </p>
                    </div>
                  );
                })}
                {consumirExtras.length > 0 && (
                  <div className="rounded-xl border-2 border-loga-red/20 bg-white shadow-sm overflow-hidden">
                    <div className="bg-loga-red/5 px-3 py-2 border-b border-loga-red/10">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-loga-red">Material extra (preparar también)</p>
                    </div>
                    <div className="p-3 space-y-2">
                      {consumirExtras.map(e => {
                        const necesario = Number(e.cantidad);
                        const stock = parseFloat(String(e.stock_actual ?? 0));
                        const okStock = stock >= necesario;
                        const nombreL = e.nombre.toLowerCase();
                        // Icono según tipo del extra
                        const Icono = () => {
                          if (/palet|palé|pale|tarima/.test(nombreL)) {
                            // SVG palet: 3 horizontal planks
                            return (
                              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" strokeWidth="1.5" stroke="currentColor" className="text-loga-red shrink-0">
                                <rect x="3" y="6" width="26" height="3" rx="0.5"/>
                                <rect x="3" y="13" width="26" height="3" rx="0.5"/>
                                <rect x="3" y="20" width="26" height="3" rx="0.5"/>
                                <line x1="7" y1="6" x2="7" y2="26"/>
                                <line x1="16" y1="6" x2="16" y2="26"/>
                                <line x1="25" y1="6" x2="25" y2="26"/>
                              </svg>
                            );
                          }
                          if (/film|stretch|retract|envolver/.test(nombreL)) {
                            // SVG film stretch: rollo
                            return (
                              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" strokeWidth="1.5" stroke="currentColor" className="text-loga-red shrink-0">
                                <ellipse cx="16" cy="8" rx="10" ry="3"/>
                                <path d="M6 8v16c0 1.66 4.48 3 10 3s10-1.34 10-3V8"/>
                                <path d="M6 16c0 1.66 4.48 3 10 3s10-1.34 10-3"/>
                              </svg>
                            );
                          }
                          if (/etiqueta|sticker|pegatina/.test(nombreL)) {
                            // SVG etiqueta: tag
                            return (
                              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" strokeWidth="1.5" stroke="currentColor" className="text-loga-red shrink-0">
                                <path d="M5 5h14l8 8-14 14L5 19V5z"/>
                                <circle cx="11" cy="11" r="1.5"/>
                              </svg>
                            );
                          }
                          if (/saco|bolsa/.test(nombreL)) {
                            // SVG saco
                            return (
                              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" strokeWidth="1.5" stroke="currentColor" className="text-loga-red shrink-0">
                                <path d="M10 7l2-4h8l2 4M8 7h16l2 18a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3L8 7z"/>
                              </svg>
                            );
                          }
                          // default: Package de Lucide
                          return <Package size={28} strokeWidth={1.5} className="text-loga-red shrink-0" />;
                        };
                        return (
                          <div key={e.id} className={clsx(
                            'rounded-lg border p-2.5 flex items-center gap-3',
                            okStock ? 'border-loga-red/30 bg-loga-red/5' : 'border-red-400 bg-red-100'
                          )}>
                            <Icono />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-gray-900">
                                {necesario.toLocaleString('es-ES')} {e.unidad_medida ?? 'ud'} · {e.nombre}
                              </p>
                              <p className="text-[11px] text-gray-500">
                                <span className="font-mono text-gray-400">{e.codigo}</span>
                                {e.notas && <span className="italic"> · {e.notas}</span>}
                              </p>
                              {!okStock && (
                                <p className="text-[10px] text-red-700 font-bold mt-0.5">⚠ Stock: {stock.toFixed(0)} · faltan {(necesario - stock).toFixed(0)}</p>
                              )}
                            </div>
                            <div className="shrink-0">
                              {okStock
                                ? <span className="text-emerald-600 font-bold text-lg">✓</span>
                                : <span className="text-red-700 font-bold text-lg">⚠</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Aviso global si hay items sin stock para consumir */}
                {(() => {
                  const faltantes: string[] = [];
                  // Cajas faltantes por línea
                  for (const linea of (consumirPedido?.lineas ?? [])) {
                    const cajaId = (linea as any).caja_id;
                    const necCajas = Number((linea as any).cantidad_cajas ?? 0);
                    if (!cajaId || necCajas <= 0) continue;
                    const cajaProd = productos.find(p => p.id === cajaId);
                    if (!cajaProd) continue;
                    const stockCaja = parseFloat(cajaProd.stock_actual ?? '0');
                    if (stockCaja < necCajas) faltantes.push(`${cajaProd.nombre}: falta ${(necCajas - stockCaja).toFixed(0)} ud`);
                  }
                  // Extras faltantes
                  for (const e of consumirExtras) {
                    const necesario = Number(e.cantidad);
                    const stock = parseFloat(String(e.stock_actual ?? 0));
                    if (stock < necesario) faltantes.push(`${e.nombre} (extra): falta ${(necesario - stock).toFixed(0)} ${e.unidad_medida ?? 'ud'}`);
                  }
                  if (faltantes.length === 0) return null;
                  return (
                    <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3">
                      <p className="text-[11px] font-bold text-red-800 uppercase mb-1.5">⚠ NO se puede consumir aún · stock insuficiente:</p>
                      <ul className="text-[11px] space-y-0.5 font-mono text-red-700">
                        {faltantes.map((f, i) => <li key={i}>· {f}</li>)}
                      </ul>
                      <p className="text-[10px] text-red-600 mt-1.5 italic">Añade stock (Productos → ajuste manual o nuevo lote) y vuelve a abrir Consumir.</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

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
                          <p className="font-mono text-gray-700 flex items-center gap-1.5">
                            <TanqueBadge tanque={l.tanque} size="sm" />
                            {l.lote_interno}
                          </p>
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

      {/* Modal Buscar archivados */}
      <Modal
        open={buscarArchivadosOpen}
        onClose={() => { setBuscarArchivadosOpen(false); setArchivadosBusqueda(''); }}
        title="Buscar en clientes archivados"
        subtitle="Al seleccionar uno, se recupera automáticamente y queda activo"
      >
        <div className="space-y-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={archivadosBusqueda}
              onChange={e => setArchivadosBusqueda(e.target.value)}
              placeholder="Nombre, NIF o email…"
              className="pl-9"
              autoFocus
            />
          </div>
          {archivadosLoading && (
            <p className="text-xs text-gray-400 text-center py-4">Cargando archivados…</p>
          )}
          {!archivadosLoading && archivadosLista.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No hay clientes archivados</p>
          )}
          {!archivadosLoading && archivadosLista.length > 0 && (() => {
            const q = archivadosBusqueda.trim().toLowerCase();
            const matched = archivadosLista.filter(c =>
              !q ||
              c.nombre.toLowerCase().includes(q) ||
              (c.nif?.toLowerCase().includes(q)) ||
              (c.email?.toLowerCase().includes(q))
            );
            if (matched.length === 0) {
              return <p className="text-xs text-gray-400 text-center py-4">Sin coincidencias en archivados</p>;
            }
            return (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {matched.map(c => (
                  <button
                    key={c.id}
                    onClick={() => recuperarYSeleccionar(c)}
                    className="w-full text-left px-3 py-2.5 hover:bg-emerald-50 transition-colors flex items-center gap-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{c.nombre}</p>
                      <p className="text-[10px] text-gray-400 flex items-center gap-2 mt-0.5">
                        {c.nif && <span className="font-mono">{c.nif}</span>}
                        {c.email && <span>{c.email}</span>}
                        {c.archivado_at && (
                          <span className="text-amber-700">
                            Archivado {new Date(c.archivado_at).toLocaleDateString('es-ES')}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                      Recuperar →
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmCancel}
        title={confirmCancel?.estado === 'completado' ? 'Borrar pedido y devolver stock' : 'Cancelar pedido'}
        message={
          confirmCancel?.estado === 'completado'
            ? `Se cancelará el pedido ${confirmCancel?.numero_pedido} y se devolverán las cantidades consumidas a sus lotes originales. Esta acción queda auditada y no se puede deshacer.`
            : `Se cancelará el pedido ${confirmCancel?.numero_pedido}.`
        }
        confirmText={confirmCancel?.estado === 'completado' ? 'Borrar y revertir stock' : 'Cancelar pedido'}
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
