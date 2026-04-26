import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus, Pencil, Trash2, Package, Search, Filter,
  ChevronUp, ChevronDown, AlertTriangle, PackagePlus, RefreshCw, Download, ScanLine, Mail, Factory, Upload, ClipboardList, Sparkles, CalendarClock,
} from 'lucide-react';
import { productosApi, proveedoresApi, stockApi, lotesApi } from '../api/client';
import type { Producto, Proveedor, TipoProducto } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import BarcodeScanner from '../components/BarcodeScanner';
import EmailModal from '../components/EmailModal';
import { FormField, Input, Select, Textarea } from '../components/FormField';

import clsx from 'clsx';

const FILTROS_TIPO: { value: TipoProducto | ''; label: string }[] = [
  { value: '',                     label: 'Todos'               },
  { value: 'materia_prima',        label: 'Materia Prima'       },
  { value: 'producto_fabricado',   label: 'Fabricado (granel)'  },
  { value: 'producto_envasado',    label: 'Envasado (botes)'    },
  { value: 'material_embalaje',    label: 'Embalaje'            },
];

const TIPOS_FORM: { value: TipoProducto; label: string }[] = [
  { value: 'materia_prima',        label: 'Materia Prima'       },
  { value: 'producto_fabricado',   label: 'Prod. Fabricado'     },
  { value: 'producto_envasado',    label: 'Prod. Envasado'      },
  { value: 'material_embalaje',    label: 'Material Embalaje'   },
];

const UNIDADES = ['kg', 'g', 'L', 'mL', 'ud', 'caja', 'saco', 't'];

interface FormData {
  codigo: string;
  nombre: string;
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
}

interface LoteDisponible { id: string; lote_interno: string; lote_proveedor?: string; cantidad_actual: string; cantidad_inicial?: string; fecha_caducidad?: string; }

