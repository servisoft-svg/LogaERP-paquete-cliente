import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus, Pencil, Trash2, Package, Search, Filter,
  ChevronUp, ChevronDown, AlertTriangle, PackagePlus, RefreshCw, Download, ScanLine, Mail, Factory, Upload, ClipboardList, Sparkles, CalendarClock,
  Layers, Beaker, Boxes,
} from 'lucide-react';
import { productosApi, proveedoresApi, lotesApi, specsApi, cambioApi, facturasApi, configuracionApi } from '../api/client';
import type { Producto, Proveedor, TipoProducto, SpecCatalogo, ProductoSpec } from '../types';
import { useAuth } from '../contexts/AuthContext';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import BarcodeScanner from '../components/BarcodeScanner';
import EmailModal from '../components/EmailModal';
import { FormField, Input, Select, Textarea } from '../components/FormField';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from '../components/ToastFields';

import clsx from 'clsx';

type FiltroTipoMeta = {
  value: TipoProducto | '';
  label: string;
  icon: typeof Layers;
  /** Tailwind color base (sin tonos). Se usa para clases dinámicas: bg-{color}-50, text-{color}-700… */
  color: 'red' | 'purple' | 'blue' | 'emerald' | 'amber';
};

const FILTROS_TIPO_META: FiltroTipoMeta[] = [
  { value: '',                     label: 'Todos',                icon: Layers,  color: 'red' },
  { value: 'materia_prima',        label: 'Materia prima',        icon: Beaker,  color: 'purple' },
  { value: 'producto_fabricado',   label: 'Productos fabricados', icon: Factory, color: 'blue' },
  { value: 'producto_envasado',    label: 'Envasado',             icon: Boxes,   color: 'emerald' },
  { value: 'material_embalaje',    label: 'Embalaje',             icon: Package, color: 'amber' },
];

const TIPOS_FORM: { value: TipoProducto; label: string }[] = [
  { value: 'materia_prima',        label: 'Materia Prima'       },
  { value: 'producto_fabricado',   label: 'Producto Fabricado'  },
  { value: 'producto_envasado',    label: 'Prod. Envasado'      },
  { value: 'material_embalaje',    label: 'Material Embalaje'   },
];

interface SubcategoriaMP { id: string; nombre: string; orden: number; activo: boolean }
interface SubcategoriaME { id: string; nombre: string; orden: number; activo: boolean }

// Clasifica una sub-categoría ME según su nombre para mostrar el campo correcto
// en el formulario. Heurística simple — el admin puede crear nuevas sub-categorías
// y siguen funcionando: si el nombre cae en alguna palabra clave se enrutará al
// campo adecuado; si no, se considera "consumible" (sin campo extra).
type RolEmbalaje = 'contenedor' | 'agrupador' | 'consumible';
const rolEmbalaje = (nombre?: string): RolEmbalaje => {
  const n = (nombre ?? '').toLowerCase();
  if (!n) return 'consumible';
  if (/bote|botella|garrafa|bidón|bidon|frasco|envase|tarro|lata/.test(n)) return 'contenedor';
  if (/caja|cartón|carton|paleta|palet|agrupador|estuche|bolsa.*master/.test(n)) return 'agrupador';
  return 'consumible';
};

const UNIDADES = ['kg', 'g', 'L', 'mL', 'ud', 'caja', 'saco', 't'];

interface FormData {
  codigo: string;
  nombre: string;
  numero_cas: string;
  descripcion: string;
  tipo: TipoProducto;
  unidad_medida: string;
  stock_actual: string;
  stock_minimo: string;
  stock_maximo: string;
  precio_unitario: string;
  precio_venta: string;
  proveedor_id: string;
  caducidad_meses: string;
  peso_unitario_kg: string;
  unidades_por_envase: string;
  // Specs físico-químicas (rangos aceptables — solo materia prima)
  solidos_min: string;
  solidos_max: string;
  ph_min: string;
  ph_max: string;
  viscosidad_min: string;
  viscosidad_max: string;
  // Sub-categoría + aditivo (sólo materia prima)
  subcategoria_mp: string;
  // Sub-categoría (sólo material embalaje)
  subcategoria_me: string;
  // Nombre comercial opcional (sólo productos fabricados/envasados)
  nombre_comercial: string;
  // Flag: producto compartido con Alilo (consumible vía API HMAC)
  compartido_alilo: boolean;
  codigo_alilo: string;
  // Sub-categoría PF: 'propia' o 'terceros' (solo producto_fabricado / producto_envasado)
  subcategoria_pf: '' | 'propia' | 'terceros';
  // Mensaje de confirmación opcional durante fabricación
  confirmacion_msg: string;
}

interface LoteDisponible { id: string; lote_interno: string; lote_proveedor?: string; cantidad_actual: string; cantidad_inicial?: string; fecha_caducidad?: string; }

const EMPTY: FormData = {
  codigo: '', nombre: '', numero_cas: '', descripcion: '', tipo: 'materia_prima',
  unidad_medida: 'kg', stock_actual: '0', stock_minimo: '0', stock_maximo: '0',
  precio_unitario: '0', precio_venta: '0', proveedor_id: '', caducidad_meses: '', peso_unitario_kg: '', unidades_por_envase: '',
  solidos_min: '', solidos_max: '', ph_min: '', ph_max: '', viscosidad_min: '', viscosidad_max: '',
  subcategoria_mp: '', subcategoria_me: '', nombre_comercial: '', compartido_alilo: false, codigo_alilo: '', subcategoria_pf: '', confirmacion_msg: '',
};

const EJEMPLO_IMPORTAR_PRODUCTOS = JSON.stringify({
  productos: [
    {
      nombre: "Acetato de Vinilo (VAM)",
      tipo: "materia_prima",
      unidad_medida: "kg",
      stock_minimo: 500,
      stock_maximo: 5000,
      precio_unitario: 5.60,
      precio_venta: 0,
      descripcion: "Monomero principal para adhesivos vinilicos",
    },
    {
      nombre: "Cola Blanca Premium",
      tipo: "producto_terminado",
      unidad_medida: "kg",
      stock_minimo: 100,
      stock_maximo: 1000,
      precio_unitario: 2.50,
      precio_venta: 8.00,
    },
    {
      nombre: "Garrafa 10L",
      tipo: "material_embalaje",
      unidad_medida: "ud",
      stock_minimo: 100,
      stock_maximo: 500,
      precio_unitario: 1.20,
    },
  ],
}, null, 2);