const EMPTY: FormData = {
  codigo: '', nombre: '', descripcion: '', tipo: 'materia_prima',
  unidad_medida: 'kg', stock_actual: '0', stock_minimo: '0', stock_maximo: '0',
  precio_unitario: '0', precio_venta: '0', proveedor_id: '', caducidad_meses: '', peso_unitario_kg: '',
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
  const [modalOpen, setModalOpen]     = useState(false);
  const [editando, setEditando]       = useState<Producto | null>(null);
  const [form, setForm]               = useState<FormData>(EMPTY);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [sortField, setSortField]     = useState<keyof Producto>('nombre');
  const [expandedId, setExpandedId]   = useState<string | null>(null);
  const [expandedLotes, setExpandedLotes] = useState<{ lote_interno: string; cantidad_inicial?: string; cantidad_actual: string; precio_compra?: string; fecha_caducidad?: string; fecha_entrada?: string; created_at?: string }[]>([]);
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
  const [editLoteId, setEditLoteId]       = useState('');
  const [loadingEditLotes, setLoadingEditLotes] = useState(false);

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
  const [savingStock, setSavingStock]       = useState(false);
  const [errorStock, setErrorStock]         = useState('');

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

  const abrirNuevo = () => {
    setEditando(null);
    setForm(EMPTY);
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = async (p: Producto) => {
    setEditando(p);
    const fmt2 = (v: string) => parseFloat(v || '0').toFixed(2);
    setForm({
      codigo:          p.codigo,
      nombre:          p.nombre,
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
    });
    setEditLotes([]);
    setEditLoteId('');
    setError('');
    setModalOpen(true);
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
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, proveedor_id: form.proveedor_id || null, codigo: form.codigo || undefined, caducidad_meses: form.caducidad_meses ? Number(form.caducidad_meses) : null, peso_unitario_kg: form.peso_unitario_kg ? Number(form.peso_unitario_kg) : null };
      if (editando) {
        await productosApi.editar(editando.id, payload);
        // Si el stock cambió, registrar el ajuste
        const stockOriginal = parseFloat(editando.stock_actual);
        const stockNuevo    = parseFloat(form.stock_actual);
        if (!isNaN(stockNuevo) && Math.abs(stockNuevo - stockOriginal) > 0.000001) {
          const delta = stockNuevo - stockOriginal;
          await stockApi.ajustarStock({
            producto_id: editando.id,
            cantidad:    delta,
            motivo:      `Ajuste manual desde ficha de producto (${delta > 0 ? '+' : ''}${delta.toFixed(2)} ${form.unidad_medida})`,
            ...(editLoteId ? { lote_id: editLoteId } : {}),
          });
        }
        // Update modified lotes
        for (const l of editLotes) {
          const original = originalLotes.find(ol => ol.id === l.id);
          if (original && original.cantidad_actual !== l.cantidad_actual) {
            await lotesApi.actualizar(l.id, { cantidad_actual: parseFloat(l.cantidad_actual) });
          }
        }
      } else {
        await productosApi.crear(payload);
      }
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

  const abrirStock = (p: Producto) => {
    setStockProducto(p);
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
    setErrorStock('');
    setModalStock(true);
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
    try {
      // 1. Crear el lote
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
        precio_compra:     stockPrecio ? Number(stockPrecio) : undefined,
      });

      // Si el precio cambio, actualizar producto
      if (stockPrecio && Math.abs(Number(stockPrecio) - parseFloat(stockProducto.precio_unitario)) > 0.0001) {
        await productosApi.editar(stockProducto.id, { precio_unitario: Number(stockPrecio) });
      }
      // Stock del producto se sincroniza automáticamente en backend al crear lote

      setModalStock(false);
      await cargar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorStock(msg ?? 'Error al añadir stock');
    } finally {
      setSavingStock(false);
    }
  };

  const handleEliminar = (p: Producto) => setConfirmElim(p);
  const doEliminar = async () => {
    if (!confirmElim) return;
    await productosApi.eliminar(confirmElim.id);
    setConfirmElim(null);
    await cargar();
  };

  const toggleLotes = async (pId: string) => {
    if (expandedId === pId) { setExpandedId(null); return; }
    setExpandedId(pId);
    try {
      const res = await lotesApi.listar({ producto_id: pId, estado: 'aprobado' });
      setExpandedLotes(res.data as any[]);
    } catch { setExpandedLotes([]); }
  };

  const toggleSort = (field: keyof Producto) => {
    if (sortField === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const productosFiltrados = productos
    .filter((p) => !filtroTipo || p.tipo === filtroTipo)
    .filter((p) =>
      !busqueda ||
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.codigo.toLowerCase().includes(busqueda.toLowerCase())
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

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            className="pl-8 w-full sm:w-52"
          />
        </div>
        <button
          onClick={() => setScanning(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          title="Escanear codigo de barras"
        >
          <ScanLine size={14} />
          <span className="hidden sm:inline">Escanear</span>
        </button>
        <div className="flex items-center gap-1 overflow-x-auto">
          <Filter size={13} className="text-gray-400 shrink-0" />
          {FILTROS_TIPO.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFiltroTipo(value)}
              className={clsx(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0',
                filtroTipo === value
                  ? 'bg-loga-red text-white'
                  : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                {([
                  { field: 'codigo',  label: 'Código' },
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
                    'bg-red-50/60 hover:bg-red-50': p.nivel_stock === 'rojo',
                    'bg-amber-50/60 hover:bg-amber-50': p.nivel_stock === 'naranja',
                    'hover:bg-gray-50': p.nivel_stock === 'verde' || !p.nivel_stock,
                  })}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-gray-600 cursor-pointer" onClick={() => toggleLotes(p.id)}>
                    <div className="flex items-center gap-1">
                      <ChevronDown size={12} className={clsx('transition-transform text-gray-400', expandedId === p.id && 'rotate-180')} />
                      {p.codigo}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 cursor-pointer hover:text-loga-red" onClick={() => toggleLotes(p.id)}>{p.nombre}</span>
                      {p.nivel_stock === 'rojo' && <AlertTriangle size={13} className="text-loga-red shrink-0" />}
                      {p.nivel_stock === 'naranja' && <AlertTriangle size={13} className="text-amber-500 shrink-0" />}
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
                    <td colSpan={7} className="px-4 py-2 bg-gray-50/80">
                      {expandedLotes.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">Sin lotes con stock</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left py-1 font-medium">Lote</th>
                              <th className="text-right py-1 font-medium">Entrada</th>
                              <th className="text-right py-1 font-medium">Restante</th>
                              <th className="text-right py-1 font-medium">Precio</th>
                              <th className="text-right py-1 font-medium">Valor actual</th>
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
                              return (
                                <tr key={li} className={agotado ? 'opacity-25' : 'hover:bg-gray-100/50'}>
                                  <td className={clsx('py-1.5 font-mono', agotado ? 'text-gray-400 line-through' : 'text-gray-700')}>{l.lote_interno}</td>
                                  <td className="py-1.5 text-right tabular-nums text-gray-400">{inicial.toLocaleString('es-ES', { maximumFractionDigits: 2 })}</td>
                                  <td className="py-1.5 text-right tabular-nums">
                                    <span className={clsx('font-semibold', agotado ? 'text-gray-300' : gastado ? 'text-amber-600' : 'text-gray-800')}>
                                      {actual.toLocaleString('es-ES', { maximumFractionDigits: 2 })} {p.unidad_medida}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-right tabular-nums text-gray-500">{precio > 0 ? `${precio.toFixed(2)} EUR` : '—'}</td>
                                  <td className="py-1.5 text-right tabular-nums font-semibold text-gray-800">{precio > 0 && actual > 0 ? `${(actual * precio).toFixed(2)} EUR` : agotado ? '0.00 EUR' : '—'}</td>
                                  <td className="py-1.5 text-right text-gray-500 whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                  <td className="py-1.5 text-right text-gray-500">{l.fecha_caducidad ? new Date(l.fecha_caducidad).toLocaleDateString('es-ES') : '—'}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t border-gray-200 font-semibold text-gray-800">
                              <td className="py-1.5">En stock</td>
                              <td></td>
                              <td className="py-1.5 text-right tabular-nums">{expandedLotes.filter(l => parseFloat(l.cantidad_actual) > 0).reduce((s, l) => s + parseFloat(l.cantidad_actual), 0).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {p.unidad_medida}</td>
                              <td></td>
                              <td className="py-1.5 text-right tabular-nums">{expandedLotes.filter(l => parseFloat(l.cantidad_actual) > 0).reduce((s, l) => s + parseFloat(l.cantidad_actual) * parseFloat(l.precio_compra ?? '0'), 0).toFixed(2)} EUR</td>
                              <td></td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))}
              {productosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
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
      >
        {stockProducto && (
          <div className="space-y-4">

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

            {/* Precio de compra */}
            <FormField label="Precio de compra (EUR)" hint={stockProducto && parseFloat(stockProducto.precio_unitario) > 0 ? `Anterior: ${parseFloat(stockProducto.precio_unitario).toFixed(4)} EUR/${stockProducto.unidad_medida}` : undefined}>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min="0" step="0.0001"
                  value={stockPrecio}
                  onChange={(e) => setStockPrecio(e.target.value)}
                  placeholder="0.0000"
                  className="flex-1 font-mono"
                />
                <span className="text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-2.5 whitespace-nowrap">
                  EUR/{stockProducto?.unidad_medida ?? 'kg'}
                </span>
              </div>
              {stockPrecio && stockProducto && parseFloat(stockProducto.precio_unitario) > 0 && Math.abs(Number(stockPrecio) - parseFloat(stockProducto.precio_unitario)) > 0.0001 && (
                <p className={clsx('text-[11px] font-medium mt-1', Number(stockPrecio) > parseFloat(stockProducto.precio_unitario) ? 'text-loga-red' : 'text-emerald-600')}>
                  {Number(stockPrecio) > parseFloat(stockProducto.precio_unitario) ? 'Subida' : 'Bajada'}: {((Number(stockPrecio) - parseFloat(stockProducto.precio_unitario)) / parseFloat(stockProducto.precio_unitario) * 100).toFixed(1)}%
                </p>
              )}
            </FormField>

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
            <FormField label="Codigo" hint={editando ? undefined : 'Se auto-genera si lo dejas vacio'}>
              <Input
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))}
                placeholder={editando ? '' : `${form.tipo === 'materia_prima' ? 'MP' : form.tipo === 'material_embalaje' ? 'ME' : 'PT'}-XXX (auto)`}
                disabled={!!editando}
              />
            </FormField>
          </div>

          <FormField label="Nombre" required>
            <Input
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Acetato de polivinilo 88%"
            />
          </FormField>

          <FormField label="Descripción">
            <Textarea
              rows={2}
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              placeholder="Descripción opcional…"
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Unidad de medida" required>
              <Select
                value={form.unidad_medida}
                onChange={(e) => setForm((f) => ({ ...f, unidad_medida: e.target.value }))}
              >
                {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </FormField>
            <FormField label="Precio coste (EUR)" hint="Precio de compra">
              <Input
                type="number" min="0" step="0.01"
                value={form.precio_unitario}
                onChange={(e) => setForm((f) => ({ ...f, precio_unitario: e.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Precio venta (EUR)" hint="Precio al cliente">
              <Input
                type="number" min="0" step="0.01"
                value={form.precio_venta}
                onChange={(e) => setForm((f) => ({ ...f, precio_venta: e.target.value }))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Stock mínimo" hint="Alerta si baja de aquí">
              <Input
                type="number" min="0" step="0.001"
                value={form.stock_minimo}
                onChange={(e) => setForm((f) => ({ ...f, stock_minimo: e.target.value }))}
              />
            </FormField>
            <FormField label="Stock máximo" hint="Referencia para % alerta">
              <Input
                type="number" min="0" step="0.001"
                value={form.stock_maximo}
                onChange={(e) => setForm((f) => ({ ...f, stock_maximo: e.target.value }))}
              />
            </FormField>
          </div>

          {(form.tipo === 'producto_envasado' || form.peso_unitario_kg) && (
            <FormField label="Peso por unidad (kg)" hint="Peso neto de cola por bote/garrafa/bidón">
              <Input
                type="number" min="0" step="0.001"
                value={form.peso_unitario_kg}
                onChange={(e) => setForm((f) => ({ ...f, peso_unitario_kg: e.target.value }))}
                placeholder="Ej: 5 (garrafa 5kg)"
              />
            </FormField>
          )}

          <FormField label="Caducidad automática (meses)" hint="Si se define, al crear lote se auto-calcula la fecha de caducidad">
            <Input
              type="number" min="0" step="1"
              value={form.caducidad_meses ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, caducidad_meses: e.target.value }))}
              placeholder="Ej: 36 (3 años)"
            />
          </FormField>

          {editando && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 space-y-3">
              <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">Ajuste de stock</p>
              <FormField label="Stock actual" hint="Modificar genera un ajuste de stock auditado">
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="0" step="0.001"
                    value={form.stock_actual}
                    onChange={(e) => setForm((f) => ({ ...f, stock_actual: e.target.value }))}
                  />
                  <span className="text-sm text-gray-500 bg-gray-100 rounded-lg px-3 py-2.5 whitespace-nowrap">
                    {form.unidad_medida}
                  </span>
                </div>
              </FormField>
              <FormField label="Lote afectado" hint={loadingEditLotes ? 'Cargando lotes…' : editLotes.length === 0 ? 'Sin lotes disponibles' : 'Solo lotes aprobados con stock'}>
                <Select
                  value={editLoteId}
                  onChange={(e) => setEditLoteId(e.target.value)}
                  disabled={loadingEditLotes || editLotes.length === 0}
                >
                  <option value="">— Sin lote específico —</option>
                  {editLotes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lote_interno}{l.lote_proveedor ? ` · ${l.lote_proveedor}` : ''} — {parseFloat(l.cantidad_actual).toLocaleString('es-ES', { maximumFractionDigits: 2 })} {form.unidad_medida}{l.fecha_caducidad ? ` (cad. ${l.fecha_caducidad})` : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          )}

          {editando && editLotes.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Lotes</p>
              {editLotes.map((l, i) => {
                const qty = parseFloat(l.cantidad_actual);
                const agotado = qty <= 0;
                return (
                  <div key={i} className={clsx('flex items-center gap-2 text-xs rounded-lg px-2 py-1.5', agotado ? 'opacity-30' : 'bg-white border border-gray-100')}>
                    <span className="font-mono text-gray-600 flex-1 truncate">{l.lote_interno}</span>
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
                    <span className="text-gray-400 text-[10px]">{form.unidad_medida}</span>
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
                  const { data } = await productosApi.importar(parsed);
                  const d = data as { ok: boolean; creados: number };
                  setImportResult(`${d.creados} producto(s) importado(s) correctamente.`);
                  cargar();
                } catch (err: unknown) {
                  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                  setImportResult(msg ?? (err instanceof SyntaxError ? 'JSON invalido — revisa la sintaxis' : 'Error al importar'));
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
    producto_fabricado: { label: 'Fabricado',         cls: 'bg-loga-red/10 text-loga-red' },
    producto_envasado:  { label: 'Envasado',          cls: 'bg-emerald-100 text-emerald-700' },
    material_embalaje:  { label: 'Embalaje',          cls: 'bg-gray-100 text-gray-600'   },
  };
  const { label, cls } = cfg[tipo] ?? { label: tipo, cls: 'bg-gray-100 text-gray-600' };
  return <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', cls)}>{label}</span>;
}