export default function Productos() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const stockCheckProducto = searchParams.get('check');
  const stockCheckCantidad = searchParams.get('cantidad');
  const stockCheckUnidad = searchParams.get('unidad');
  const stockCheckCliente = searchParams.get('cliente');

  const [productos, setProductos]     = useState<Producto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading]         = useState(true);
  const [busqueda, setBusqueda]       = useState('');
  const [filtroTipo, setFiltroTipo]   = useState<TipoProducto | ''>('');
  const [filtroBajoStock, setFiltroBajoStock] = useState(false);
  const [filtroSubcategoria, setFiltroSubcategoria] = useState<string>('');
  const [filtroSubcategoriaME, setFiltroSubcategoriaME] = useState<string>('');
  const [filtroSubcategoriaPF, setFiltroSubcategoriaPF] = useState<'' | 'propia' | 'terceros'>('');
  const [subcategoriasMP, setSubcategoriasMP] = useState<SubcategoriaMP[]>([]);
  const [subcategoriasME, setSubcategoriasME] = useState<SubcategoriaME[]>([]);
  const [modalOpen, setModalOpen]     = useState(false);
  const [editando, setEditando]       = useState<Producto | null>(null);
  const [form, setForm]               = useState<FormData>(EMPTY);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [sortField, setSortField]     = useState<keyof Producto>('nombre');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [expandedLotes, setExpandedLotes] = useState<{ lote_interno: string; lote_proveedor?: string; cantidad_inicial?: string; cantidad_actual: string; precio_compra?: string; fecha_caducidad?: string; fecha_entrada?: string; created_at?: string }[]>([]);
  const [expandedSpecs, setExpandedSpecs] = useState<ProductoSpec[]>([]);
  const [lotesProdMatch, setLotesProdMatch] = useState<Set<string>>(new Set());
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('asc');
  const [confirmElim, setConfirmElim] = useState<Producto | null>(null);
  const [scanning, setScanning]     = useState(false);
  const [emailProducto, setEmailProducto] = useState<Producto | null>(null);

  const [errorCarga, setErrorCarga] = useState('');

  // Modal importar JSON
  const [modalImportar, setModalImportar]         = useState(false);
  const [importJson, setImportJson]               = useState(EJEMPLO_IMPORTAR_PRODUCTOS);
  const [importResult, setImportResult]           = useState<string | null>(null);
  const [importing, setImporting]                 = useState(false);

  // Lotes disponibles en modal editar
  const [editLotes, setEditLotes]         = useState<LoteDisponible[]>([]);
  const [originalLotes, setOriginalLotes] = useState<LoteDisponible[]>([]);
  // editLoteId/loadingEditLotes — legacy del bloque "ajuste de stock" eliminado.
  // Mantenemos los setters por compatibilidad de los effects que aún los llaman.
  const [, setEditLoteId]       = useState('');
  const [, setLoadingEditLotes] = useState(false);
  // Info de coste calculado desde receta (para mostrar hint en form editar)
  const [costeReceta, setCosteReceta] = useState<{
    calculado: number | null;
    hasReceta: boolean;
    esManual: boolean;
  } | null>(null);
  const [resetAuto, setResetAuto] = useState(false);

  // Modal añadir stock + lote
  const [modalStock, setModalStock]         = useState(false);
  const [stockProducto, setStockProducto]   = useState<Producto | null>(null);
  const [stockCantidad, setStockCantidad]   = useState('');
  const [stockMotivo, setStockMotivo]       = useState('Entrada manual');
  const [stockLoteInterno, setStockLoteInterno]     = useState('');
  const [stockLoteProveedor, setStockLoteProveedor] = useState('');
  const [stockProveedorId, setStockProveedorId]     = useState('');
  const [stockCaducidad, setStockCaducidad]         = useState('');
  const [stockUbicacion, setStockUbicacion]         = useState('');
  const [stockPrecio, setStockPrecio]               = useState('');
  const [stockUnidadPrecio, setStockUnidadPrecio]   = useState('');
  // Divisa de entrada — guardamos en EUR pero permitimos pagar en otras y convertimos
  const [stockDivisa, setStockDivisa]               = useState<'EUR' | 'USD' | 'CNY' | 'GBP' | 'JPY' | 'CHF' | 'MXN' | 'BRL' | 'CAD' | 'AUD'>('EUR');
  const [stockTasaEur, setStockTasaEur]             = useState<number>(1); // 1 unidad divisa = X EUR
  const [stockTasaAuto, setStockTasaAuto]           = useState(true);      // si user no editó la tasa
  const [stockPorteDivisa, setStockPorteDivisa]     = useState<'EUR' | 'USD' | 'CNY' | 'GBP' | 'JPY' | 'CHF' | 'MXN' | 'BRL' | 'CAD' | 'AUD'>('EUR');
  const [stockPorteTasaEur, setStockPorteTasaEur]   = useState<number>(1);
  // Catálogo de specs + asignación al producto en edición + valores medidos del lote nuevo
  const [specCatalogo, setSpecCatalogo]             = useState<SpecCatalogo[]>([]);
  const [formSpecs, setFormSpecs]                   = useState<{ spec_id: number; nombre: string; unidad?: string | null; decimales: number; min_valor: string; max_valor: string; parametros?: Record<string, string> }[]>([]);
  const [stockProductoSpecs, setStockProductoSpecs] = useState<ProductoSpec[]>([]);
  const [stockSpecsValores, setStockSpecsValores]   = useState<Record<number, string>>({});
  const [stockPorte, setStockPorte]                 = useState('');
  const [stockSolidos, setStockSolidos]             = useState('');
  const [stockPh, setStockPh]                       = useState('');
  const [stockViscosidad, setStockViscosidad]       = useState('');
  const [savingStock, setSavingStock]       = useState(false);
  const [errorStock, setErrorStock]         = useState('');

  // ─── Subir factura → autorrellenar campos ──────────────────────────────
  const [facturaUrl, setFacturaUrl]                 = useState<string | null>(null);
  const [facturaMime, setFacturaMime]               = useState<string>('application/pdf');
  const [facturaParseando, setFacturaParseando]     = useState(false);
  const [facturaError, setFacturaError]             = useState('');
  // Mapa campo → nivel de confianza para badges visuales
  const [camposConfianza, setCamposConfianza]       = useState<Record<string, 'alta' | 'media' | 'baja' | 'calculada'>>({});
  const facturaInputRef = useRef<HTMLInputElement | null>(null);

  const expandedIdRef = useRef(expandedId);
  expandedIdRef.current = expandedId;

  const cargar = useCallback(async () => {
    try {
      const [prodRes, provRes] = await Promise.all([
        productosApi.listar({ activo: 'true' }),
        proveedoresApi.listar(),
      ]);
      setProductos(prodRes.data as Producto[]);
      setProveedores(provRes.data as Proveedor[]);
      setErrorCarga('');
      // Recargar lotes si hay producto expandido
      const eid = expandedIdRef.current;
      if (eid) {
        try {
          const res = await lotesApi.listar({ producto_id: eid, estado: 'aprobado' });
          setExpandedLotes(res.data as any[]);
        } catch { setExpandedLotes([]); }
      }
    } catch { setErrorCarga('Error al cargar productos. Comprueba la conexion.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Catálogo de specs (cargar una vez)
  useEffect(() => {
    specsApi.catalogo().then(({ data }) => setSpecCatalogo(data as SpecCatalogo[])).catch(() => {});
  }, []);

  // Sub-categorías MP (editables desde Configuración)
  useEffect(() => {
    configuracionApi.listarSubcategoriasMP()
      .then(({ data }) => setSubcategoriasMP(data as SubcategoriaMP[]))
      .catch(() => setSubcategoriasMP([]));
  }, []);

  // Sub-categorías ME (editables desde Configuración)
  useEffect(() => {
    configuracionApi.listarSubcategoriasME()
      .then(({ data }) => setSubcategoriasME(data as SubcategoriaME[]))
      .catch(() => setSubcategoriasME([]));
  }, []);

  // Tasa de cambio: cuando user elige divisa distinta de EUR, fetch tasa actual.
  // Si el user editó la tasa manualmente (stockTasaAuto=false), no la sobreescribimos.
  useEffect(() => {
    if (stockDivisa === 'EUR') { setStockTasaEur(1); setStockTasaAuto(true); return; }
    if (!stockTasaAuto) return;
    cambioApi.obtener(stockDivisa)
      .then(({ data }) => setStockTasaEur((data as { rate: number }).rate))
      .catch(() => {});
  }, [stockDivisa, stockTasaAuto]);

  useEffect(() => {
    if (stockPorteDivisa === 'EUR') { setStockPorteTasaEur(1); return; }
    cambioApi.obtener(stockPorteDivisa)
      .then(({ data }) => setStockPorteTasaEur((data as { rate: number }).rate))
      .catch(() => {});
  }, [stockPorteDivisa]);

  // Buscar también por lote_interno / lote_proveedor (albarán). Debounce 250ms.
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 2) { setLotesProdMatch(new Set()); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await lotesApi.listar({ busqueda: q });
        if (cancelled) return;
        const ids = new Set<string>();
        for (const l of res.data as { producto_id: string }[]) ids.add(l.producto_id);
        setLotesProdMatch(ids);
      } catch { if (!cancelled) setLotesProdMatch(new Set()); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [busqueda]);

  // Auto-expandir si búsqueda casa exactamente 1 producto vía lote (mostrar lote sin click)
  useEffect(() => {
    if (lotesProdMatch.size !== 1) return;
    const [pid] = Array.from(lotesProdMatch);
    if (expandedIdRef.current === pid) return;
    setExpandedId(pid);
    lotesApi.listar({ producto_id: pid, estado: 'aprobado' })
      .then(res => setExpandedLotes(res.data as any[]))
      .catch(() => setExpandedLotes([]));
  }, [lotesProdMatch]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm(EMPTY);
    setError('');
    setCosteReceta(null);
    setResetAuto(false);
    setFormSpecs([]);
    setModalOpen(true);
  };

  const abrirEditar = async (p: Producto) => {
    setEditando(p);
    const fmt2 = (v: string) => parseFloat(v || '0').toFixed(2);
    setForm({
      codigo:          p.codigo,
      nombre:          p.nombre,
      numero_cas:      (p as any).numero_cas ?? '',
      descripcion:     p.descripcion ?? '',
      tipo:            p.tipo,
      unidad_medida:   p.unidad_medida,
      stock_actual:    fmt2(p.stock_actual),
      stock_minimo:    fmt2(p.stock_minimo),
      stock_maximo:    fmt2(p.stock_maximo),
      precio_unitario: fmt2(p.precio_unitario),
      precio_venta:    fmt2(p.precio_venta ?? '0'),
      proveedor_id:    p.proveedor_id ?? '',
      caducidad_meses: p.caducidad_meses ? String(p.caducidad_meses) : '',
      peso_unitario_kg: p.peso_unitario_kg ? String(p.peso_unitario_kg) : '',
      unidades_por_envase: (p as any).unidades_por_envase ? String((p as any).unidades_por_envase) : '',
      solidos_min:    (p as any).solidos_min    != null ? String((p as any).solidos_min)    : '',
      solidos_max:    (p as any).solidos_max    != null ? String((p as any).solidos_max)    : '',
      ph_min:         (p as any).ph_min         != null ? String((p as any).ph_min)         : '',
      ph_max:         (p as any).ph_max         != null ? String((p as any).ph_max)         : '',
      viscosidad_min: (p as any).viscosidad_min != null ? String((p as any).viscosidad_min) : '',
      viscosidad_max: (p as any).viscosidad_max != null ? String((p as any).viscosidad_max) : '',
      subcategoria_mp: (p as any).subcategoria_mp ?? '',
      subcategoria_me: (p as any).subcategoria_me ?? '',
      nombre_comercial: (p as any).nombre_comercial ?? '',
      compartido_alilo: !!(p as any).compartido_alilo,
      codigo_alilo: (p as any).codigo_alilo ?? '',
      subcategoria_pf: ((p as any).subcategoria_pf as ('' | 'propia' | 'terceros')) ?? '',
      confirmacion_msg: (p as any).confirmacion_msg ?? '',
    });
    setEditLotes([]);
    setEditLoteId('');
    setError('');
    setResetAuto(false);
    setCosteReceta(null);
    setModalOpen(true);

    // Cargar specs asignadas al producto desde la nueva tabla producto_specs
    try {
      const { data } = await specsApi.productoSpecs(p.id);
      setFormSpecs(((data ?? []) as ProductoSpec[]).map((s) => ({
        spec_id: s.spec_id,
        nombre: s.nombre,
        unidad: s.unidad,
        decimales: s.decimales,
        min_valor: s.min_valor != null ? String(s.min_valor) : '',
        max_valor: s.max_valor != null ? String(s.max_valor) : '',
        parametros: s.parametros ? Object.fromEntries(Object.entries(s.parametros).map(([k, v]) => [k, v != null ? String(v) : ''])) : {},
      })));
    } catch { setFormSpecs([]); }

    // Cargar info de coste desde receta en background
    productosApi.obtener(p.id).then(({ data }: { data: any }) => {
      setCosteReceta({
        calculado: data.precio_coste_calculado != null ? parseFloat(data.precio_coste_calculado) : null,
        hasReceta: !!data.has_receta_activa,
        esManual: !!data.precio_coste_manual,
      });
    }).catch(() => { /* silencioso */ });
    // Cargar lotes disponibles en background
    setLoadingEditLotes(true);
    try {
      const res = await lotesApi.listar({ producto_id: p.id, estado: 'aprobado' });
      const disponibles = (res.data as LoteDisponible[]);
      setEditLotes(disponibles);
      setOriginalLotes(disponibles.map(l => ({ ...l })));
    } catch { /* silencioso */ }
    finally { setLoadingEditLotes(false); }
  };

  const handleGuardar = async () => {
    if (!form.nombre || !form.tipo) {
      setError('Nombre y tipo son obligatorios');
      return;
    }
    // Detectar renombres de lote y pedir confirmación explícita
    if (editando) {
      const renombrados = editLotes
        .map((l) => ({ l, original: originalLotes.find(ol => ol.id === l.id) }))
        .filter(({ l, original }) =>
          original && (original.lote_interno ?? '').trim().toUpperCase() !== (l.lote_interno ?? '').trim().toUpperCase()
        );
      if (renombrados.length > 0) {
        const detalle = renombrados.map(({ l, original }) => `· ${original!.lote_interno}  →  ${l.lote_interno}`).join('\n');
        const ok = window.confirm(
          `Vas a renombrar ${renombrados.length} lote(s):\n\n${detalle}\n\nEste cambio modifica trazabilidad y aparece en todos los registros que referencian el código antiguo. ¿Confirmas?`
        );
        if (!ok) return;
      }
    }
    setSaving(true);
    setError('');
    const payload: any = {
      ...form,
      proveedor_id: form.proveedor_id || null,
      codigo: form.codigo || undefined,
      caducidad_meses: form.caducidad_meses ? Number(form.caducidad_meses) : null,
      peso_unitario_kg: form.peso_unitario_kg ? Number(form.peso_unitario_kg) : null,
      unidades_por_envase: form.unidades_por_envase ? Number(form.unidades_por_envase) : null,
      solidos_min:    form.solidos_min    !== '' ? Number(form.solidos_min)    : null,
      solidos_max:    form.solidos_max    !== '' ? Number(form.solidos_max)    : null,
      ph_min:         form.ph_min         !== '' ? Number(form.ph_min)         : null,
      ph_max:         form.ph_max         !== '' ? Number(form.ph_max)         : null,
      viscosidad_min: form.viscosidad_min !== '' ? Number(form.viscosidad_min) : null,
      viscosidad_max: form.viscosidad_max !== '' ? Number(form.viscosidad_max) : null,
      subcategoria_mp: form.tipo === 'materia_prima' && form.subcategoria_mp ? form.subcategoria_mp : null,
      subcategoria_me: form.tipo === 'material_embalaje' && form.subcategoria_me ? form.subcategoria_me : null,
      nombre_comercial: (form.tipo === 'producto_fabricado' || form.tipo === 'producto_envasado')
        ? (form.nombre_comercial.trim() || null) : null,
      compartido_alilo: form.tipo !== 'material_embalaje' ? form.compartido_alilo : false,
      codigo_alilo: form.tipo !== 'material_embalaje' && form.compartido_alilo
        ? (form.codigo_alilo.trim() || null) : null,
      subcategoria_pf: (form.tipo === 'producto_fabricado' || form.tipo === 'producto_envasado')
        ? (form.subcategoria_pf || null) : null,
      confirmacion_msg: form.tipo === 'materia_prima' ? (form.confirmacion_msg.trim() || null) : null,
    };
    // Si user pulsó "Restaurar auto", indicar al backend que vuelva a modo automático
    if (resetAuto) payload.reset_coste_auto = true;
    const ejecutarGuardar = async () => {
      let productoIdGuardado: string | null = null;
      if (editando) {
        await productosApi.editar(editando.id, payload);
        productoIdGuardado = editando.id;
        // Actualizar lotes (cantidad y/o nombre). Renombre requiere confirmación previa
        // (verificada antes de llamar a ejecutarGuardar — ver handleGuardar wrapper).
        for (const l of editLotes) {
          const original = originalLotes.find(ol => ol.id === l.id);
          if (!original) continue;
          const cambioCantidad = original.cantidad_actual !== l.cantidad_actual;
          const cambioNombre   = (original.lote_interno ?? '').trim().toUpperCase() !== (l.lote_interno ?? '').trim().toUpperCase();
          if (cambioCantidad || cambioNombre) {
            await lotesApi.actualizar(l.id, {
              ...(cambioCantidad ? { cantidad_actual: parseFloat(l.cantidad_actual) } : {}),
              ...(cambioNombre   ? { lote_interno: l.lote_interno } : {}),
            });
          }
        }
        if (productoIdGuardado) {
          await specsApi.guardarProducto(productoIdGuardado, formSpecs.map((s, i) => ({
            spec_id: s.spec_id, min_valor: s.min_valor, max_valor: s.max_valor, orden: i,
            parametros: s.parametros && Object.values(s.parametros).some((v) => v !== '' && v != null) ? s.parametros : null,
          })));
        }
        return { nombre: form.nombre, codigo: editando.codigo, tipo: form.tipo, unidad: form.unidad_medida, precio_compra: form.precio_unitario, precio_venta: form.precio_venta, stock_minimo: form.stock_minimo };
      } else {
        const res = await productosApi.crear(payload);
        const data = res.data as { id?: string; nombre?: string; codigo?: string };
        productoIdGuardado = data?.id ?? null;
        // Persistir specs custom para producto nuevo
        if (productoIdGuardado) {
          await specsApi.guardarProducto(productoIdGuardado, formSpecs.map((s, i) => ({
            spec_id: s.spec_id, min_valor: s.min_valor, max_valor: s.max_valor, orden: i,
            parametros: s.parametros && Object.values(s.parametros).some((v) => v !== '' && v != null) ? s.parametros : null,
          })));
        }
        return { nombre: data?.nombre ?? form.nombre, codigo: data?.codigo ?? '', tipo: form.tipo, unidad: form.unidad_medida, precio_compra: form.precio_unitario, precio_venta: form.precio_venta, stock_minimo: form.stock_minimo };
      }
    };
    try {
      await notify.promise(ejecutarGuardar(), {
        loading: editando ? 'Guardando producto…' : 'Creando producto…',
        success: editando ? 'Producto guardado' : 'Producto creado',
        successDesc: (d) => {
          const tipoLabel = TIPOS_FORM.find(t => t.value === d.tipo)?.label ?? d.tipo;
          const minN = parseFloat(d.stock_minimo ?? '0');
          const pc = parseFloat(d.precio_compra ?? '0');
          const pv = parseFloat(d.precio_venta ?? '0');
          return (
            <ToastBlock title={d.nombre}>
              <ToastField label="Código" value={d.codigo} />
              <ToastField label="Tipo" value={tipoLabel} />
              <ToastField label="Unidad" value={d.unidad} />
              <ToastField label="Precio compra" value={pc > 0 ? `${pc.toFixed(2)} EUR` : ''} />
              <ToastField label="Precio venta" value={pv > 0 ? `${pv.toFixed(2)} EUR` : ''} />
              <ToastField label="Stock mín." value={minN > 0 ? `${minN.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${d.unidad}` : ''} />
            </ToastBlock>
          );
        },
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar',
      });
      setModalOpen(false);
      await cargar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const generarCodigoLote = (p: Producto) => {
    const hoy = new Date();
    const yy  = hoy.getFullYear().toString().slice(2);
    const mm  = String(hoy.getMonth() + 1).padStart(2, '0');
    const dd  = String(hoy.getDate()).padStart(2, '0');
    const prefijo = p.tipo === 'materia_prima' ? 'LMP' : p.tipo === 'producto_terminado' ? 'LPT' : 'LEM';
    const sufijo = Date.now().toString(36).slice(-4).toUpperCase();
    return `${prefijo}-${yy}${mm}${dd}-${sufijo}`;
  };

  const abrirStock = async (p: Producto) => {
    setStockProducto(p);
    setStockProductoSpecs([]);
    setStockSpecsValores({});
    specsApi.productoSpecs(p.id)
      .then(({ data }) => setStockProductoSpecs((data ?? []) as ProductoSpec[]))
      .catch(() => setStockProductoSpecs([]));
    setStockCantidad('');
    setStockMotivo('Entrada manual');
    setStockLoteInterno(generarCodigoLote(p));
    setStockLoteProveedor('');
    setStockProveedorId(p.proveedor_id ?? '');
    // Default caducidad: 1 año desde hoy
    const cadDefault = new Date();
    cadDefault.setFullYear(cadDefault.getFullYear() + 1);
    setStockCaducidad(cadDefault.toISOString().slice(0, 10));
    setStockUbicacion('');
    setStockPrecio(p.precio_unitario ?? '');
    setStockUnidadPrecio(p.unidad_medida ?? 'kg');
    setStockDivisa('EUR'); setStockTasaEur(1); setStockTasaAuto(true);
    setStockPorteDivisa('EUR'); setStockPorteTasaEur(1);
    setStockPorte('');
    setStockSolidos('');
    setStockPh('');
    setStockViscosidad('');
    setErrorStock('');
    // Reset factura
    setFacturaUrl(null); setFacturaMime('application/pdf');
    setFacturaError(''); setCamposConfianza({}); setFacturaParseando(false);
    setModalStock(true);
  };

  // Subir factura → llama API, autorrellena campos del modal
  const handleSubirFactura = async (file: File) => {
    setFacturaError('');
    setFacturaParseando(true);
    try {
      const { data } = await facturasApi.parse(file);
      type Campo<T> = { valor: T | null; confianza: 'alta' | 'media' | 'baja' | 'calculada' };
      const datos = (data as {
        datos: {
          factura_num: Campo<string>;
          albaran_ref: Campo<string>;
          fecha: Campo<string>;
          proveedor_nombre: Campo<string>;
          proveedor_cif: Campo<string>;
          cantidad: Campo<number>;
          unidad: Campo<string>;
          precio_unitario: Campo<number>;
          divisa: Campo<string>;
          unidad_precio: Campo<string>;
          total_sin_iva: Campo<number>;
          iva_pct: Campo<number>;
          total_con_iva: Campo<number>;
          porte: Campo<number>;
        };
        archivo_url: string;
        proveedor_match: { id: string; nombre: string } | null;
      }).datos;
      const archivo_url = (data as { archivo_url: string }).archivo_url;
      const proveedor_match = (data as { proveedor_match: { id: string; nombre: string } | null }).proveedor_match;

      const conf: Record<string, 'alta' | 'media' | 'baja' | 'calculada'> = {};

      if (datos.albaran_ref.valor) {
        setStockLoteProveedor(datos.albaran_ref.valor);
        conf['lote_proveedor'] = datos.albaran_ref.confianza;
      }
      if (datos.cantidad.valor != null) {
        setStockCantidad(String(datos.cantidad.valor));
        conf['cantidad'] = datos.cantidad.confianza;
      }
      if (datos.precio_unitario.valor != null) {
        setStockPrecio(datos.precio_unitario.valor.toFixed(4));
        conf['precio'] = datos.precio_unitario.confianza;
      }
      if (datos.porte.valor != null && datos.porte.valor > 0) {
        setStockPorte(datos.porte.valor.toFixed(2));
        conf['porte'] = datos.porte.confianza;
      }
      if (datos.divisa.valor) {
        const d = datos.divisa.valor as typeof stockDivisa;
        setStockDivisa(d);
        setStockPorteDivisa(d);
        conf['divisa'] = datos.divisa.confianza;
      }
      if (datos.unidad_precio.valor) {
        setStockUnidadPrecio(datos.unidad_precio.valor);
        conf['unidad_precio'] = datos.unidad_precio.confianza;
      }
      if (proveedor_match) {
        setStockProveedorId(proveedor_match.id);
        conf['proveedor'] = 'alta';
      } else if (datos.proveedor_nombre.valor) {
        conf['proveedor'] = 'baja';
      }
      // Caducidad: no la trae factura → default 1 año del producto (ya seteado)

      setCamposConfianza(conf);
      setFacturaUrl(archivo_url);
      setFacturaMime(file.type);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'No se pudo procesar la factura.';
      setFacturaError(msg);
    } finally {
      setFacturaParseando(false);
    }
  };

  const handleAnadirStock = async () => {
    if (!stockProducto || !stockCantidad || Number(stockCantidad) <= 0) {
      setErrorStock('Introduce una cantidad mayor que 0');
      return;
    }
    if (!stockLoteInterno.trim()) {
      setErrorStock('El código de lote es obligatorio para trazabilidad');
      return;
    }
    setSavingStock(true);
    setErrorStock('');
    const ejecutar = async () => {
      const provNombre = proveedores.find((p) => p.id === stockProveedorId)?.nombre;
      await lotesApi.crear({
        producto_id:       stockProducto.id,
        lote_interno:      stockLoteInterno.trim().toUpperCase(),
        lote_proveedor:    stockLoteProveedor.trim() || provNombre || null,
        cantidad_inicial:  Number(stockCantidad),
        cantidad_actual:   Number(stockCantidad),
        fecha_entrada:     new Date().toISOString().slice(0, 10),
        fecha_caducidad:   stockCaducidad || null,
        estado:            'aprobado',
        ubicacion:         stockUbicacion.trim() || null,
        // Precio siempre persistido en EUR (canónico para contabilidad)
        precio_compra:     stockPrecio ? Number(stockPrecio) * stockTasaEur : undefined,
        unidad_precio:     stockPrecio && stockUnidadPrecio ? stockUnidadPrecio : undefined,
        // Porte también convertido a EUR
        porte:             stockPorte ? Number(stockPorte) * stockPorteTasaEur : 0,
        solidos:    stockSolidos    !== '' ? Number(stockSolidos)    : null,
        ph:         stockPh         !== '' ? Number(stockPh)         : null,
        viscosidad: stockViscosidad !== '' ? Number(stockViscosidad) : null,
        // Valores de specs dinámicas para el lote
        specs_valores: Object.entries(stockSpecsValores)
          .filter(([, v]) => v !== '' && v != null)
          .map(([spec_id, valor]) => ({ spec_id: Number(spec_id), valor: Number(valor) })),
      });
      // Update precio del producto — secundario, no debe romper el flujo si falla
      if (stockPrecio && Math.abs(Number(stockPrecio) - parseFloat(stockProducto.precio_unitario)) > 0.0001) {
        try {
          await productosApi.editar(stockProducto.id, { precio_unitario: Number(stockPrecio) });
        } catch (e) {
          console.warn('No se pudo actualizar precio del producto:', e);
        }
      }
      return {
        nombre: stockProducto.nombre,
        cantidad: Number(stockCantidad),
        unidad: stockProducto.unidad_medida,
        lote_interno: stockLoteInterno.trim().toUpperCase(),
        proveedor: provNombre,
        precio: stockPrecio ? Number(stockPrecio) : undefined,
        caducidad: stockCaducidad || undefined,
        ubicacion: stockUbicacion.trim() || undefined,
      };
    };
    try {
      await notify.promise(ejecutar(), {
        loading: 'Añadiendo stock…',
        success: 'Stock añadido',
        successDesc: (d) => (
          <ToastBlock title={`${d.nombre} · +${d.cantidad.toLocaleString('es-ES')} ${d.unidad}`}>
            <ToastField label="Lote" value={d.lote_interno} span={2} />
            <ToastField label="Proveedor" value={d.proveedor} span={2} />
            {isAdmin && <ToastField label="Precio compra" value={d.precio !== undefined ? `${d.precio.toFixed(4)} EUR/${d.unidad}` : ''} />}
            <ToastField label="Caducidad" value={d.caducidad ? new Date(d.caducidad).toLocaleDateString('es-ES') : ''} />
            <ToastField label="Ubicación" value={d.ubicacion} span={2} />
          </ToastBlock>
        ),
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al añadir stock',
      });
      setModalStock(false);
      await cargar();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      // Si el lote ya existe (409), regenerar código para que el siguiente intento funcione
      if (status === 409 && stockProducto) {
        setStockLoteInterno(generarCodigoLote(stockProducto));
        setErrorStock('Código duplicado — generamos uno nuevo, vuelve a pulsar Añadir.');
      } else {
        setErrorStock(msg ?? 'Error al añadir stock');
      }
    } finally {
      setSavingStock(false);
    }
  };

  const handleEliminar = (p: Producto) => setConfirmElim(p);
  const doEliminar = async () => {
    if (!confirmElim) return;
    const p = confirmElim;
    try {
      await notify.promise(productosApi.eliminar(confirmElim.id), {
        loading: 'Desactivando…',
        success: 'Producto desactivado',
        successDesc: (
          <ToastBlock title={p.nombre}>
            <ToastField label="Código" value={p.codigo} span={2} />
          </ToastBlock>
        ),
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo desactivar',
      });
      setConfirmElim(null);
      await cargar();
    } catch { /* notificado */ }
  };

  const toggleLotes = async (pId: string) => {
    if (expandedId === pId) { setExpandedId(null); return; }
    setExpandedId(pId);
    setExpandedSpecs([]);
    try {
      const [resLotes, resSpecs] = await Promise.all([
        lotesApi.listar({ producto_id: pId, estado: 'aprobado' }),
        specsApi.productoSpecs(pId).catch(() => ({ data: [] })),
      ]);
      setExpandedLotes(resLotes.data as any[]);
      setExpandedSpecs((resSpecs.data ?? []) as ProductoSpec[]);
    } catch { setExpandedLotes([]); setExpandedSpecs([]); }
  };

  const toggleSort = (field: keyof Producto) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const cantidadBajoStock = productos.filter(p => p.nivel_stock === 'rojo' || p.nivel_stock === 'naranja').length;

  const productosFiltrados = productos
    .filter((p) => !filtroTipo || p.tipo === filtroTipo)
    .filter((p) => !filtroSubcategoria || ((p as any).subcategoria_mp === filtroSubcategoria))
    .filter((p) => !filtroSubcategoriaME || ((p as any).subcategoria_me === filtroSubcategoriaME))
    .filter((p) => !filtroSubcategoriaPF || ((p as any).subcategoria_pf === filtroSubcategoriaPF))
    .filter((p) => !filtroBajoStock || p.nivel_stock === 'rojo' || p.nivel_stock === 'naranja')
    .filter((p) =>
      !busqueda ||
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.codigo.toLowerCase().includes(busqueda.toLowerCase()) ||
      lotesProdMatch.has(p.id)
    )
    .sort((a, b) => {
      const av = a[sortField] ?? '';
      const bv = b[sortField] ?? '';
      // Numeric sort for stock/price fields
      const numFields = ['stock_actual', 'stock_minimo', 'stock_maximo', 'precio_unitario', 'precio_venta'];
      if (numFields.includes(sortField)) {
        const na = parseFloat(String(av)) || 0;
        const nb = parseFloat(String(bv)) || 0;
        return sortDir === 'asc' ? na - nb : nb - na;
      }
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {errorCarga && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-loga-red shrink-0" />
          <p className="text-sm text-red-700 font-medium">{errorCarga}</p>
          <button onClick={cargar} className="ml-auto text-xs text-loga-red underline font-semibold">Reintentar</button>
        </div>
      )}
      {/* Banner de verificación de stock (viene de predicción de demanda) */}
      {stockCheckProducto && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3"
        >
          <Sparkles size={16} className="text-indigo-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-indigo-900">Verificar stock para pedido previsto</p>
            <p className="text-xs text-indigo-600">
              <b>{stockCheckCliente}</b> suele pedir <b>{parseFloat(stockCheckCantidad ?? '0').toLocaleString('es-ES')} {stockCheckUnidad}</b> de <b>{stockCheckProducto}</b>
            </p>
          </div>
          <button
            onClick={() => { setSearchParams({}); }}
            className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            Cerrar
          </button>
        </motion.div>
      )}
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Productos</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {productos.length} producto{productos.length !== 1 ? 's' : ''} registrado{productos.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/recuento')}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            <ClipboardList size={16} /> Recuento
          </button>
          <button
            onClick={() => { setImportJson(EJEMPLO_IMPORTAR_PRODUCTOS); setImportResult(null); setModalImportar(true); }}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            <Upload size={16} /> Importar
          </button>
          <button
            onClick={abrirNuevo}
            className="flex items-center gap-2 rounded-lg bg-loga-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
          >
            <Plus size={16} /> Nuevo Producto
          </button>
        </div>
      </div>

      {/* Filtros — estructura jerárquica:
          Row 1: buscador + scanner + bajo stock (acción rápida)
          Row 2: pestañas primarias por tipo (con icono + contador)
          Row 3: chips de sub-categoría (sólo cuando la pestaña tiene sub-cats) */}
      {(() => {
        // Contador por tipo
        const counts = productos.reduce<Record<string, number>>((acc, p) => {
          acc[p.tipo] = (acc[p.tipo] ?? 0) + 1;
          return acc;
        }, {});
        const totalCount = productos.length;

        // Mapa de clases por color (Tailwind las necesita estáticas)
        const COLOR_CLS: Record<FiltroTipoMeta['color'], {
          activeBg: string; activeRing: string; chipActive: string; chipInactive: string; chipBand: string; iconColor: string;
        }> = {
          red:     { activeBg: 'bg-loga-red',     activeRing: 'ring-red-200',     chipActive: 'bg-loga-red text-white border-loga-red',         chipInactive: 'border-red-100 bg-red-50/50 text-red-700 hover:bg-red-50',                chipBand: 'bg-red-50/30 border-red-100',         iconColor: 'text-red-600' },
          purple:  { activeBg: 'bg-purple-600',   activeRing: 'ring-purple-200',  chipActive: 'bg-purple-600 text-white border-purple-600',     chipInactive: 'border-purple-100 bg-purple-50/50 text-purple-700 hover:bg-purple-50',     chipBand: 'bg-purple-50/30 border-purple-100',   iconColor: 'text-purple-600' },
          blue:    { activeBg: 'bg-blue-600',     activeRing: 'ring-blue-200',    chipActive: 'bg-blue-600 text-white border-blue-600',         chipInactive: 'border-blue-100 bg-blue-50/50 text-blue-700 hover:bg-blue-50',           chipBand: 'bg-blue-50/30 border-blue-100',       iconColor: 'text-blue-600' },
          emerald: { activeBg: 'bg-emerald-600',  activeRing: 'ring-emerald-200', chipActive: 'bg-emerald-600 text-white border-emerald-600',   chipInactive: 'border-emerald-100 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-50', chipBand: 'bg-emerald-50/30 border-emerald-100', iconColor: 'text-emerald-600' },
          amber:   { activeBg: 'bg-amber-600',    activeRing: 'ring-amber-200',   chipActive: 'bg-amber-600 text-white border-amber-600',       chipInactive: 'border-amber-100 bg-amber-50/50 text-amber-700 hover:bg-amber-50',       chipBand: 'bg-amber-50/30 border-amber-100',     iconColor: 'text-amber-600' },
        };

        const activeMeta = FILTROS_TIPO_META.find(m => m.value === filtroTipo) ?? FILTROS_TIPO_META[0];
        const showSubMP = filtroTipo === 'materia_prima' && subcategoriasMP.length > 0;
        const showSubME = filtroTipo === 'material_embalaje' && subcategoriasME.length > 0;
        const showSubPF = filtroTipo === 'producto_fabricado' || filtroTipo === 'producto_envasado';

        return (
          <div className="space-y-2.5">
            {/* Row 1: Search + Scanner + Bajo stock */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar producto…"
                  className="pl-8 w-full sm:w-64"
                />
              </div>
              <button
                onClick={() => setScanning(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
                title="Escanear código de barras"
              >
                <ScanLine size={14} />
                <span className="hidden sm:inline">Escanear</span>
              </button>
              <div className="flex-1" />
              {cantidadBajoStock > 0 && (
                <button
                  onClick={() => setFiltroBajoStock(v => !v)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap',
                    filtroBajoStock
                      ? 'bg-loga-red text-white shadow-sm'
                      : 'border border-red-200 bg-red-50 text-loga-red hover:bg-red-100'
                  )}
                  title={filtroBajoStock ? 'Quitar filtro bajo stock' : 'Filtrar solo bajo stock'}
                >
                  <span className={clsx('h-1.5 w-1.5 rounded-full', filtroBajoStock ? 'bg-white' : 'bg-loga-red animate-pulse')} />
                  Bajo stock
                  <span className={clsx('rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums', filtroBajoStock ? 'bg-white/25' : 'bg-loga-red text-white')}>
                    {cantidadBajoStock}
                  </span>
                </button>
              )}
            </div>

            {/* Row 2: Pestañas primarias (tipo de producto) */}
            <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
              <Filter size={13} className="text-gray-400 shrink-0" />
              {FILTROS_TIPO_META.map((meta) => {
                const active = filtroTipo === meta.value;
                const cls = COLOR_CLS[meta.color];
                const count = meta.value === '' ? totalCount : (counts[meta.value] ?? 0);
                const Icon = meta.icon;
                return (
                  <button
                    key={meta.value}
                    onClick={() => {
                      setFiltroTipo(meta.value);
                      // Reset sub-cat filters al cambiar tab — son específicas de cada tipo
                      if (meta.value !== 'materia_prima')    setFiltroSubcategoria('');
                      if (meta.value !== 'material_embalaje') setFiltroSubcategoriaME('');
                      if (meta.value !== 'producto_fabricado' && meta.value !== 'producto_envasado') setFiltroSubcategoriaPF('');
                    }}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 border',
                      active
                        ? clsx(cls.activeBg, 'text-white border-transparent shadow-sm ring-2', cls.activeRing)
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                    )}
                  >
                    <Icon size={13} className={active ? 'text-white' : cls.iconColor} />
                    {meta.label}
                    <span className={clsx(
                      'rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                      active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Row 3: Sub-cat chips — sólo cuando la pestaña activa tiene sub-cats */}
            {showSubMP && (
              <div className={clsx('flex items-center gap-1.5 overflow-x-auto rounded-xl border px-3 py-2', COLOR_CLS.purple.chipBand)}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 shrink-0 mr-1">Familias</span>
                <button
                  onClick={() => setFiltroSubcategoria('')}
                  className={clsx(
                    'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all whitespace-nowrap shrink-0',
                    filtroSubcategoria === ''
                      ? COLOR_CLS.purple.chipActive
                      : COLOR_CLS.purple.chipInactive,
                  )}
                >
                  Todas
                </button>
                {subcategoriasMP.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setFiltroSubcategoria(filtroSubcategoria === s.nombre ? '' : s.nombre)}
                    className={clsx(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all whitespace-nowrap shrink-0',
                      filtroSubcategoria === s.nombre
                        ? COLOR_CLS.purple.chipActive
                        : COLOR_CLS.purple.chipInactive,
                    )}
                  >
                    {s.nombre}
                  </button>
                ))}
              </div>
            )}
            {showSubME && (
              <div className={clsx('flex items-center gap-1.5 overflow-x-auto rounded-xl border px-3 py-2', COLOR_CLS.amber.chipBand)}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 shrink-0 mr-1">Tipo</span>
                <button
                  onClick={() => setFiltroSubcategoriaME('')}
                  className={clsx(
                    'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all whitespace-nowrap shrink-0',
                    filtroSubcategoriaME === ''
                      ? COLOR_CLS.amber.chipActive
                      : COLOR_CLS.amber.chipInactive,
                  )}
                >
                  Todos
                </button>
                {subcategoriasME.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setFiltroSubcategoriaME(filtroSubcategoriaME === s.nombre ? '' : s.nombre)}
                    className={clsx(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all whitespace-nowrap shrink-0',
                      filtroSubcategoriaME === s.nombre
                        ? COLOR_CLS.amber.chipActive
                        : COLOR_CLS.amber.chipInactive,
                    )}
                  >
                    {s.nombre}
                  </button>
                ))}
              </div>
            )}
            {showSubPF && (
              <div className={clsx(
                'flex items-center gap-1.5 overflow-x-auto rounded-xl border px-3 py-2',
                filtroTipo === 'producto_fabricado' ? COLOR_CLS.blue.chipBand : COLOR_CLS.emerald.chipBand,
              )}>
                <span className={clsx(
                  'text-[10px] font-bold uppercase tracking-wider shrink-0 mr-1',
                  filtroTipo === 'producto_fabricado' ? 'text-blue-700' : 'text-emerald-700',
                )}>Origen</span>
                {([
                  { value: '',         label: 'Todos' },
                  { value: 'propia',   label: 'Fabricación propia' },
                  { value: 'terceros', label: 'Fabricados por terceros' },
                ] as const).map((opt) => {
                  const active = filtroSubcategoriaPF === opt.value;
                  const cls = filtroTipo === 'producto_fabricado' ? COLOR_CLS.blue : COLOR_CLS.emerald;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setFiltroSubcategoriaPF(opt.value === '' ? '' : (filtroSubcategoriaPF === opt.value ? '' : opt.value))}
                      className={clsx(
                        'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all whitespace-nowrap shrink-0',
                        active ? cls.chipActive : cls.chipInactive,
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Hint: indica el filtro activo cuando hay sub-cat */}
            {(filtroSubcategoria || filtroSubcategoriaME || filtroSubcategoriaPF) && (
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                <span className={clsx('h-1.5 w-1.5 rounded-full',
                  activeMeta.color === 'purple' ? 'bg-purple-500' :
                  activeMeta.color === 'amber'  ? 'bg-amber-500'  :
                  activeMeta.color === 'blue'   ? 'bg-blue-500'   :
                  'bg-emerald-500',
                )} />
                Filtrando <b className="text-gray-600">{
                  filtroSubcategoria ||
                  filtroSubcategoriaME ||
                  (filtroSubcategoriaPF === 'propia' ? 'Fabricación propia' :
                   filtroSubcategoriaPF === 'terceros' ? 'Fabricados por terceros' : '')
                }</b> dentro de {activeMeta.label.toLowerCase()}
                <button
                  onClick={() => { setFiltroSubcategoria(''); setFiltroSubcategoriaME(''); setFiltroSubcategoriaPF(''); }}
                  className="ml-1 text-loga-red hover:underline"
                >
                  limpiar
                </button>
              </p>
            )}
          </div>
        );
      })()}

      {/* Mobile cards (md:hidden) */}
      <div className="flex flex-col gap-2 md:hidden">
        {productosFiltrados.length === 0 && (
          <div className="flex flex-col items-center py-12 text-gray-400">
            <Package size={32} className="mb-2 text-gray-200" />
            <p className="text-sm">{busqueda || filtroTipo ? 'Sin resultados' : 'No hay productos'}</p>
          </div>
        )}
        {productosFiltrados.map(p => (
          <div key={p.id}
            className={clsx('rounded-xl border bg-white shadow-sm p-3 space-y-2', {
              'border-red-200 bg-red-50/40': p.nivel_stock === 'rojo',
              'border-amber-200 bg-amber-50/40': p.nivel_stock === 'naranja',
              'border-gray-100': p.nivel_stock === 'verde' || !p.nivel_stock,
            })}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1" onClick={() => toggleLotes(p.id)}>
                <p className="text-[10px] font-mono text-gray-400">{p.codigo}</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                  {p.nivel_stock === 'rojo' && <AlertTriangle size={12} className="text-loga-red shrink-0" />}
                  {p.nivel_stock === 'naranja' && <AlertTriangle size={12} className="text-amber-500 shrink-0" />}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <TipoBadge tipo={p.tipo} />
                  <span className={clsx('text-sm font-bold tabular-nums', {
                    'text-loga-red': p.nivel_stock === 'rojo',
                    'text-amber-600': p.nivel_stock === 'naranja',
                    'text-emerald-600': p.nivel_stock === 'verde',
                    'text-gray-700': !p.nivel_stock,
                  })}>
                    {parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })} <span className="text-[10px] font-normal text-gray-500">{p.unidad_medida}</span>
                  </span>
                </div>
                {p.proveedor_nombre && <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.proveedor_nombre}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 pt-1 border-t border-gray-100">
              <button onClick={() => abrirStock(p)} className="flex-1 rounded-lg bg-emerald-50 text-emerald-600 py-2 text-[11px] font-semibold flex items-center justify-center gap-1">
                <PackagePlus size={12} /> Stock
              </button>
              {p.tipo === 'producto_terminado' && (
                <button onClick={() => navigate(`/produccion?producto=${encodeURIComponent(p.nombre)}`)} className="flex-1 rounded-lg bg-loga-red/10 text-loga-red py-2 text-[11px] font-semibold flex items-center justify-center gap-1">
                  <Factory size={12} /> Producir
                </button>
              )}
              {p.tipo !== 'producto_terminado' && p.proveedor_nombre && (
                <button onClick={() => setEmailProducto(p)} className="flex-1 rounded-lg bg-blue-50 text-blue-600 py-2 text-[11px] font-semibold flex items-center justify-center gap-1">
                  <Mail size={12} /> Pedir
                </button>
              )}
              <button onClick={() => abrirEditar(p)} className="rounded-lg border border-gray-200 p-2 text-gray-500" aria-label="Editar"><Pencil size={14} /></button>
              <button onClick={() => handleEliminar(p)} className="rounded-lg border border-gray-200 p-2 text-gray-400" aria-label="Eliminar"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Tabla (md+) */}
      <div className="hidden md:block rounded-xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th
                  onClick={() => toggleSort('codigo')}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                >
                  <span className="flex items-center gap-1">
                    Código
                    {sortField === 'codigo' ? (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : null}
                  </span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide select-none">
                  Nº CAS
                </th>
                {([
                  { field: 'nombre',  label: 'Nombre' },
                  { field: 'tipo',    label: 'Tipo' },
                  { field: 'stock_actual', label: 'Stock Actual' },
                  { field: 'unidad_medida', label: 'Unidad' },
                  { field: 'proveedor_nombre', label: 'Proveedor' },
                ] as { field: keyof Producto; label: string }[]).map(({ field, label }) => (
                  <th
                    key={field}
                    onClick={() => toggleSort(field)}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:bg-gray-100 select-none"
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {sortField === field
                        ? sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                        : null}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-50">
              {productosFiltrados.map((p, i) => (
                <React.Fragment key={p.id}>
                <motion.tr
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className={clsx('transition-colors', {
                    'bg-red-50/60 hover:bg-red-50 shadow-[inset_3px_0_0_0_#FF0000]': p.nivel_stock === 'rojo',
                    'bg-amber-50/60 hover:bg-amber-50 shadow-[inset_3px_0_0_0_#F59E0B]': p.nivel_stock === 'naranja',
                    'hover:bg-gray-50': p.nivel_stock === 'verde' || !p.nivel_stock,
                  })}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-gray-600 cursor-pointer" onClick={() => toggleLotes(p.id)}>
                    <div className="flex items-center gap-1">
                      <ChevronDown size={12} className={clsx('transition-transform text-gray-400', expandedId === p.id && 'rotate-180')} />
                      {p.codigo}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">
                    {p.tipo === 'materia_prima' && (p as any).numero_cas ? (p as any).numero_cas : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 cursor-pointer hover:text-loga-red" onClick={() => toggleLotes(p.id)}>{p.nombre}</span>
                      {p.nivel_stock === 'rojo' && <AlertTriangle size={13} className="text-loga-red shrink-0" />}
                      {p.nivel_stock === 'naranja' && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
                      {(p as any).compartido_alilo && (
                        <span
                          title="Producto compartido — Alilo puede descontar stock"
                          className="inline-flex items-center gap-1 rounded-md bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        >
                          🔗 Alilo
                        </span>
                      )}
                      {(p as any).subcategoria_pf === 'propia' && (
                        <span title="Fabricación propia" className="inline-flex items-center gap-1 rounded-md bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-bold">
                          Propia
                        </span>
                      )}
                      {(p as any).subcategoria_pf === 'terceros' && (
                        <span title="Fabricados por terceros" className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-bold">
                          Terceros
                        </span>
                      )}
                    </div>
                    {p.descripcion && (
                      <p className="text-[11px] text-gray-400 truncate max-w-xs">{p.descripcion}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <TipoBadge tipo={p.tipo} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className={clsx('font-semibold', {
                      'text-loga-red': p.nivel_stock === 'rojo',
                      'text-amber-600': p.nivel_stock === 'naranja',
                      'text-emerald-600': p.nivel_stock === 'verde',
                      'text-gray-900': !p.nivel_stock,
                    })}>
                      {parseFloat(p.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                    </span>
                    {p.nivel_stock === 'rojo' && (
                      <span className="ml-1.5 rounded bg-red-100 text-loga-red px-1.5 py-0.5 text-[10px] font-bold uppercase">Bajo</span>
                    )}
                    {p.nivel_stock === 'naranja' && (
                      <span className="ml-1.5 rounded bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold uppercase">Justo</span>
                    )}
                    {p.nivel_stock === 'verde' && (
                      <span className="ml-1.5 rounded bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-bold uppercase">OK</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.unidad_medida}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{p.proveedor_nombre ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => abrirStock(p)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                        title="Añadir stock"
                      >
                        <PackagePlus size={14} />
                      </button>
                      {p.tipo === 'producto_terminado' ? (
                        <button
                          onClick={() => navigate(`/produccion?producto=${encodeURIComponent(p.nombre)}`)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-loga-red/10 hover:text-loga-red transition-colors"
                          title="Producir"
                        >
                          <Factory size={14} />
                        </button>
                      ) : p.proveedor_nombre ? (
                        <button
                          onClick={() => setEmailProducto(p)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                          title="Pedir stock al proveedor"
                        >
                          <Mail size={14} />
                        </button>
                      ) : null}
                      <a
                        href={`/api/productos/${p.id}/trazabilidad.csv`}
                        download
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-purple-50 hover:text-purple-600 transition-colors inline-flex"
                        title="Descargar trazabilidad CSV"
                      >
                        <Download size={14} />
                      </a>
                      <button
                        onClick={() => abrirEditar(p)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleEliminar(p)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"
                        title="Desactivar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </motion.tr>
                {expandedId === p.id && (
                  <tr>
                    <td colSpan={8} className="px-4 py-2 bg-gray-50/80">
                      {expandedLotes.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">Sin lotes con stock</p>
                      ) : (() => {
                        // Specs dinámicas: prioriza fetch reciente (expandedSpecs), fallback a p.specs del listing
                        const pp = p as any;
                        const productoSpecs: ProductoSpec[] = expandedSpecs.length > 0 ? expandedSpecs : ((pp.specs as ProductoSpec[]) ?? []);
                        // Helper: clase de color según si valor está dentro del rango
                        const cls = (v: any, min: any, max: any): string => {
                          if (v == null || v === '') return 'text-gray-400';
                          const n = parseFloat(String(v));
                          if (isNaN(n)) return 'text-gray-400';
                          if (min != null && n < parseFloat(min)) return 'text-loga-red font-semibold';
                          if (max != null && n > parseFloat(max)) return 'text-loga-red font-semibold';
                          return 'text-emerald-700 font-semibold';
                        };
                        const fmt = (v: any) => v != null && v !== '' ? parseFloat(String(v)).toString() : '—';
                        // Etiqueta corta para header
                        const shortLabel = (nombre: string) => nombre.length > 8 ? nombre.slice(0, 7) + '…' : nombre;
                        return (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left py-1 font-medium">Lote</th>
                              <th className="text-left py-1 font-medium">Ref. proveedor</th>
                              <th className="text-right py-1 font-medium">Entrada</th>
                              <th className="text-right py-1 font-medium">Restante</th>
                              {isAdmin && <th className="text-right py-1 font-medium">Precio</th>}
                              {isAdmin && <th className="text-right py-1 font-medium">Valor actual</th>}
                              {productoSpecs.map((ps) => (
                                <th key={ps.spec_id} className="text-right py-1 font-medium" title={ps.nombre + (ps.unidad ? ` (${ps.unidad})` : '')}>
                                  {shortLabel(ps.nombre)}
                                </th>
                              ))}
                              <th className="text-right py-1 font-medium">Fecha entrada</th>
                              <th className="text-right py-1 font-medium">Caducidad</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {[...expandedLotes].sort((a, b) => parseFloat(b.cantidad_actual) - parseFloat(a.cantidad_actual)).map((l, li) => {
                              const inicial = parseFloat(l.cantidad_inicial ?? l.cantidad_actual);
                              const actual = parseFloat(l.cantidad_actual);
                              const precio = parseFloat(l.precio_compra ?? '0');
                              const agotado = actual <= 0;
                              const gastado = actual < inicial && actual > 0;
                              const ll = l as any;
                              return (
                                <tr key={li} className={agotado ? 'opacity-25' : 'hover:bg-gray-100/50'}>
                                  <td className={clsx('py-1.5 font-mono', agotado ? 'text-gray-400 line-through' : 'text-gray-700')}>{l.lote_interno}</td>
                                  <td className={clsx('py-1.5 font-mono text-xs', agotado ? 'text-gray-300' : 'text-gray-500')}>{l.lote_proveedor || '—'}</td>
                                  <td className="py-1.5 text-right tabular-nums text-gray-400">{inicial.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
                                  <td className="py-1.5 text-right tabular-nums">
                                    <span className={clsx('font-semibold', agotado ? 'text-gray-300' : gastado ? 'text-amber-600' : 'text-gray-800')}>
                                      {actual.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {p.unidad_medida}
                                    </span>
                                  </td>
                                  {isAdmin && (() => {
                                    const porteTotal = parseFloat(ll.porte ?? '0');
                                    const precioTotalUnit = parseFloat(ll.precio_unitario_total ?? '0') || (precio + (inicial > 0 ? porteTotal / inicial : 0));
                                    if (precio <= 0 && porteTotal <= 0) {
                                      return <td className="py-1.5 text-right tabular-nums text-gray-500">—</td>;
                                    }
                                    return (
                                      <td className="py-1.5 text-right tabular-nums text-gray-700" title={`Precio: ${precio.toFixed(4)} EUR\nPortes: ${porteTotal.toFixed(2)} EUR\nUnitario c/portes: ${precioTotalUnit.toFixed(4)} EUR`}>
                                        <div className="leading-tight">
                                          <div className="font-semibold">{precioTotalUnit.toFixed(4)} EUR/{ll.unidad_precio ?? p.unidad_medida}</div>
                                          {porteTotal > 0 && (
                                            <div className="text-[10px] text-gray-400">
                                              {precio.toFixed(2)} + porte {(inicial > 0 ? porteTotal / inicial : 0).toFixed(4)}/{p.unidad_medida}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })()}
                                  {isAdmin && <td className="py-1.5 text-right tabular-nums font-semibold text-gray-800">{precio > 0 && actual > 0 ? `${(actual * (parseFloat(ll.precio_unitario_total ?? '0') || precio)).toFixed(2)} EUR` : agotado ? '0.00 EUR' : '—'}</td>}
                                  {productoSpecs.map((ps) => {
                                    const sv = ((ll.specs_valores ?? []) as { spec_id: number; valor: string | null }[]).find((s) => s.spec_id === ps.spec_id);
                                    // Fallback legacy: si producto_specs apunta a pH/Sólidos/Viscosidad y el lote aún no tiene lote_specs
                                    let valor: any = sv?.valor ?? null;
                                    if (valor == null) {
                                      if (ps.nombre === 'pH') valor = ll.ph;
                                      else if (ps.nombre === 'Sólidos') valor = ll.solidos;
                                      else if (ps.nombre === 'Viscosidad') valor = ll.viscosidad;
                                    }
                                    return (
                                      <td key={ps.spec_id} className={clsx('py-1.5 text-right tabular-nums', cls(valor, ps.min_valor, ps.max_valor))}>
                                        {fmt(valor)}
                                      </td>
                                    );
                                  })}
                                  <td className="py-1.5 text-right text-gray-500 whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                  <td className="py-1.5 text-right text-gray-500">{l.fecha_caducidad ? new Date(l.fecha_caducidad).toLocaleDateString('es-ES') : '—'}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t border-gray-200 font-semibold text-gray-800">
                              <td className="py-1.5">En stock</td>
                              <td></td>
                              <td></td>
                              <td className="py-1.5 text-right tabular-nums">{expandedLotes.filter(l => parseFloat(l.cantidad_actual) > 0).reduce((s, l) => s + parseFloat(l.cantidad_actual), 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {p.unidad_medida}</td>
                              {isAdmin && <td></td>}
                              {isAdmin && <td className="py-1.5 text-right tabular-nums">{expandedLotes.filter(l => parseFloat(l.cantidad_actual) > 0).reduce((s, l) => {
                                const pu = parseFloat((l as any).precio_unitario_total ?? '0') || parseFloat(l.precio_compra ?? '0');
                                return s + parseFloat(l.cantidad_actual) * pu;
                              }, 0).toFixed(2)} EUR</td>}
                              {productoSpecs.map((ps) => <td key={ps.spec_id}></td>)}
                              <td></td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                        );
                      })()}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
              {productosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <Package size={32} className="mx-auto mb-2 text-gray-200" />
                    <p className="text-sm text-gray-400">
                      {busqueda || filtroTipo ? 'Sin resultados para ese filtro' : 'No hay productos. Crea el primero.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal añadir stock */}
      <Modal
        open={modalStock}
        onClose={() => setModalStock(false)}
        title="Añadir Stock"
        subtitle={stockProducto ? `${stockProducto.codigo} — ${stockProducto.nombre}` : ''}
        maxWidth={facturaUrl ? 'max-w-6xl' : 'max-w-lg'}
      >
        {stockProducto && (
          <div className={clsx('gap-5', facturaUrl ? 'grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]' : '')}>

            {/* ── Panel PDF/imagen lado a lado (solo si hay factura) ── */}
            {facturaUrl && (
              <div className="order-2 lg:order-1 lg:sticky lg:top-0 lg:self-start">
                <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
                  <div className="flex items-center justify-between bg-gray-100 px-3 py-2 border-b border-gray-200">
                    <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">Factura original</span>
                    <button
                      type="button"
                      onClick={() => { setFacturaUrl(null); setCamposConfianza({}); }}
                      className="text-[11px] text-gray-500 hover:text-loga-red font-medium"
                    >Quitar</button>
                  </div>
                  {facturaMime.startsWith('image/') ? (
                    <img src={facturasApi.fileUrl(facturaUrl)} alt="factura" className="w-full h-[70vh] object-contain bg-white" />
                  ) : (
                    <iframe src={facturasApi.fileUrl(facturaUrl)} title="factura" className="w-full h-[70vh] bg-white" />
                  )}
                </div>
              </div>
            )}

            <div className={clsx('space-y-4', facturaUrl ? 'order-1 lg:order-2' : '')}>

            {/* ── Botón subir factura ── */}
            {isAdmin && !facturaUrl && (
              <div>
                <input
                  ref={facturaInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSubirFactura(f); e.target.value = ''; }}
                />
                <button
                  type="button"
                  onClick={() => facturaInputRef.current?.click()}
                  disabled={facturaParseando}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-loga-red/40 bg-loga-red/5 hover:bg-loga-red/10 py-3 text-sm font-semibold text-loga-red transition-colors disabled:opacity-50"
                >
                  {facturaParseando ? <><SpinnerColaBlanca size="sm" /> Procesando factura...</> : <><Upload size={16} /> Subir factura (PDF o imagen)</>}
                </button>
                {facturaError && (
                  <p className="mt-1.5 text-[11px] text-loga-red">{facturaError}</p>
                )}
              </div>
            )}
            {facturaUrl && Object.keys(camposConfianza).length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800">
                <b>Datos extraídos automáticamente.</b> Verifica cada campo con la factura.
                Los señalados con <span className="inline-block w-2 h-2 rounded-full bg-amber-500 align-middle mx-1" /> son aproximados o calculados.
              </div>
            )}

            {/* Fila stock actual → nuevo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
                <p className="text-gray-400 mb-0.5">Stock actual</p>
                <p className="font-bold text-gray-900 tabular-nums">
                  {parseFloat(stockProducto.stock_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                  <span className="ml-1 font-normal text-gray-400">{stockProducto.unidad_medida}</span>
                </p>
              </div>
              <div className={clsx(
                'rounded-lg border px-3 py-2.5',
                stockCantidad && Number(stockCantidad) > 0
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-gray-50 border-gray-100'
              )}>
                <p className="text-gray-400 mb-0.5">Nuevo stock</p>
                <p className="font-bold tabular-nums text-emerald-700">
                  {stockCantidad && Number(stockCantidad) > 0
                    ? (parseFloat(stockProducto.stock_actual) + Number(stockCantidad)).toLocaleString('es-ES', { maximumFractionDigits: 2 })
                    : '—'}
                  <span className="ml-1 font-normal text-gray-400">{stockProducto.unidad_medida}</span>
                </p>
              </div>
            </div>

            {/* Cantidad + unidad */}
            <FormField label="Cantidad a añadir" required>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min="0.001" step="0.001"
                  value={stockCantidad}
                  onChange={(e) => setStockCantidad(e.target.value)}
                  placeholder="0"
                  className="flex-1 text-lg font-semibold"
                  autoFocus
                />
                <span className="text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg px-4 py-2.5 whitespace-nowrap">
                  {stockProducto.unidad_medida}
                </span>
              </div>
            </FormField>

            {/* Proveedor */}
            <FormField label="Proveedor">
              <Select
                value={stockProveedorId}
                onChange={(e) => setStockProveedorId(e.target.value)}
              >
                <option value="">— Sin proveedor —</option>
                {proveedores.map((pv) => (
                  <option key={pv.id} value={pv.id}>{pv.nombre}</option>
                ))}
              </Select>
            </FormField>

            {/* Sección lote */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
              <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide">Trazabilidad del lote</p>

              {/* Código lote con botón regenerar */}
              <FormField label="Código de lote" required hint="Identificador único — se auto-genera, puedes modificarlo">
                <div className="flex items-center gap-2">
                  <Input
                    value={stockLoteInterno}
                    onChange={(e) => setStockLoteInterno(e.target.value.toUpperCase())}
                    placeholder="LMP-260419"
                    className="flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setStockLoteInterno(generarCodigoLote(stockProducto))}
                    className="shrink-0 rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-gray-700 hover:border-gray-300 transition-colors"
                    title="Regenerar código"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Referencia proveedor" hint="Nº albarán, lote externo…">
                  <Input
                    value={stockLoteProveedor}
                    onChange={(e) => setStockLoteProveedor(e.target.value)}
                    placeholder="ALB-2026-001"
                  />
                </FormField>
                <FormField label="Fecha de caducidad">
                  <Input
                    type="date"
                    value={stockCaducidad}
                    onChange={(e) => setStockCaducidad(e.target.value)}
                    onBlur={(e) => setStockCaducidad(e.target.value)}
                  />
                  {stockProducto.caducidad_meses && (
                    <button
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        d.setMonth(d.getMonth() + (stockProducto.caducidad_meses ?? 12));
                        setStockCaducidad(d.toISOString().slice(0, 10));
                      }}
                      className="mt-1 flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                    >
                      <CalendarClock size={10} />
                      Auto: {stockProducto.caducidad_meses} meses desde hoy
                    </button>
                  )}
                </FormField>
              </div>

              <FormField label="Ubicación en almacén">
                <Input
                  value={stockUbicacion}
                  onChange={(e) => setStockUbicacion(e.target.value)}
                  placeholder="Almacén A · Estante 3"
                />
              </FormField>
            </div>

            {/* Precio de compra — solo admin. Operario añade stock sin tocar precio. */}
            {isAdmin && (
              <FormField label={`Precio de compra (${stockDivisa})`} hint={stockProducto && parseFloat(stockProducto.precio_unitario) > 0 ? `Anterior: ${parseFloat(stockProducto.precio_unitario).toFixed(4)} EUR/${stockProducto.unidad_medida}` : undefined}>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="0" step="0.0001"
                    value={stockPrecio}
                    onChange={(e) => setStockPrecio(e.target.value)}
                    placeholder="0.0000"
                    className="flex-1 font-mono"
                  />
                  <div className="flex items-center bg-gray-100 rounded-lg px-2 py-1.5 text-xs text-gray-600 gap-1">
                    <select
                      value={stockDivisa}
                      onChange={(e) => { setStockDivisa(e.target.value as typeof stockDivisa); setStockTasaAuto(true); }}
                      className="bg-transparent outline-none cursor-pointer font-bold"
                      title="Divisa de pago"
                    >
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="CNY">CNY</option>
                      <option value="GBP">GBP</option>
                      <option value="JPY">JPY</option>
                      <option value="CHF">CHF</option>
                      <option value="MXN">MXN</option>
                      <option value="BRL">BRL</option>
                      <option value="CAD">CAD</option>
                      <option value="AUD">AUD</option>
                    </select>
                    <span>/</span>
                    <select
                      value={stockUnidadPrecio}
                      onChange={(e) => setStockUnidadPrecio(e.target.value)}
                      className="bg-transparent outline-none cursor-pointer font-medium"
                    >
                      <option value="kg">kg</option>
                      <option value="L">L</option>
                      <option value="ud">ud</option>
                      <option value="g">g</option>
                      <option value="m">m</option>
                      <option value="m2">m²</option>
                    </select>
                  </div>
                </div>

                {stockDivisa !== 'EUR' && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] rounded-lg bg-amber-50/60 border border-amber-100 px-2 py-1.5">
                    <span className="text-amber-700 font-semibold">Tasa:</span>
                    <span className="text-gray-600">1 {stockDivisa} =</span>
                    <input
                      type="number" step="0.0001" min="0"
                      value={stockTasaEur}
                      onChange={(e) => { setStockTasaEur(Number(e.target.value)); setStockTasaAuto(false); }}
                      className="w-20 rounded border border-amber-200 px-1.5 py-0.5 text-xs font-mono bg-white"
                    />
                    <span className="text-gray-600">EUR</span>
                    {stockTasaAuto && <span className="text-[9px] uppercase font-bold text-emerald-600 bg-emerald-50 rounded px-1.5">auto</span>}
                    {!stockTasaAuto && (
                      <button type="button" onClick={() => setStockTasaAuto(true)} className="text-[9px] uppercase font-bold text-blue-600 hover:underline">restaurar auto</button>
                    )}
                    {stockPrecio && (
                      <span className="ml-auto text-gray-700 font-semibold">
                        = {(Number(stockPrecio) * stockTasaEur).toFixed(4)} EUR
                      </span>
                    )}
                  </div>
                )}

                {stockPrecio && stockProducto && parseFloat(stockProducto.precio_unitario) > 0 && Math.abs(Number(stockPrecio) * stockTasaEur - parseFloat(stockProducto.precio_unitario)) > 0.0001 && (
                  <p className={clsx('text-[11px] font-medium mt-1', Number(stockPrecio) * stockTasaEur > parseFloat(stockProducto.precio_unitario) ? 'text-loga-red' : 'text-emerald-600')}>
                    {Number(stockPrecio) * stockTasaEur > parseFloat(stockProducto.precio_unitario) ? 'Subida' : 'Bajada'} vs último: {((Number(stockPrecio) * stockTasaEur - parseFloat(stockProducto.precio_unitario)) / parseFloat(stockProducto.precio_unitario) * 100).toFixed(1)}%
                  </p>
                )}
              </FormField>
            )}

            {/* Porte + total calculado — solo admin */}
            {isAdmin && (
              <FormField label={`Porte / Transporte (${stockPorteDivisa})`} hint="Coste del envío. Se convierte a EUR y se suma al precio total del lote.">
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="0" step="0.01"
                    value={stockPorte}
                    onChange={(e) => setStockPorte(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 font-mono"
                  />
                  <select
                    value={stockPorteDivisa}
                    onChange={(e) => setStockPorteDivisa(e.target.value as typeof stockPorteDivisa)}
                    className="text-xs text-gray-700 bg-gray-100 rounded-lg px-2 py-2.5 outline-none cursor-pointer font-bold"
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                    <option value="GBP">GBP</option>
                    <option value="JPY">JPY</option>
                    <option value="CHF">CHF</option>
                    <option value="MXN">MXN</option>
                    <option value="BRL">BRL</option>
                    <option value="CAD">CAD</option>
                    <option value="AUD">AUD</option>
                  </select>
                </div>
                {stockPorteDivisa !== 'EUR' && stockPorte && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Tasa 1 {stockPorteDivisa} = <input type="number" step="0.0001" value={stockPorteTasaEur} onChange={e => setStockPorteTasaEur(Number(e.target.value))}
                      className="w-20 rounded border border-gray-200 px-1 py-0.5 text-xs font-mono mx-1" /> EUR
                    {' '}→ <b className="text-gray-700">{(Number(stockPorte) * stockPorteTasaEur).toFixed(2)} EUR</b>
                  </p>
                )}
                {/* Resumen de coste total del lote — todo en EUR */}
                {(() => {
                  const cant = parseFloat(stockCantidad || '0');
                  const precioEur = parseFloat(stockPrecio || '0') * stockTasaEur;
                  const porteEur = parseFloat(stockPorte || '0') * stockPorteTasaEur;
                  const subtotal = cant * precioEur;
                  const total = subtotal + porteEur;
                  const precioUnitTotal = cant > 0 ? precioEur + (porteEur / cant) : precioEur;
                  if (cant <= 0 || (precioEur <= 0 && porteEur <= 0)) return null;
                  return (
                    <div className="mt-2 rounded-lg bg-emerald-50/50 border border-emerald-100 px-3 py-2 text-xs space-y-0.5 font-mono">
                      <div className="flex justify-between text-gray-600">
                        <span>Producto ({cant} × {precioEur.toFixed(4)} EUR)</span>
                        <span>{subtotal.toFixed(2)} EUR</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>Porte</span>
                        <span>{porteEur.toFixed(2)} EUR</span>
                      </div>
                      <div className="flex justify-between border-t border-emerald-200 pt-0.5 mt-1 font-bold text-emerald-700">
                        <span>COSTE TOTAL DEL LOTE</span>
                        <span>{total.toFixed(2)} EUR</span>
                      </div>
                      <div className="flex justify-between text-[11px] pt-1 mt-0.5 border-t border-emerald-200/60 text-emerald-800">
                        <span>Precio unitario CON porte</span>
                        <span className="font-bold">{precioUnitTotal.toFixed(4)} EUR/{form.unidad_medida}</span>
                      </div>
                    </div>
                  );
                })()}
              </FormField>
            )}

            {/* ── Valores físico-químicos medidos del lote — render dinámico desde producto_specs ── */}
            {stockProductoSpecs.length > 0 && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
                <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Valores medidos de este lote</p>
                {stockProductoSpecs.map((s) => {
                  const val = stockSpecsValores[s.spec_id] ?? '';
                  const min = s.min_valor != null ? parseFloat(String(s.min_valor)) : null;
                  const max = s.max_valor != null ? parseFloat(String(s.max_valor)) : null;
                  let ok: boolean | null = null;
                  if (val !== '') {
                    const n = Number(val);
                    if (!isNaN(n)) {
                      ok = (min != null && n < min) || (max != null && n > max) ? false : true;
                    }
                  }
                  const rangeStr = (min == null && max == null)
                    ? undefined
                    : `Rango: ${min ?? '?'}–${max ?? '?'}${s.unidad ? ' ' + s.unidad : ''}`;
                  return (
                    <FormField key={s.spec_id} label={`${s.nombre}${s.unidad ? ` (${s.unidad})` : ''}`} hint={rangeStr}>
                      <div className="flex items-center gap-2">
                        <Input type="number" step="0.01"
                          value={val}
                          onChange={(e) => setStockSpecsValores((m) => ({ ...m, [s.spec_id]: e.target.value }))}
                          placeholder="—" />
                        {ok === false && <span className="text-xs text-loga-red font-semibold whitespace-nowrap">Fuera ⚠</span>}
                        {ok === true  && <span className="text-xs text-emerald-600 font-semibold whitespace-nowrap">OK ✓</span>}
                      </div>
                    </FormField>
                  );
                })}
              </div>
            )}

            {/* Motivo */}
            <FormField label="Motivo / Observaciones">
              <Input
                value={stockMotivo}
                onChange={(e) => setStockMotivo(e.target.value)}
                placeholder="Entrada manual, compra, devolucion..."
              />
            </FormField>

            {errorStock && (
              <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
                {errorStock}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setModalStock(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAnadirStock}
                disabled={savingStock}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300 transition-colors"
              >
                {savingStock ? 'Guardando…' : <><PackagePlus size={14} /> Registrar entrada</>}
              </button>
            </div>

            </div>{/* fin columna formulario */}
          </div>
        )}
      </Modal>

      {/* Modal crear/editar */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editando ? 'Editar Producto' : 'Nuevo Producto'}
        subtitle={editando ? `${editando.codigo} — ${editando.nombre}` : 'Rellena los datos del producto'}
      >
        <div className="space-y-4">
          {/* ── 1. IDENTIDAD ── */}
          <FormField label="Nombre" required>
            <Input
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Acetato de polivinilo 88%"
            />
          </FormField>

          {/* Nombre comercial + Origen (sub-categoría PF) — productos fabricados/envasados */}
          {(form.tipo === 'producto_fabricado' || form.tipo === 'producto_envasado') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="Nombre comercial (opcional)"
                hint="Cómo se llama al vender. Vacío = usa el nombre normal. Se imprime en etiquetas."
              >
                <Input
                  value={form.nombre_comercial}
                  onChange={(e) => setForm((f) => ({ ...f, nombre_comercial: e.target.value }))}
                  placeholder="LOGA 800 / Cola Blanca Premium"
                  maxLength={200}
                />
              </FormField>
              <FormField
                label="Origen"
                hint="Fabricación propia o de terceros (re-vendido)."
              >
                <Select
                  value={form.subcategoria_pf}
                  onChange={(e) => setForm((f) => ({ ...f, subcategoria_pf: e.target.value as '' | 'propia' | 'terceros' }))}
                >
                  <option value="">— Sin clasificar —</option>
                  <option value="propia">Fabricación propia</option>
                  <option value="terceros">Fabricados por terceros</option>
                </Select>
              </FormField>
            </div>
          )}

          {/* Compartido con Alilo — no aplica a embalaje */}
          {form.tipo !== 'material_embalaje' && (
            <div className={clsx(
              'rounded-xl border transition-colors overflow-hidden',
              form.compartido_alilo
                ? 'border-violet-200 bg-violet-50/50'
                : 'border-gray-200 hover:border-gray-300 bg-white',
            )}>
              <label className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.compartido_alilo}
                  onChange={(e) => setForm((f) => ({ ...f, compartido_alilo: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
                />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                    🔗 Producto compartido con Alilo
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    El otro sistema (Alilo) puede descontar stock de este producto vía API HMAC.
                    Lo consumido sale del inventario de Loga.
                  </p>
                </div>
              </label>

              {/* Campo mapeo código Alilo — solo si está marcado */}
              {form.compartido_alilo && (
                <div className="px-3 pb-3 pt-1 border-t border-violet-200 bg-white/60">
                  <label className="block text-[10px] font-bold text-violet-700 uppercase tracking-wider mb-1">
                    Código equivalente en Alilo
                  </label>
                  <Input
                    value={form.codigo_alilo}
                    onChange={(e) => setForm((f) => ({ ...f, codigo_alilo: e.target.value.toUpperCase() }))}
                    placeholder="Ej: MP-A042 (cómo se llama en Alilo)"
                    maxLength={50}
                    className="font-mono"
                  />
                  <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
                    Cuando Alilo llame con este código, descontará de este producto.
                    Si lo dejas vacío, se busca por el código de Loga (<b className="font-mono text-violet-700">{editando?.codigo ?? '—'}</b>) directamente.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Tipo" required>
              <Select
                value={form.tipo}
                onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoProducto }))}
                disabled={!!editando}
              >
                {TIPOS_FORM.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Código" hint={editando ? undefined : 'Auto si vacío'}>
              <Input
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                placeholder={editando ? '' : `${form.tipo === 'materia_prima' ? 'MP' : form.tipo === 'material_embalaje' ? 'ME' : 'PT'}-XXX (auto)`}
                disabled={!!editando}
              />
            </FormField>
          </div>

          {/* Sub-categoría + Nº CAS — materia prima */}
          {form.tipo === 'materia_prima' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Sub-categoría" hint="Familia química (editable en Configuración)">
                <Select
                  value={form.subcategoria_mp}
                  onChange={(e) => setForm((f) => ({ ...f, subcategoria_mp: e.target.value }))}
                >
                  <option value="">— Sin clasificar —</option>
                  {subcategoriasMP.map((s) => (
                    <option key={s.id} value={s.nombre}>{s.nombre}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Nº CAS" hint="Identificador químico. Ej: 7732-18-5">
                <Input
                  value={form.numero_cas}
                  onChange={(e) => setForm((f) => ({ ...f, numero_cas: e.target.value }))}
                  placeholder="Ej: 9003-20-7"
                  className="font-mono"
                />
              </FormField>
            </div>
          )}

          <FormField label="Descripción">
            <Textarea
              rows={2}
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              placeholder="Descripción opcional…"
            />
          </FormField>

          {/* ── 2. MEDIDAS Y PRECIOS ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Unidad" required>
              <Select
                value={form.unidad_medida}
                onChange={(e) => setForm((f) => ({ ...f, unidad_medida: e.target.value }))}
              >
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </FormField>
            <FormField
              label="Precio coste (EUR)"
              hint={
                costeReceta?.hasReceta
                  ? costeReceta.esManual ? 'Manual' : 'Auto desde receta'
                  : 'Precio de compra'
              }
            >
              <Input
                type="number" min="0" step="0.01"
                value={form.precio_unitario}
                onChange={(e) => {
                  setForm((f) => ({ ...f, precio_unitario: e.target.value }));
                  setResetAuto(false);
                }}
              />
              {costeReceta?.hasReceta && costeReceta.calculado != null && (
                <div className="mt-1.5 flex items-center gap-2 text-[10px] flex-wrap">
                  <span className={clsx(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold uppercase tracking-wider',
                    costeReceta.esManual
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  )}>
                    <span className={clsx('w-1 h-1 rounded-full', costeReceta.esManual ? 'bg-amber-500' : 'bg-emerald-500')} />
                    {costeReceta.esManual ? 'Manual' : 'Auto'}
                  </span>
                  <span className="text-zinc-500">
                    Receta: <b className="text-zinc-700 dark:text-zinc-300 tabular-nums">{costeReceta.calculado.toFixed(4)}</b>
                  </span>
                  {costeReceta.esManual && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, precio_unitario: costeReceta.calculado!.toFixed(4) }));
                        setResetAuto(true);
                      }}
                      className="text-loga-red hover:underline font-bold"
                    >
                      Restaurar auto
                    </button>
                  )}
                </div>
              )}
            </FormField>
            <FormField label="Precio venta (EUR)" hint="Precio al cliente">
              <Input
                type="number" min="0" step="0.01"
                value={form.precio_venta}
                onChange={(e) => setForm((f) => ({ ...f, precio_venta: e.target.value }))}
              />
            </FormField>
          </div>

          {/* ── 3. STOCK Y CADUCIDAD ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Stock mínimo" hint="Alerta si baja de aquí">
              <Input
                type="number" min="0" step="0.001"
                value={form.stock_minimo}
                onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))}
              />
            </FormField>
            <FormField label="Stock máximo" hint="Referencia % alerta">
              <Input
                type="number" min="0" step="0.001"
                value={form.stock_maximo}
                onChange={(e) => setForm((f) => ({ ...f, stock_maximo: e.target.value }))}
              />
            </FormField>
            <FormField label="Caducidad (meses)" hint="Auto-calcula en lote">
              <Input
                type="number" min="0" step="1"
                value={form.caducidad_meses ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, caducidad_meses: e.target.value }))}
                placeholder="Ej: 36"
              />
            </FormField>
          </div>

          {/* ── 4. EMBALAJE (sub-categoría + campo dinámico) ── */}
          {form.tipo === 'material_embalaje' && (() => {
            const rol = rolEmbalaje(form.subcategoria_me);
            const subcatActual = subcategoriasME.find(s => s.nombre === form.subcategoria_me);
            return (
              <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Package size={14} className="text-amber-600 shrink-0" />
                  <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Tipo de embalaje</p>
                </div>

                <FormField label="¿Qué es este embalaje?" hint="Determina qué campo se pide debajo. Editable en Configuración → Sub-categorías ME.">
                  <Select
                    value={form.subcategoria_me}
                    onChange={(e) => setForm((f) => ({ ...f, subcategoria_me: e.target.value }))}
                  >
                    <option value="">— Selecciona tipo —</option>
                    {subcategoriasME.map((s) => (
                      <option key={s.id} value={s.nombre}>{s.nombre}</option>
                    ))}
                  </Select>
                </FormField>

                {/* Campo dinámico según rol */}
                {rol === 'contenedor' && (
                  <FormField
                    label={`Kg de cola que entran en 1 ${subcatActual?.nombre.toLowerCase() ?? 'envase'}`}
                    hint="Cuánta cola cabe dentro. Bote 1kg → 1. Frasco 75g → 0.075. Bidón 30kg → 30. Garrafa 10L (densidad ~1.05) → 10.5."
                  >
                    <Input
                      type="number" min="0" step="0.001"
                      value={form.peso_unitario_kg}
                      onChange={(e) => setForm((f) => ({ ...f, peso_unitario_kg: e.target.value }))}
                      placeholder="Ej: 1 (bote 1kg)"
                    />
                  </FormField>
                )}

                {rol === 'agrupador' && (
                  <>
                    <FormField
                      label={`Botes dentro de 1 ${subcatActual?.nombre.toLowerCase() ?? 'caja'}`}
                      hint="Solo el multiplicador. Caja de 24 botes → 24. Caja de 40 frascos → 40."
                    >
                      <Input
                        type="number" min="1" step="1"
                        value={form.unidades_por_envase}
                        onChange={(e) => setForm((f) => ({ ...f, unidades_por_envase: e.target.value }))}
                        placeholder="Ej: 24"
                      />
                    </FormField>
                    <p className="text-[11px] text-gray-500 bg-white/70 border border-gray-100 rounded-lg px-3 py-2 leading-relaxed">
                      ℹ Los kg de cola por bote se configuran en el <b className="text-gray-700">bote individual</b> (sub-cat Bote) o en el <b className="text-gray-700">producto envasado</b>. Al planificar envasado se multiplica: <span className="font-mono">cajas × botes × kg/bote</span>.
                    </p>
                  </>
                )}

                {form.subcategoria_me && rol === 'consumible' && (
                  <p className="text-[11px] text-gray-500 bg-white/70 border border-gray-100 rounded-lg px-3 py-2">
                    <b className="text-gray-700">{subcatActual?.nombre}</b> es un consumible (1 por bote por defecto). No requiere campo extra — se usa tal cual en la receta de envasado.
                  </p>
                )}

                {!form.subcategoria_me && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠ Selecciona el tipo arriba para ver el campo correcto.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Para producto_envasado: mantener bloque clásico (PT envasado usa peso_unitario_kg) */}
          {(form.tipo === 'producto_envasado' || (form.tipo !== 'material_embalaje' && form.peso_unitario_kg)) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="Peso neto de cola (kg)"
                hint="Peso por unidad envasada. Bote 1kg → 1. Frasco 75g → 0.075."
              >
                <Input
                  type="number" min="0" step="0.001"
                  value={form.peso_unitario_kg}
                  onChange={(e) => setForm((f) => ({ ...f, peso_unitario_kg: e.target.value }))}
                  placeholder="Ej: 1"
                />
              </FormField>
              <FormField
                label="Unidades por envase (caja)"
                hint="Botes en la caja. Sueltos → vacío."
              >
                <Input
                  type="number" min="1" step="1"
                  value={form.unidades_por_envase}
                  onChange={(e) => setForm((f) => ({ ...f, unidades_por_envase: e.target.value }))}
                  placeholder="Ej: 40"
                />
              </FormField>
            </div>
          )}

          {/* ── Especificaciones requeridas (dinámicas desde catálogo) — materia prima ── */}
          {form.tipo === 'materia_prima' && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-blue-700 uppercase tracking-wide">Especificaciones requeridas</p>
                <select
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    if (!id) return;
                    const spec = specCatalogo.find((s) => s.id === id);
                    if (!spec || formSpecs.some((s) => s.spec_id === id)) return;
                    setFormSpecs((prev) => [...prev, {
                      spec_id: id, nombre: spec.nombre, unidad: spec.unidad, decimales: spec.decimales,
                      min_valor: '', max_valor: '',
                    }]);
                  }}
                  className="text-xs rounded-lg border border-blue-200 bg-white px-2 py-1 cursor-pointer hover:border-blue-400"
                >
                  <option value="">+ Añadir spec…</option>
                  {specCatalogo
                    .filter((s) => !formSpecs.some((fs) => fs.spec_id === s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}{s.unidad ? ` (${s.unidad})` : ''}</option>
                    ))}
                </select>
              </div>
              <p className="text-[11px] text-gray-500 -mt-2">Rangos aceptables. Cada lote tendrá su valor medido y se comparará contra esto.</p>

              {formSpecs.length === 0 && (
                <p className="text-xs text-gray-400 italic py-2">Sin specs asignadas. Usa el desplegable para añadir (pH, Sólidos, Viscosidad, Densidad…).</p>
              )}

              {formSpecs.map((s, idx) => {
                const setParam = (k: string, v: string) => setFormSpecs((arr) => arr.map((x, i) => i === idx ? { ...x, parametros: { ...(x.parametros ?? {}), [k]: v } } : x));
                const isViscosidad = s.nombre === 'Viscosidad';
                return (
                  <div key={s.spec_id} className="space-y-1.5">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="text-[11px] font-medium text-gray-600 block mb-1">
                          {s.nombre}{s.unidad ? <span className="text-gray-400"> ({s.unidad})</span> : null}
                        </label>
                        <div className="flex items-center gap-2">
                          <Input type="number" step="0.01" placeholder="mín"
                            value={s.min_valor}
                            onChange={(e) => setFormSpecs((arr) => arr.map((x, i) => i === idx ? { ...x, min_valor: e.target.value } : x))} />
                          <span className="text-gray-400">—</span>
                          <Input type="number" step="0.01" placeholder="máx"
                            value={s.max_valor}
                            onChange={(e) => setFormSpecs((arr) => arr.map((x, i) => i === idx ? { ...x, max_valor: e.target.value } : x))} />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFormSpecs((arr) => arr.filter((_, i) => i !== idx))}
                        className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"
                        title="Quitar"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {isViscosidad && (
                      <div className="ml-1 pl-3 border-l-2 border-blue-200 grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-gray-400 block mb-0.5">Temperatura (°C)</label>
                          <Input type="number" step="0.1" placeholder="0"
                            value={s.parametros?.temperatura ?? ''}
                            onChange={(e) => setParam('temperatura', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-gray-400 block mb-0.5">Husillo</label>
                          <Input type="text" placeholder="Sp0"
                            value={s.parametros?.husillo ?? ''}
                            onChange={(e) => setParam('husillo', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wide text-gray-400 block mb-0.5">RPM</label>
                          <Input type="number" step="1" placeholder="0"
                            value={s.parametros?.rpm ?? ''}
                            onChange={(e) => setParam('rpm', e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {editando && editLotes.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Lotes — stock + nombre editable</p>
              {editLotes.map((l, i) => {
                const qty = parseFloat(l.cantidad_actual);
                const agotado = qty <= 0;
                return (
                  <div key={i} className={clsx('flex items-center gap-2 text-xs rounded-lg px-2 py-1.5', agotado ? 'opacity-30' : 'bg-white border border-gray-100')}>
                    <input
                      type="text"
                      value={l.lote_interno}
                      onChange={e => {
                        const newLotes = [...editLotes];
                        newLotes[i] = { ...newLotes[i], lote_interno: e.target.value.toUpperCase() };
                        setEditLotes(newLotes);
                      }}
                      className="flex-1 min-w-0 font-mono text-xs rounded border border-gray-200 px-2 py-1 focus:border-blue-400 outline-none"
                      title="Código del lote — al guardar pedirá confirmación si cambia"
                    />
                    <input
                      type="number" min="0" step="0.01"
                      value={l.cantidad_actual}
                      onChange={e => {
                        const newLotes = [...editLotes];
                        newLotes[i] = { ...newLotes[i], cantidad_actual: e.target.value };
                        setEditLotes(newLotes);
                      }}
                      className="w-20 rounded border border-gray-200 px-2 py-1 text-xs text-right font-mono focus:border-blue-400 outline-none"
                    />
                    <span className="text-gray-400 text-[10px] shrink-0">{form.unidad_medida}</span>
                  </div>
                );
              })}
            </div>
          )}

          <FormField label="Proveedor">
            <Select
              value={form.proveedor_id}
              onChange={(e) => setForm((f) => ({ ...f, proveedor_id: e.target.value }))}
            >
              <option value="">— Sin proveedor —</option>
              {proveedores.map((pv) => (
                <option key={pv.id} value={pv.id}>{pv.nombre}</option>
              ))}
            </Select>
          </FormField>

          {/* ── AVANZADO: Mensaje de confirmación en fabricación — colapsable, sólo MP ── */}
          {form.tipo === 'materia_prima' && (
            <details className="rounded-xl border border-gray-200 bg-gray-50/40" open={!!form.confirmacion_msg.trim()}>
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 flex items-center gap-2">
                <span>⚙ Mensaje de confirmación en fabricación</span>
                <span className="text-[10px] font-normal text-gray-400">(opcional)</span>
                {form.confirmacion_msg.trim() && (
                  <span className="ml-auto text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">activo</span>
                )}
              </summary>
              <div className="px-3 pb-3">
                <p className="text-[11px] text-gray-500 mb-2">
                  Si pones un texto, al finalizar cada fabricación con esta materia prima se pedirá confirmar el mensaje. Útil para recordatorios (ej: "has verificado la viscosidad").
                </p>
                <Textarea
                  rows={2}
                  value={form.confirmacion_msg}
                  onChange={(e) => setForm((f) => ({ ...f, confirmacion_msg: e.target.value }))}
                  placeholder="Ej: ¿Has verificado la viscosidad antes de cerrar?"
                  maxLength={500}
                />
              </div>
            </details>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleGuardar}
              disabled={saving}
              className="flex-1 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors"
            >
              {saving ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmElim}
        title="Desactivar producto"
        message={`Se desactivara "${confirmElim?.nombre}". Podras reactivarlo desde la base de datos.`}
        confirmText="Desactivar"
        onConfirm={doEliminar}
        onCancel={() => setConfirmElim(null)}
      />

      {emailProducto && (
        <EmailModal
          producto={emailProducto}
          onClose={() => { setEmailProducto(null); cargar(); }}
        />
      )}

      {/* Modal Importar Productos */}
      <Modal
        open={modalImportar}
        onClose={() => setModalImportar(false)}
        title="Importar Productos (JSON)"
        subtitle="Pega un JSON con el array de productos a importar"
      >
        <div className="space-y-4">
          <Textarea
            rows={14}
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='{"productos":[...]}'
            className="font-mono text-xs"
          />
          {importResult && (
            <p className={`rounded-lg px-3 py-2 text-xs ${importResult.startsWith('Error') || importResult.startsWith('JSON') ? 'bg-red-50 border border-red-100 text-loga-red' : 'bg-emerald-50 border border-emerald-100 text-emerald-700'}`}>
              {importResult}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => setModalImportar(false)}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                setImporting(true);
                setImportResult(null);
                try {
                  const parsed = JSON.parse(importJson);
                  const res = await notify.promise(productosApi.importar(parsed), {
                    loading: 'Importando productos…',
                    success: (r) => {
                      const d = (r as { data: { creados: number } }).data;
                      return `${d.creados} producto(s) importado(s)`;
                    },
                    error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al importar',
                  });
                  const d = (res as { data: { ok: boolean; creados: number } }).data;
                  setImportResult(`${d.creados} producto(s) importado(s) correctamente.`);
                  cargar();
                } catch (err: unknown) {
                  if (err instanceof SyntaxError) {
                    notify.error('JSON inválido — revisa la sintaxis');
                    setImportResult('JSON invalido — revisa la sintaxis');
                  } else {
                    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                    setImportResult(msg ?? 'Error al importar');
                  }
                } finally {
                  setImporting(false);
                }
              }}
              disabled={importing || !importJson.trim()}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors"
            >
              <Upload size={14} />
              {importing ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </div>
      </Modal>

      <BarcodeScanner
        open={scanning}
        onScan={(code) => {
          setScanning(false);
          setBusqueda(code);
        }}
        onClose={() => setScanning(false)}
      />
    </div>
  );
}

function TipoBadge({ tipo }: { tipo: TipoProducto }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    materia_prima:      { label: 'Materia Prima',    cls: 'bg-blue-100 text-blue-700'    },
    producto_terminado: { label: 'Prod. Terminado',  cls: 'bg-purple-100 text-purple-700'},
    producto_fabricado: { label: 'Fabricado',         cls: 'bg-loga-red/10 text-loga-red' }, // etiqueta visible en lista — corta a propósito
    producto_envasado:  { label: 'Envasado',          cls: 'bg-emerald-100 text-emerald-700' },
    material_embalaje:  { label: 'Embalaje',          cls: 'bg-gray-100 text-gray-600'   },
  };
  const { label, cls } = cfg[tipo] ?? { label: tipo, cls: 'bg-gray-100 text-gray-600' };
  return <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', cls)}>{label}</span>;
}
