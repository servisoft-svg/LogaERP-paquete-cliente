import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Pencil, Trash2, ChefHat, Search, FlaskConical,
  ChevronDown, ChevronRight, X, Check, Play, Copy, Upload, Beaker, GripVertical, Clock,
} from 'lucide-react';
import { recetasApi, productosApi } from '../api/client';
import SearchSelect from '../components/SearchSelect';
import type { Receta, IngredienteReceta, Producto, PasoReceta } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import Modal from '../components/Modal';
import { FormField, Input, Select, Textarea } from '../components/FormField';
import ReactorVisualization from '../components/ReactorVisualization';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from '../components/ToastFields';

import clsx from 'clsx';

interface FormIngrediente {
  materia_prima_id: string;
  // Si el operario escribe un nombre que no existe, lo guardamos aquí. Al
  // submitir, creamos la MP primero y usamos su id en ingredientes_receta.
  materia_prima_nueva_nombre?: string;
  cantidad: string;
  porcentaje_merma: string;
  unidad_medida: string;
}

interface FormReceta {
  nombre: string;
  producto_id: string;
  // Si el operario teclea un nombre que no existe, lo guardamos aquí. Al
  // submitir, creamos el producto fabricado con auto-código y usamos su id.
  producto_nuevo_nombre?: string;
  rendimiento: string;
  notas: string;
  ph_min: string;
  ph_max: string;
  solidos_min: string;
  solidos_max: string;
  viscosidad_min: string;
  viscosidad_max: string;
  pasos: PasoReceta[];
  tipo_receta: 'fabricacion' | 'envasado';
  // Ingredientes a crear inline al guardar (solo se usa al CREAR — al editar
  // se gestionan vía endpoints separados desde el panel de "ingredientes").
  ingredientes?: FormIngrediente[];
}

interface FormIng {
  materia_prima_id: string;
  cantidad: string;
  porcentaje_merma: string;
  unidad_medida: string;
  paso_index: string; // '' = sin asignar, o '0', '1', ... índice del paso
}

const EMPTY_RECETA: FormReceta = {
  nombre: '', producto_id: '', producto_nuevo_nombre: '',
  rendimiento: '', notas: '',
  ph_min: '', ph_max: '', solidos_min: '', solidos_max: '',
  viscosidad_min: '', viscosidad_max: '', pasos: [], tipo_receta: 'fabricacion',
  ingredientes: [],
};

const EMPTY_PASO: PasoReceta = {
  fase: 'Preparación',
  titulo: '',
  descripcion: '',
  temperatura: '',
  duracion_min: 3,
  ingredientes_ids: [],
  color: '',
};

const FASES = ['Preparación', 'Reacción', 'Aditivos', 'Enfriamiento', 'Control', 'Limpieza'];

const EMPTY_ING: FormIng = {
  materia_prima_id: '', cantidad: '', porcentaje_merma: '0', unidad_medida: 'kg', paso_index: '',
};

const esAguaMP = (nombre?: string | null) => /\bagua\b/i.test(nombre ?? '');

const EJEMPLO_IMPORTAR_RECETAS = JSON.stringify({
  recetas: [
    {
      nombre: "Cola Blanca Standard",
      rendimiento: 1000,
      notas: "Proceso a 80 grados",
      ingredientes: [
        { materia_prima_nombre: "Acetato de Vinilo (VAM)", cantidad: 460, porcentaje_merma: 2, unidad_medida: "kg" },
        { materia_prima_nombre: "Agua Desmineralizada", cantidad: 390, porcentaje_merma: 0, unidad_medida: "L" },
        { materia_prima_nombre: "PVOH Mowiol 4-88", cantidad: 30, porcentaje_merma: 1, unidad_medida: "kg" },
      ],
    },
  ],
}, null, 2);

export default function Recetas() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [recetas, setRecetas]               = useState<Receta[]>([]);
  const [productos, setProductos]           = useState<Producto[]>([]);
  const [loading, setLoading]               = useState(true);
  const [busqueda, setBusqueda]             = useState('');
  const [tabActivo] = useState<'fabricacion' | 'envasado'>('fabricacion');
  const [expandida, setExpandida]           = useState<string | null>(null);
  const [recetaDetalle, setRecetaDetalle]   = useState<Receta | null>(null);

  // Modal receta
  const [modalReceta, setModalReceta]       = useState(false);
  const [editandoReceta, setEditandoReceta] = useState<Receta | null>(null);
  // Confirmación de cambios antes de guardar (solo al editar). Si está null,
  // no hay pendiente; si es array (incluso vacío), se muestra el modal.
  const [confirmCambios, setConfirmCambios] = useState<{ campo: string; antes: string; despues: string }[] | null>(null);
  // Histórico de versiones de receta (modal). null = cerrado.
  const [historialRec, setHistorialRec] = useState<{ recetaId: string; recetaNombre: string; items: any[] | null }>({ recetaId: '', recetaNombre: '', items: null });
  const [formReceta, setFormReceta]         = useState<FormReceta>(EMPTY_RECETA);
  const [savingReceta, setSavingReceta]     = useState(false);
  const [errorReceta, setErrorReceta]       = useState('');

  // Modal ingrediente
  const [modalIng, setModalIng]             = useState(false);
  const [editandoIng, setEditandoIng]       = useState<IngredienteReceta | null>(null);
  const [formIng, setFormIng]               = useState<FormIng>(EMPTY_ING);
  const [savingIng, setSavingIng]           = useState(false);
  const [errorIng, setErrorIng]             = useState('');
  const [busqIng, setBusqIng]              = useState('');

  // Modal importar JSON
  const [modalImportar, setModalImportar]   = useState(false);
  const [importJson, setImportJson]         = useState(EJEMPLO_IMPORTAR_RECETAS);
  const [importResult, setImportResult]     = useState<string | null>(null);
  const [importing, setImporting]           = useState(false);

  const productosEnvasados = productos.filter(p => p.tipo === 'producto_envasado' && p.activo);
  const colasFabricadas = productos.filter(p => p.tipo === 'producto_fabricado' && p.activo);
  const materialesEmbalaje = productos.filter(p => p.tipo === 'material_embalaje' && p.activo);

  // Envasado recipe modal
  const [modalEnv, setModalEnv] = useState(false);
  const [editandoEnv, setEditandoEnv] = useState<Receta | null>(null);
  const [envRecForm, setEnvRecForm] = useState({ nombre: '', producto_id: '', producto_nuevo_nombre: '', cola_id: '', envase_id: '', envase_nuevo_nombre: '', materiales: [] as { producto_id: string; cantidad: string }[] });
  const [savingEnv, setSavingEnv] = useState(false);

  const abrirNuevaEnvasado = () => {
    setEditandoEnv(null);
    setEnvRecForm({ nombre: '', producto_id: '', producto_nuevo_nombre: '', cola_id: '', envase_id: '', envase_nuevo_nombre: '', materiales: [] });
    setModalEnv(true);
  };

  const abrirEditarEnvasado = async (r: Receta) => {
    const res = await recetasApi.obtener(r.id);
    const det = res.data as Receta;
    const ings = det.ingredientes ?? [];
    // Parse ingredients: cola = producto_fabricado, envase = first material_embalaje, rest = materials
    const colaIng = ings.find(i => {
      const p = productos.find(pp => pp.id === i.materia_prima_id);
      return p?.tipo === 'producto_fabricado';
    });
    const envaseIng = ings.find(i => {
      const p = productos.find(pp => pp.id === i.materia_prima_id);
      return p?.tipo === 'material_embalaje';
    });
    const otrosMats = ings.filter(i => {
      const p = productos.find(pp => pp.id === i.materia_prima_id);
      return p?.tipo === 'material_embalaje' && i.id !== envaseIng?.id;
    });
    setEditandoEnv(det);
    setEnvRecForm({
      nombre: det.nombre,
      producto_id: det.producto_id ?? '',
      producto_nuevo_nombre: '',
      cola_id: colaIng?.materia_prima_id ?? '',
      envase_id: envaseIng?.materia_prima_id ?? '',
      envase_nuevo_nombre: '',
      materiales: otrosMats.map(m => ({ producto_id: m.materia_prima_id, cantidad: String(m.cantidad ?? '1') })),
    });
    setModalEnv(true);
  };

  const guardarEnvasadoReceta = async () => {
    const tieneProductoOExiste = envRecForm.producto_id || envRecForm.producto_nuevo_nombre.trim();
    const tieneEnvaseOExiste = envRecForm.envase_id || envRecForm.envase_nuevo_nombre.trim();
    if (!tieneProductoOExiste || !envRecForm.cola_id || !tieneEnvaseOExiste) return;
    setSavingEnv(true);
    const ejecutar = async () => {
      // Si el usuario tipeó un nombre nuevo (sin seleccionar existente), creamos el producto.
      // Backend auto-genera código PE-XXX al ser tipo='producto_envasado'.
      let productoFinalId = envRecForm.producto_id;
      if (!productoFinalId && envRecForm.producto_nuevo_nombre.trim()) {
        const created = await productosApi.crear({
          nombre: envRecForm.producto_nuevo_nombre.trim(),
          tipo: 'producto_envasado',
          unidad_medida: 'ud',
        });
        productoFinalId = (created.data as { id: string }).id;
      }

      // Igual para el envase: si tipeó un nombre nuevo, crear material_embalaje.
      let envaseId = envRecForm.envase_id;
      if (!envaseId && envRecForm.envase_nuevo_nombre.trim()) {
        const createdEnv = await productosApi.crear({
          nombre: envRecForm.envase_nuevo_nombre.trim(),
          tipo: 'material_embalaje',
          unidad_medida: 'ud',
        });
        envaseId = (createdEnv.data as { id: string }).id;
      }

      const prodFinal = productos.find(p => p.id === productoFinalId)
        ?? { nombre: envRecForm.producto_nuevo_nombre.trim() };
      const nombre = envRecForm.nombre || `Envasado ${prodFinal.nombre ?? ''}`;

      const ingredientes = [
        { materia_prima_id: envRecForm.cola_id, cantidad: 1, porcentaje_merma: 0, unidad_medida: 'kg' },
        { materia_prima_id: envaseId, cantidad: 1, porcentaje_merma: 0, unidad_medida: 'ud' },
        ...envRecForm.materiales.filter(m => m.producto_id).map(m => ({
          materia_prima_id: m.producto_id, cantidad: parseFloat(m.cantidad) || 1, porcentaje_merma: 0, unidad_medida: 'ud',
        })),
      ];
      if (editandoEnv) {
        await recetasApi.editar(editandoEnv.id, { nombre, producto_id: productoFinalId, rendimiento: 1, tipo_receta: 'envasado' });
        for (const ing of (editandoEnv.ingredientes ?? [])) {
          await recetasApi.eliminarIngrediente(editandoEnv.id, ing.id);
        }
        for (const ing of ingredientes) {
          await recetasApi.addIngrediente(editandoEnv.id, ing);
        }
      } else {
        const res = await recetasApi.crear({ nombre, producto_id: productoFinalId, rendimiento: 1, tipo_receta: 'envasado' });
        const nueva = res.data as Receta;
        for (const ing of ingredientes) {
          await recetasApi.addIngrediente(nueva.id, ing);
        }
      }
      await productosApi.editar(productoFinalId, { granel_id: envRecForm.cola_id } as never);
      return { nombre };
    };
    try {
      await notify.promise(ejecutar(), {
        loading: editandoEnv ? 'Guardando receta…' : 'Creando receta…',
        success: editandoEnv ? 'Receta guardada' : 'Receta creada',
        successDesc: (d) => d.nombre,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo guardar la receta',
      });
      setModalEnv(false);
      cargar();
    } catch { /* notificado */ }
    finally { setSavingEnv(false); }
  };

  const eliminarEnvReceta = async (r: Receta) => {
    if (!confirm(`Eliminar receta "${r.nombre}"?`)) return;
    try {
      await notify.promise(recetasApi.eliminar(r.id), {
        loading: 'Eliminando…',
        success: 'Receta eliminada',
        successDesc: r.nombre,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo eliminar',
      });
      cargar();
    } catch { /* notificado */ }
  };

  const cargar = useCallback(async () => {
    try {
      const [recRes, prodRes] = await Promise.all([
        recetasApi.listar({ activa: 'true' }),
        productosApi.listar({ limit: '2000' }),
      ]);
      setRecetas(recRes.data as Receta[]);
      setProductos(prodRes.data as Producto[]);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Auto-abrir modal Nueva Receta Envasado si llega ?nuevaEnvasado=<producto_id>
  // (viene desde EnvasadoRapido cuando creó/usó un PE sin receta).
  useEffect(() => {
    if (loading) return; // esperar a que productos estén cargados
    const peId = searchParams.get('nuevaEnvasado');
    if (!peId) return;
    const cola = searchParams.get('cola') ?? '';
    const envase = searchParams.get('envase') ?? '';
    // Envasado vive ahora en /envasado (Escandallo). Si llega un deep link aquí,
    // redirigimos. La lógica de pre-rellenar se ejecuta en /envasado por su parte.
    setEditandoEnv(null);
    setEnvRecForm({
      nombre: '',
      producto_id: peId,
      producto_nuevo_nombre: '',
      cola_id: cola,
      envase_id: envase,
      envase_nuevo_nombre: '',
      materiales: [],
    });
    setModalEnv(true);
    // Limpiar query params para que no se reabra al recargar
    const next = new URLSearchParams(searchParams);
    next.delete('nuevaEnvasado'); next.delete('cola'); next.delete('envase');
    setSearchParams(next, { replace: true });
  }, [loading, searchParams, setSearchParams]);

  const cargarDetalle = useCallback(async (id: string) => {
    try {
      const res = await recetasApi.obtener(id);
      setRecetaDetalle(res.data as Receta);
    } catch { /* silencioso */ }
  }, []);

  const toggleExpand = (id: string) => {
    if (expandida === id) {
      setExpandida(null);
      setRecetaDetalle(null);
    } else {
      setExpandida(id);
      cargarDetalle(id);
    }
  };

  /* ---- Receta CRUD ---- */
  const abrirNuevaReceta = () => {
    setEditandoReceta(null);
    setFormReceta({ ...EMPTY_RECETA, tipo_receta: tabActivo });
    setErrorReceta('');
    setModalReceta(true);
  };

  const abrirEditarReceta = async (r: Receta) => {
    // Load full detail to get pasos + ingredientes
    let detalle = r;
    try {
      const res = await recetasApi.obtener(r.id);
      detalle = res.data as Receta;
      setRecetaDetalle(detalle);
    } catch { /* use r as fallback */ }
    setEditandoReceta(detalle);
    setFormReceta({
      nombre: detalle.nombre,
      producto_id: detalle.producto_id,
      rendimiento: detalle.rendimiento ?? '',
      notas: detalle.notas ?? '',
      ph_min: detalle.ph_min ?? '',
      ph_max: detalle.ph_max ?? '',
      solidos_min: detalle.solidos_min ?? '',
      solidos_max: detalle.solidos_max ?? '',
      viscosidad_min: detalle.viscosidad_min ?? '',
      viscosidad_max: detalle.viscosidad_max ?? '',
      pasos: detalle.pasos ?? [],
      tipo_receta: detalle.tipo_receta ?? 'fabricacion',
    });
    setErrorReceta('');
    setModalReceta(true);
  };

  const guardarReceta = async () => {
    if (!formReceta.nombre.trim()) {
      setErrorReceta('El nombre es obligatorio');
      return;
    }
    // Validación rendimiento (sólo fabricación — envasado siempre rinde 1)
    if (formReceta.tipo_receta !== 'envasado') {
      const rNum = Number(formReceta.rendimiento);
      if (!formReceta.rendimiento || !Number.isFinite(rNum) || rNum <= 0) {
        setErrorReceta('No se puede crear una receta con rendimiento 0. Pon un valor mayor que 0.');
        return;
      }
    }
    // Si se está editando, calculamos un diff y pedimos confirmación antes de guardar.
    if (editandoReceta) {
      const o = editandoReceta;
      const f = formReceta;
      const fmt = (v: unknown) => (v == null || v === '' ? '—' : String(v));
      const ds: { campo: string; antes: string; despues: string }[] = [];
      const cmp = (campo: string, a: unknown, b: unknown) => {
        const sa = fmt(a); const sb = fmt(b);
        if (sa !== sb) ds.push({ campo, antes: sa, despues: sb });
      };
      cmp('Nombre', o.nombre, f.nombre.trim());
      cmp('Tipo', o.tipo_receta ?? 'fabricacion', f.tipo_receta);
      if (f.tipo_receta !== 'envasado') {
        cmp('Rendimiento', o.rendimiento, f.rendimiento);
      }
      cmp('Notas', o.notas ?? '', f.notas);
      cmp('pH min', o.ph_min ?? '', f.ph_min);
      cmp('pH max', o.ph_max ?? '', f.ph_max);
      cmp('Sólidos min', o.solidos_min ?? '', f.solidos_min);
      cmp('Sólidos max', o.solidos_max ?? '', f.solidos_max);
      cmp('Viscosidad min', o.viscosidad_min ?? '', f.viscosidad_min);
      cmp('Viscosidad max', o.viscosidad_max ?? '', f.viscosidad_max);
      // Pasos: comparación por JSON (cuenta cualquier modificación de orden/contenido)
      const oPasos = JSON.stringify(o.pasos ?? []);
      const fPasos = JSON.stringify(f.pasos ?? []);
      if (oPasos !== fPasos) {
        ds.push({ campo: 'Pasos', antes: `${(o.pasos ?? []).length} pasos`, despues: `${(f.pasos ?? []).length} pasos (modificados)` });
      }
      if (ds.length === 0) {
        notify.info('Sin cambios');
        return;
      }
      setConfirmCambios(ds);
      return;
    }
    // Crear receta nueva: directo, sin confirmación
    ejecutarGuardadoReceta();
  };

  const ejecutarGuardadoReceta = async () => {
    setSavingReceta(true);
    setErrorReceta('');
    const qcFields: Record<string, number> = {};
    if (formReceta.ph_min) qcFields.ph_min = Number(formReceta.ph_min);
    if (formReceta.ph_max) qcFields.ph_max = Number(formReceta.ph_max);
    if (formReceta.solidos_min) qcFields.solidos_min = Number(formReceta.solidos_min);
    if (formReceta.solidos_max) qcFields.solidos_max = Number(formReceta.solidos_max);
    if (formReceta.viscosidad_min) qcFields.viscosidad_min = Number(formReceta.viscosidad_min);
    if (formReceta.viscosidad_max) qcFields.viscosidad_max = Number(formReceta.viscosidad_max);

    const productoNombre = productos.find(p => p.id === formReceta.producto_id)?.nombre;
    const numPasos = formReceta.pasos?.length ?? 0;
    const hasQC = Object.keys(qcFields).length > 0;

    const ejecutar = async () => {
      let id = editandoReceta?.id;
      if (editandoReceta) {
        await recetasApi.editar(editandoReceta.id, {
          nombre: formReceta.nombre.trim(),
          producto_id: formReceta.producto_id || undefined,
          rendimiento: formReceta.rendimiento ? Number(formReceta.rendimiento) : undefined,
          notas: formReceta.notas || undefined,
          pasos: formReceta.pasos,
          tipo_receta: formReceta.tipo_receta,
          ...qcFields,
        });
      } else {
        // Si el usuario escribió un nombre NUEVO en el combo, creamos primero
        // el producto_fabricado y usamos su id para la receta.
        let productoIdFinal = formReceta.producto_id;
        if (!productoIdFinal && formReceta.producto_nuevo_nombre?.trim() && formReceta.tipo_receta === 'fabricacion') {
          const created = await productosApi.crear({
            nombre: formReceta.producto_nuevo_nombre.trim(),
            tipo: 'producto_fabricado',
            unidad_medida: 'kg',
          } as never);
          productoIdFinal = (created.data as { id: string }).id;
        }
        // Ingredientes añadidos inline en la creación. Para los que el operario
        // tecleó un nombre nuevo (materia_prima_nueva_nombre), creamos la MP
        // primero y luego usamos su id. Filtramos incompletos.
        const rawIngs = (formReceta.ingredientes ?? []).filter(i =>
          (i.materia_prima_id || i.materia_prima_nueva_nombre?.trim()) && i.cantidad && Number(i.cantidad) > 0
        );
        const ingredientesInline: Array<{ materia_prima_id: string; cantidad: number; porcentaje_merma: number; unidad_medida: string }> = [];
        for (const i of rawIngs) {
          let mpId = i.materia_prima_id;
          if (!mpId && i.materia_prima_nueva_nombre?.trim()) {
            const created = await productosApi.crear({
              nombre: i.materia_prima_nueva_nombre.trim(),
              tipo: 'materia_prima',
              unidad_medida: i.unidad_medida || 'kg',
            } as never);
            mpId = (created.data as { id: string }).id;
          }
          ingredientesInline.push({
            materia_prima_id: mpId,
            cantidad: Number(i.cantidad),
            porcentaje_merma: Number(i.porcentaje_merma || 0),
            unidad_medida: i.unidad_medida || 'kg',
          });
        }
        const res = await recetasApi.crear({
          nombre: formReceta.nombre.trim(),
          producto_id: productoIdFinal || undefined,
          rendimiento: formReceta.tipo_receta === 'envasado' ? 1 : (formReceta.rendimiento ? Number(formReceta.rendimiento) : undefined),
          notas: formReceta.notas || undefined,
          pasos: formReceta.pasos,
          tipo_receta: formReceta.tipo_receta,
          ingredientes: ingredientesInline.length > 0 ? ingredientesInline : undefined,
          ...qcFields,
        } as never);
        id = (res.data as { id?: string })?.id;
      }
      return { id, nombre: formReceta.nombre.trim() };
    };
    try {
      await notify.promise(ejecutar(), {
        loading: editandoReceta ? 'Guardando receta…' : 'Creando receta…',
        success: editandoReceta ? 'Receta guardada' : 'Receta creada',
        successDesc: () => (
          <>
            <ToastBlock title={formReceta.nombre.trim()}>
              <ToastField label="Tipo" value={formReceta.tipo_receta === 'envasado' ? 'Envasado' : 'Fabricación'} />
              <ToastField label="Producto" value={productoNombre} span={2} />
              <ToastField
                label="Rendimiento"
                value={formReceta.tipo_receta !== 'envasado' && formReceta.rendimiento ? `${Number(formReceta.rendimiento).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg/tanda` : ''}
              />
              <ToastField label="Pasos definidos" value={numPasos > 0 ? numPasos : ''} />
              <ToastField label="Control de calidad" value={hasQC ? 'Activo' : ''} />
            </ToastBlock>
            {!editandoReceta && (
              <div className="text-[11px] italic text-gray-400 mt-1">Añade ingredientes para que esté lista para fabricar.</div>
            )}
          </>
        ),
        successButton: !editandoReceta ? {
          title: 'Añadir ingredientes',
          onClick: (data) => {
            if (data?.id) {
              setExpandida(data.id);
              cargarDetalle(data.id);
              setTimeout(() => abrirNuevoIng(), 200);
            }
          },
        } : undefined,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar',
      });
      setModalReceta(false);
      cargar();
      if (expandida) cargarDetalle(expandida);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorReceta(msg ?? 'Error al guardar');
    } finally {
      setSavingReceta(false);
    }
  };

  const eliminarReceta = async (r: Receta) => {
    if (!confirm(`Desactivar receta "${r.nombre}"?`)) return;
    try {
      await notify.promise(recetasApi.eliminar(r.id), {
        loading: 'Desactivando…',
        success: 'Receta desactivada',
        successDesc: r.nombre,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo desactivar',
      });
      cargar();
      if (expandida === r.id) {
        setExpandida(null);
        setRecetaDetalle(null);
      }
    } catch { /* notificado */ }
  };

  const duplicarReceta = async (r: Receta) => {
    const ejecutar = async () => {
      const detRes = await recetasApi.obtener(r.id);
      const detalle = detRes.data as Receta;
      const qcFields: Record<string, number> = {};
      if (detalle.ph_min) qcFields.ph_min = Number(detalle.ph_min);
      if (detalle.ph_max) qcFields.ph_max = Number(detalle.ph_max);
      if (detalle.solidos_min) qcFields.solidos_min = Number(detalle.solidos_min);
      if (detalle.solidos_max) qcFields.solidos_max = Number(detalle.solidos_max);
      if (detalle.viscosidad_min) qcFields.viscosidad_min = Number(detalle.viscosidad_min);
      if (detalle.viscosidad_max) qcFields.viscosidad_max = Number(detalle.viscosidad_max);

      const nuevaRes = await recetasApi.crear({
        nombre: detalle.nombre + ' (copia)',
        producto_id: detalle.producto_id || undefined,
        rendimiento: detalle.rendimiento ? Number(detalle.rendimiento) : undefined,
        notas: detalle.notas || undefined,
        pasos: detalle.pasos ?? [],
        ...qcFields,
      });
      const nueva = nuevaRes.data as Receta;
      for (const ing of (detalle.ingredientes ?? [])) {
        await recetasApi.addIngrediente(nueva.id, {
          materia_prima_id: ing.materia_prima_id,
          cantidad: Number(ing.cantidad),
          porcentaje_merma: Number(ing.porcentaje_merma) || 0,
          unidad_medida: ing.unidad_medida,
        });
      }
      return { nombre: nueva.nombre };
    };
    try {
      await notify.promise(ejecutar(), {
        loading: 'Duplicando receta…',
        success: 'Receta duplicada',
        successDesc: (d) => d.nombre,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo duplicar',
      });
      cargar();
    } catch { /* notificado */ }
  };

  /* ---- Ingredientes CRUD ---- */
  const abrirNuevoIng = () => {
    setEditandoIng(null);
    setFormIng(EMPTY_ING);
    setErrorIng('');
    setModalIng(true);
  };

  const abrirEditarIng = (ing: IngredienteReceta) => {
    setEditandoIng(ing);
    setFormIng({
      materia_prima_id: ing.materia_prima_id,
      cantidad: ing.cantidad,
      porcentaje_merma: ing.porcentaje_merma ?? '0',
      unidad_medida: ing.unidad_medida,
      paso_index: (ing as any).paso_index != null ? String((ing as any).paso_index) : '',
    });
    setErrorIng('');
    setModalIng(true);
  };

  const guardarIng = async () => {
    if (!formIng.materia_prima_id || !formIng.cantidad) {
      setErrorIng('Materia prima y cantidad son obligatorias');
      return;
    }
    if (!expandida) return;
    const mermaNum = Number(formIng.porcentaje_merma) || 0;
    if (mermaNum < 0 || mermaNum > 100) {
      setErrorIng('La merma debe estar entre 0 y 100 %');
      return;
    }
    if (mermaNum > 50) {
      const ok = window.confirm(
        `Has puesto una merma de ${mermaNum}%, parece muy alta. ¿Es correcto?\n\n` +
        `(la merma habitual es < 5%; >50% significa que se desperdicia más de la mitad de la materia prima al fabricar)`
      );
      if (!ok) return;
    }
    setSavingIng(true);
    setErrorIng('');
    const expandidaId = expandida;
    // Detectar si el MP es agua → permitir múltiples filas en la receta
    const prodSel = productos.find(p => p.id === formIng.materia_prima_id);
    const aguaSel = esAguaMP(prodSel?.nombre);
    const pasoIdxNum = formIng.paso_index !== '' ? Number(formIng.paso_index) : null;
    const payload: any = {
      materia_prima_id: formIng.materia_prima_id,
      cantidad: Number(formIng.cantidad),
      porcentaje_merma: Number(formIng.porcentaje_merma) || 0,
      unidad_medida: formIng.unidad_medida,
      paso_index: pasoIdxNum,
    };
    // Si el MP es agua y estamos creando (no editando), permitimos duplicado en BD.
    if (aguaSel && !editandoIng) {
      payload.permitir_duplicado = true;
    }
    const ejecutar = async () => {
      if (editandoIng) {
        await recetasApi.editarIngrediente(expandidaId, editandoIng.id, payload);
      } else {
        await recetasApi.addIngrediente(expandidaId, payload);
      }
    };
    try {
      await notify.promise(ejecutar(), {
        loading: editandoIng ? 'Guardando ingrediente…' : 'Añadiendo ingrediente…',
        success: editandoIng ? 'Ingrediente guardado' : 'Ingrediente añadido',
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar ingrediente',
      });
      setModalIng(false);
      cargarDetalle(expandidaId);
      cargar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErrorIng(msg ?? 'Error al guardar ingrediente');
    } finally {
      setSavingIng(false);
    }
  };

  const eliminarIng = async (ing: IngredienteReceta) => {
    if (!expandida) return;
    if (!confirm(`Eliminar ingrediente "${ing.nombre_mp}"?`)) return;
    const expandidaId = expandida;
    try {
      await notify.promise(recetasApi.eliminarIngrediente(expandidaId, ing.id), {
        loading: 'Eliminando ingrediente…',
        success: 'Ingrediente eliminado',
        successDesc: ing.nombre_mp,
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo eliminar',
      });
      cargarDetalle(expandidaId);
      cargar();
    } catch { /* notificado */ }
  };

  const [soloConStock, setSoloConStock] = useState(false);

  /* ---- Filtrado ---- */
  const recetasFiltradas = recetas
    .filter(r => (r.tipo_receta ?? 'fabricacion') === tabActivo)
    .filter(r => !soloConStock || parseInt(r.ingredientes_sin_stock ?? '0', 10) === 0)
    .filter(r => {
      if (!busqueda) return true;
      const q = busqueda.toLowerCase();
      // Buscar por cualquier palabra parcial
      return r.nombre.toLowerCase().includes(q)
        || r.producto_nombre?.toLowerCase().includes(q)
        || r.nombre.toLowerCase().split(/[\s—\-]+/).some(w => w.includes(q));
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
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Fórmulas</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {recetas.length} fórmula{recetas.length !== 1 ? 's' : ''} activa{recetas.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setImportJson(EJEMPLO_IMPORTAR_RECETAS); setImportResult(null); setModalImportar(true); }}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
          >
            <Upload size={16} /> Importar
          </button>
          <button
            onClick={abrirNuevaReceta}
            className="flex items-center gap-2 rounded-lg bg-loga-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
          >
            <Plus size={16} /> Nueva Fórmula
          </button>
        </div>
      </div>

      {/* Tab Envasado eliminada — Envasado tiene su propia pestaña "Escandallo" en el navbar. */}

      {/* Busqueda + filtro stock */}
      {tabActivo === 'fabricacion' && <div className="flex items-center gap-2">
        <div className="relative flex-1 sm:flex-none">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar receta..."
            className="pl-8 w-full sm:w-64"
          />
        </div>
        <button
          onClick={() => setSoloConStock(!soloConStock)}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap',
            soloConStock
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
          )}
        >
          <Check size={12} />
          Solo con stock
        </button>
      </div>}

      {/* Envasado tab — recetas de envasado */}
      {tabActivo === 'envasado' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 sm:flex-none">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar..." className="pl-8 w-full sm:w-64" />
            </div>
            <button onClick={abrirNuevaEnvasado}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm">
              <Plus size={16} /> Nueva receta
            </button>
          </div>

          {/* Recetas de envasado existentes */}
          {(() => {
            const recEnv = recetas.filter(r => r.tipo_receta === 'envasado').filter(r => {
              if (!busqueda) return true;
              const q = busqueda.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              return r.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q)
                || (r.producto_nombre ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q);
            });
            return recEnv.length > 0 ? (
              <div className="space-y-2">
                {recEnv.map(r => {
                  const prod = productos.find(p => p.id === r.producto_id);
                  const cola = prod?.granel_id ? productos.find(p => p.id === prod.granel_id) : null;
                  const stockCola = parseFloat(cola?.stock_actual ?? '0');
                  // Unidades máximas fabricables — viene del backend, calcula
                  // floor(MIN(stock_mp / cantidad_por_unidad)) sobre TODOS los
                  // ingredientes (cola + envase + materiales extra). El cuello
                  // de botella decide el límite.
                  const maxFabricable = r.max_producible != null ? parseInt(r.max_producible, 10) : null;
                  return (
                    <div key={r.id} className="rounded-xl border border-gray-100 bg-white shadow-sm p-4 flex items-center gap-4 hover:border-emerald-200 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-gray-900 truncate">{r.nombre}</p>
                          <button
                            type="button"
                            onClick={async () => {
                              setHistorialRec({ recetaId: r.id, recetaNombre: r.nombre, items: null });
                              try {
                                const { data } = await recetasApi.historial(r.id);
                                setHistorialRec({ recetaId: r.id, recetaNombre: r.nombre, items: data as any[] });
                              } catch {
                                setHistorialRec({ recetaId: r.id, recetaNombre: r.nombre, items: [] });
                              }
                            }}
                            className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-700 px-2 py-0.5 text-xs font-bold font-mono hover:bg-emerald-200 cursor-pointer"
                            title="Ver historial de versiones · pulsa para abrir"
                          >
                            v{r.version}
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                          <span className="text-[11px] text-gray-500">Producto: <b className="text-gray-800">{prod?.nombre ?? '—'}</b></span>
                          <span className="text-[11px] text-gray-500">Cola: <b className="text-loga-red">{cola?.nombre ?? '—'}</b> <span className="text-gray-400">({stockCola.toLocaleString('es-ES', { maximumFractionDigits: 1 })} kg)</span></span>
                          {prod && <span className={clsx('text-[11px] font-bold tabular-nums', parseFloat(prod.stock_actual) > 0 ? 'text-emerald-600' : 'text-gray-300')}>{parseFloat(prod.stock_actual).toLocaleString('es-ES')} ud</span>}
                          {maxFabricable !== null && (
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums border',
                                maxFabricable > 0
                                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                                  : 'bg-gray-50 border-gray-200 text-gray-400'
                              )}
                              title="Cuello de botella considerando cola + envase + materiales extra de la receta"
                            >
                              Puedo envasar: {maxFabricable.toLocaleString('es-ES')} ud
                            </span>
                          )}
                          {r.updated_at && (() => {
                            const ts = new Date(r.updated_at);
                            const fechaCorta = ts.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
                            const horaCorta = ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                            const editada = r.created_at && Math.abs(new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) > 1000;
                            return (
                              <span className="flex items-center gap-1 text-[11px] text-gray-400" title={`Última edición: ${ts.toLocaleString('es-ES')}`}>
                                <Clock size={11} /> {editada ? 'Editada' : 'Creada'} {fechaCorta} {horaCorta}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <button onClick={() => abrirEditarEnvasado(r)} className="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => eliminarEnvReceta(r)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"><Trash2 size={14} /></button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-4 py-12 text-center">
                <Beaker size={32} className="mx-auto mb-2 text-gray-200" />
                <p className="text-sm text-gray-400">Sin recetas de envasado. Crea una para definir que cola y materiales lleva cada producto.</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Modal receta envasado */}
      {modalEnv && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setModalEnv(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-emerald-50 to-white border-b border-emerald-100 shrink-0">
              <div>
                <p className="text-sm font-bold text-gray-900">{editandoEnv ? 'Editar' : 'Nueva'} receta de envasado</p>
                <p className="text-[10px] text-gray-400">Define producto, cola y materiales</p>
              </div>
              <button onClick={() => setModalEnv(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={15} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <FormField label="Nombre de la receta" required>
                <Input value={envRecForm.nombre} onChange={e => setEnvRecForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Logalkyl Bote 1kg" />
              </FormField>

              <div>
                <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">Producto final</label>
                {!envRecForm.producto_id && envRecForm.producto_nuevo_nombre ? (
                  <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase">Nuevo producto envasado</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">{envRecForm.producto_nuevo_nombre}</p>
                      <p className="text-[10px] text-gray-500">Se creará con código auto PE-XXX al guardar</p>
                    </div>
                    <button onClick={() => setEnvRecForm(f => ({ ...f, producto_nuevo_nombre: '' }))}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-100 hover:text-loga-red shrink-0"><X size={14} /></button>
                  </div>
                ) : envRecForm.producto_id ? (
                  <SearchSelect
                    options={productosEnvasados.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo }))}
                    value={envRecForm.producto_id}
                    onChange={id => {
                      if (!id) { setEnvRecForm(f => ({ ...f, producto_id: '', producto_nuevo_nombre: '' })); return; }
                      const prod = productos.find(p => p.id === id);
                      setEnvRecForm(f => ({ ...f, producto_id: id, producto_nuevo_nombre: '', cola_id: prod?.granel_id ?? f.cola_id, nombre: f.nombre || `Envasado ${prod?.nombre ?? ''}` }));
                    }}
                    placeholder="Buscar producto envasado..."
                    selectedLabel={productos.find(p => p.id === envRecForm.producto_id)?.nombre}
                    selectedSub={productos.find(p => p.id === envRecForm.producto_id)?.codigo}
                  />
                ) : (
                  <ProductoFinalCombo
                    productos={productosEnvasados}
                    onSelectExistente={(prod) => setEnvRecForm(f => ({ ...f, producto_id: prod.id, producto_nuevo_nombre: '', cola_id: prod.granel_id ?? f.cola_id, nombre: f.nombre || `Envasado ${prod.nombre}` }))}
                    onCrearNuevo={(nombre) => setEnvRecForm(f => ({ ...f, producto_id: '', producto_nuevo_nombre: nombre, nombre: f.nombre || `Envasado ${nombre}` }))}
                  />
                )}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">Cola que lleva dentro</label>
                <SearchSelect
                  options={colasFabricadas.map(p => ({ id: p.id, label: p.nombre, sub: p.codigo, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')} kg` }))}
                  value={envRecForm.cola_id}
                  onChange={id => setEnvRecForm(f => ({ ...f, cola_id: id }))}
                  placeholder="Buscar cola granel..."
                  selectedLabel={productos.find(p => p.id === envRecForm.cola_id)?.nombre}
                  selectedRight={productos.find(p => p.id === envRecForm.cola_id) ? `${parseFloat(productos.find(p => p.id === envRecForm.cola_id)!.stock_actual).toLocaleString('es-ES')} kg` : undefined}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-1.5">Envase</label>
                {!envRecForm.envase_id && envRecForm.envase_nuevo_nombre ? (
                  <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase">Nuevo envase</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">{envRecForm.envase_nuevo_nombre}</p>
                      <p className="text-[10px] text-gray-500">Se creará como material de embalaje con código auto ME-XXX al guardar</p>
                    </div>
                    <button onClick={() => setEnvRecForm(f => ({ ...f, envase_nuevo_nombre: '' }))}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-100 hover:text-loga-red shrink-0"><X size={14} /></button>
                  </div>
                ) : envRecForm.envase_id ? (
                  <SearchSelect
                    options={materialesEmbalaje.map(p => ({ id: p.id, label: p.nombre, right: `${parseFloat(p.stock_actual).toLocaleString('es-ES')}` }))}
                    value={envRecForm.envase_id}
                    onChange={id => setEnvRecForm(f => ({ ...f, envase_id: id, envase_nuevo_nombre: '' }))}
                    placeholder="Buscar envase..."
                    selectedLabel={productos.find(p => p.id === envRecForm.envase_id)?.nombre}
                  />
                ) : (
                  <EnvaseCombo
                    materiales={materialesEmbalaje}
                    onSelectExistente={(p) => setEnvRecForm(f => ({ ...f, envase_id: p.id, envase_nuevo_nombre: '' }))}
                    onCrearNuevo={(nombre) => setEnvRecForm(f => ({ ...f, envase_id: '', envase_nuevo_nombre: nombre }))}
                  />
                )}
              </div>

              {/* Materiales extra */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Materiales extra</label>
                  <button onClick={() => setEnvRecForm(f => ({ ...f, materiales: [...f.materiales, { producto_id: '', cantidad: '1' }] }))}
                    className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800">+ Añadir</button>
                </div>
                {envRecForm.materiales.length === 0 && <p className="text-[10px] text-gray-300 italic">Sin materiales extra (cajas, etiquetas...)</p>}
                {envRecForm.materiales.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <div className="flex-1">
                      <SearchSelect
                        options={materialesEmbalaje.map(p => ({ id: p.id, label: p.nombre }))}
                        value={m.producto_id}
                        onChange={id => setEnvRecForm(f => ({ ...f, materiales: f.materiales.map((x, j) => j === i ? { ...x, producto_id: id } : x) }))}
                        placeholder="Material..."
                        selectedLabel={productos.find(p => p.id === m.producto_id)?.nombre}
                      />
                    </div>
                    <input type="number" min="1" value={m.cantidad}
                      onChange={e => setEnvRecForm(f => ({ ...f, materiales: f.materiales.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x) }))}
                      className="w-16 rounded-lg border border-gray-200 px-2 py-2 text-xs text-center outline-none" placeholder="Cant" />
                    <button onClick={() => setEnvRecForm(f => ({ ...f, materiales: f.materiales.filter((_, j) => j !== i) }))}
                      className="text-gray-400 hover:text-red-500 p-1"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <button onClick={() => setModalEnv(false)} className="text-sm text-gray-500 hover:text-gray-900">Cancelar</button>
              <button onClick={guardarEnvasadoReceta} disabled={savingEnv || (!envRecForm.producto_id && !envRecForm.producto_nuevo_nombre.trim()) || !envRecForm.cola_id || (!envRecForm.envase_id && !envRecForm.envase_nuevo_nombre.trim())}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-gray-300 transition-all">
                <Check size={16} /> {editandoEnv ? 'Guardar' : 'Crear receta'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Cards — fabricacion only */}
      {tabActivo === 'fabricacion' && <div className="space-y-3">
        <AnimatePresence>
          {recetasFiltradas.map((r, i) => {
            const sinStock = parseInt(r.ingredientes_sin_stock ?? '0', 10);
            const maxProd  = parseFloat(r.max_producible ?? '0');
            const isExpanded = expandida === r.id;

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: i * 0.03 }}
                className={clsx(
                  'rounded-xl border bg-white shadow-sm overflow-hidden',
                  sinStock === 0 ? 'border-l-4 border-l-emerald-500 border-gray-100' : 'border-l-4 border-l-loga-red border-gray-100'
                )}
              >
                {/* Card header */}
                <div className="px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <ChefHat size={16} className={sinStock === 0 ? 'text-emerald-500 shrink-0' : 'text-loga-red shrink-0'} />
                        <h3 className="font-semibold text-gray-900 truncate">{r.nombre}</h3>
                        <button
                          type="button"
                          onClick={async () => {
                            setHistorialRec({ recetaId: r.id, recetaNombre: r.nombre, items: null });
                            try {
                              const { data } = await recetasApi.historial(r.id);
                              setHistorialRec({ recetaId: r.id, recetaNombre: r.nombre, items: data as any[] });
                            } catch {
                              setHistorialRec({ recetaId: r.id, recetaNombre: r.nombre, items: [] });
                            }
                          }}
                          className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-loga-red/10 border border-loga-red/30 text-loga-red px-2 py-0.5 text-xs font-bold font-mono hover:bg-loga-red/20 cursor-pointer"
                          title="Ver historial de versiones · pulsa para abrir"
                        >
                          v{r.version}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
                        {r.producto_nombre && (
                          <span className="flex items-center gap-1">
                            <FlaskConical size={12} /> {r.producto_nombre}
                          </span>
                        )}
                        {r.rendimiento && (
                          <span>Rend: {parseFloat(r.rendimiento).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {r.unidad_medida}</span>
                        )}
                        <span>{r.num_ingredientes ?? 0} ingrediente{(parseInt(r.num_ingredientes ?? '0', 10)) !== 1 ? 's' : ''}</span>
                        {(r.pasos ?? []).length > 0 && (
                          <span className="flex items-center gap-1">
                            <Beaker size={12} /> {(r.pasos ?? []).length} paso{(r.pasos ?? []).length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {r.updated_at && (() => {
                          const ts = new Date(r.updated_at);
                          const fechaCorta = ts.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
                          const horaCorta = ts.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                          const editada = r.created_at && Math.abs(new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) > 1000;
                          return (
                            <span
                              className="flex items-center gap-1 text-gray-400"
                              title={`Última edición: ${ts.toLocaleString('es-ES')}\nCreada: ${r.created_at ? new Date(r.created_at).toLocaleString('es-ES') : '—'}`}
                            >
                              <Clock size={11} /> {editada ? 'Editada' : 'Creada'} {fechaCorta} {horaCorta}
                            </span>
                          );
                        })()}
                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {sinStock === 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[11px] font-medium">
                            <Check size={10} /> Stock OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-red-100 text-loga-red px-2 py-0.5 text-[11px] font-medium">
                            <X size={10} /> {sinStock} MP sin stock
                          </span>
                        )}
                        <span className={clsx(
                          'rounded-md px-2 py-0.5 text-[11px] font-medium',
                          maxProd > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                        )}>
                          Max: {maxProd > 0 ? maxProd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'} {r.unidad_medida}
                        </span>
                        {r.ph_min && r.ph_max && (
                          <span className="rounded-md bg-purple-100 text-purple-700 px-2 py-0.5 text-[11px] font-medium">
                            pH {r.ph_min}-{r.ph_max}
                          </span>
                        )}
                        {r.solidos_min && r.solidos_max && (
                          <span className="rounded-md bg-amber-100 text-amber-700 px-2 py-0.5 text-[11px] font-medium">
                            Sol {r.solidos_min}-{r.solidos_max}%
                          </span>
                        )}
                        {r.viscosidad_min && r.viscosidad_max && (
                          <span className="rounded-md bg-cyan-100 text-cyan-700 px-2 py-0.5 text-[11px] font-medium">
                            Visc {r.viscosidad_min}-{r.viscosidad_max}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => navigate(`/produccion?receta_id=${r.id}`)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                        title="Fabricar"
                      >
                        <Play size={14} />
                      </button>
                      <button
                        onClick={() => duplicarReceta(r)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-violet-50 hover:text-violet-600 transition-colors"
                        title="Duplicar"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        onClick={() => abrirEditarReceta(r)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => eliminarReceta(r)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"
                        title="Desactivar"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => toggleExpand(r.id)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                        title={isExpanded ? 'Colapsar' : 'Expandir'}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded: ingredients */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-gray-100 px-4 py-3 sm:px-5 sm:py-4 bg-gray-50/50">
                        {!recetaDetalle ? (
                          <div className="flex items-center justify-center py-4">
                            <SpinnerColaBlanca size="sm" />
                          </div>
                        ) : (
                          <>
                            {/* Reactor Visualization */}
                            {(recetaDetalle.pasos ?? []).length > 0 && (
                              <div className="mb-4">
                                <ReactorVisualization
                                  pasos={recetaDetalle.pasos ?? []}
                                  ingredientes={recetaDetalle.ingredientes ?? []}
                                  rendimiento={recetaDetalle.rendimiento ? parseFloat(recetaDetalle.rendimiento) : undefined}
                                />
                              </div>
                            )}

                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-100 text-sm">
                                <thead>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Materia Prima</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cantidad</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">% Merma</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Stock MP</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Acciones</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {(recetaDetalle.ingredientes ?? []).map(ing => {
                                    const stockMP = parseFloat(ing.stock_actual ?? '0');
                                    const necesita = parseFloat(ing.cantidad);
                                    return (
                                      <tr key={ing.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-3 py-2">
                                          <span className="font-medium text-gray-900">{ing.nombre_mp}</span>
                                          <span className="ml-1.5 text-[10px] font-mono text-gray-400">{ing.codigo_mp}</span>
                                          {(ing as any).paso_index != null && (
                                            <span className="ml-1.5 text-[10px] font-bold rounded px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100">
                                              Paso {Number((ing as any).paso_index) + 1}
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2 tabular-nums text-gray-700">
                                          {parseFloat(ing.cantidad).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ing.unidad_medida}
                                        </td>
                                        <td className="px-3 py-2 tabular-nums text-gray-500">
                                          {parseFloat(ing.porcentaje_merma).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                                        </td>
                                        <td className="px-3 py-2 tabular-nums">
                                          <span className={clsx(
                                            'font-medium',
                                            stockMP >= necesita ? 'text-emerald-600' : 'text-loga-red'
                                          )}>
                                            {stockMP.toLocaleString('es-ES', { maximumFractionDigits: 2 })}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="flex items-center justify-end gap-1">
                                            <button
                                              onClick={() => abrirEditarIng(ing)}
                                              className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                              title="Editar"
                                            >
                                              <Pencil size={13} />
                                            </button>
                                            <button
                                              onClick={() => eliminarIng(ing)}
                                              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"
                                              title="Eliminar"
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {(recetaDetalle.ingredientes ?? []).length === 0 && (
                                    <tr>
                                      <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-400">
                                        Sin ingredientes. Añade el primero.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3">
                              <button
                                onClick={abrirNuevoIng}
                                className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                              >
                                <Plus size={13} /> Añadir ingrediente
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {recetasFiltradas.length === 0 && (
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-4 py-12 text-center">
            <ChefHat size={32} className="mx-auto mb-2 text-gray-200" />
            <p className="text-sm text-gray-400">
              {busqueda ? 'Sin resultados para esa busqueda' : 'No hay recetas. Crea la primera.'}
            </p>
          </div>
        )}
      </div>}

      {/* Modal Receta */}
      <Modal
        open={modalReceta}
        onClose={() => setModalReceta(false)}
        title={editandoReceta
          ? `Editar ${formReceta.tipo_receta === 'envasado' ? 'Envasado' : 'Fabricación'}`
          : `${formReceta.tipo_receta === 'envasado' ? 'Nuevo Envasado' : 'Nueva Fabricación'}`
        }
        subtitle={editandoReceta ? `v${editandoReceta.version}` : formReceta.tipo_receta === 'envasado' ? 'Producto envasado (bote, garrafa, bidón...)' : 'Receta de reactor — define la fórmula'}
      >
        <div className="space-y-4">
          <FormField label="Nombre" required>
            <Input
              value={formReceta.nombre}
              onChange={e => setFormReceta(f => ({ ...f, nombre: e.target.value }))}
              placeholder={formReceta.tipo_receta === 'envasado' ? 'Envasado D2 — Bote 1kg' : 'Cola blanca premium...'}
              autoFocus
            />
          </FormField>

          {formReceta.tipo_receta === 'fabricacion' && (
            <FormField label="Rendimiento (kg)" hint="Cantidad recibida por lote (2 decimales)">
              <Input
                type="number" min="0" step="0.01"
                value={formReceta.rendimiento}
                onChange={e => setFormReceta(f => ({ ...f, rendimiento: e.target.value }))}
                onBlur={e => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n) && n > 0) {
                    setFormReceta(f => ({ ...f, rendimiento: n.toFixed(2) }));
                  }
                }}
                placeholder="1000.00"
              />
            </FormField>
          )}

          {formReceta.tipo_receta === 'envasado' && !editandoReceta && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
              <strong>Envasado:</strong> cada unidad producida = 1 bote/garrafa/bidón/saco. Los ingredientes son la cola granel + envase + etiqueta.
            </div>
          )}

          <FormField
            label={formReceta.tipo_receta === 'fabricacion' ? 'Producto fabricado' : 'Producto envasado'}
            hint={editandoReceta
              ? 'No editable: cambiar el producto de una receta rompe trazabilidad.'
              : (formReceta.tipo_receta === 'fabricacion'
                ? 'Busca uno existente o escribe un nombre nuevo para crearlo.'
                : 'Selecciona el producto envasado final.')}
            required
          >
            {/* Edición: nombre fijo del producto actual */}
            {editandoReceta ? (
              <div className="rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
                {productos.find(p => p.id === formReceta.producto_id)?.nombre ?? '—'}
              </div>
            ) : formReceta.tipo_receta === 'fabricacion' ? (
              // Combo con búsqueda + creación inline para producto_fabricado
              !formReceta.producto_id && formReceta.producto_nuevo_nombre ? (
                <div className="rounded-xl border-2 border-loga-red bg-red-50 px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-loga-red uppercase">Nuevo producto fabricado</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{formReceta.producto_nuevo_nombre}</p>
                    <p className="text-[10px] text-gray-500">Se creará con código auto al guardar la receta</p>
                  </div>
                  <button type="button"
                    onClick={() => setFormReceta(f => ({ ...f, producto_nuevo_nombre: '' }))}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-100 hover:text-loga-red shrink-0">
                    <X size={14} />
                  </button>
                </div>
              ) : formReceta.producto_id ? (
                <div className="rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {productos.find(p => p.id === formReceta.producto_id)?.nombre}
                    </p>
                    <p className="text-[10px] font-mono text-gray-400">
                      {productos.find(p => p.id === formReceta.producto_id)?.codigo}
                    </p>
                  </div>
                  <button type="button"
                    onClick={() => setFormReceta(f => ({ ...f, producto_id: '' }))}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-loga-red shrink-0">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <ProductoFinalCombo
                  productos={productos.filter(p => p.tipo === 'producto_fabricado' && p.activo)}
                  onSelectExistente={(p) => setFormReceta(f => ({ ...f, producto_id: p.id, producto_nuevo_nombre: '' }))}
                  onCrearNuevo={(nombre) => setFormReceta(f => ({ ...f, producto_id: '', producto_nuevo_nombre: nombre }))}
                  placeholder="Buscar producto fabricado o escribir nombre nuevo..."
                  crearLabel="Se creará como producto fabricado con código auto al guardar"
                  stockUnit="kg"
                  focusBorderColor="red"
                />
              )
            ) : (
              <Select
                value={formReceta.producto_id}
                onChange={e => setFormReceta(f => ({ ...f, producto_id: e.target.value }))}
              >
                <option value="">— Selecciona producto —</option>
                {productos.filter(p => p.tipo === 'producto_envasado' && p.activo).map(p => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
                ))}
              </Select>
            )}
          </FormField>

          {/* QC Section — solo fabricación */}
          {formReceta.tipo_receta === 'fabricacion' && <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 space-y-3">
            <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">
              Control de Calidad (rangos aceptables)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="pH min">
                <Input
                  type="number" min="0" max="14" step="0.1"
                  value={formReceta.ph_min}
                  onChange={e => setFormReceta(f => ({ ...f, ph_min: e.target.value }))}
                  placeholder="6.5"
                />
              </FormField>
              <FormField label="pH max">
                <Input
                  type="number" min="0" max="14" step="0.1"
                  value={formReceta.ph_max}
                  onChange={e => setFormReceta(f => ({ ...f, ph_max: e.target.value }))}
                  placeholder="7.5"
                />
              </FormField>
              <div />
              <FormField label="Solidos min (%)">
                <Input
                  type="number" min="0" max="100" step="0.1"
                  value={formReceta.solidos_min}
                  onChange={e => setFormReceta(f => ({ ...f, solidos_min: e.target.value }))}
                  placeholder="48"
                />
              </FormField>
              <FormField label="Solidos max (%)">
                <Input
                  type="number" min="0" max="100" step="0.1"
                  value={formReceta.solidos_max}
                  onChange={e => setFormReceta(f => ({ ...f, solidos_max: e.target.value }))}
                  placeholder="55"
                />
              </FormField>
              <div />
              <FormField label="Viscosidad min">
                <Input
                  type="number" min="0" step="1"
                  value={formReceta.viscosidad_min}
                  onChange={e => setFormReceta(f => ({ ...f, viscosidad_min: e.target.value }))}
                  placeholder="3000"
                />
              </FormField>
              <FormField label="Viscosidad max">
                <Input
                  type="number" min="0" step="1"
                  value={formReceta.viscosidad_max}
                  onChange={e => setFormReceta(f => ({ ...f, viscosidad_max: e.target.value }))}
                  placeholder="5000"
                />
              </FormField>
            </div>
          </div>}

          {/* Ingredientes (solo al crear; al editar se gestiona desde el panel
              de ingredientes existente abajo). Permite añadir MP + cantidad + merma
              al crear la receta sin tener que abrir otra pantalla. */}
          {!editandoReceta && formReceta.tipo_receta === 'fabricacion' && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
                  Ingredientes / Materias primas ({(formReceta.ingredientes ?? []).length})
                </p>
                <button
                  type="button"
                  onClick={() => setFormReceta(f => ({ ...f, ingredientes: [...(f.ingredientes ?? []), { materia_prima_id: '', cantidad: '', porcentaje_merma: '0', unidad_medida: 'kg' }] }))}
                  className="flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-200 transition-colors"
                >
                  <Plus size={11} /> Añadir MP
                </button>
              </div>
              {(formReceta.ingredientes ?? []).length === 0 && (
                <p className="text-[11px] text-amber-600 italic">Sin ingredientes. Pulsa "Añadir MP" para empezar.</p>
              )}
              {(formReceta.ingredientes ?? []).map((ing, idx) => {
                const mpList = productos.filter(p => p.tipo === 'materia_prima' && p.activo);
                const updateRow = (patch: Partial<FormIngrediente>) => setFormReceta(f => {
                  const arr = [...(f.ingredientes ?? [])];
                  arr[idx] = { ...arr[idx], ...patch };
                  return { ...f, ingredientes: arr };
                });
                return (
                  <div key={idx} className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-amber-600">MP #{idx + 1}</p>
                      <button
                        type="button"
                        onClick={() => setFormReceta(f => ({ ...f, ingredientes: (f.ingredientes ?? []).filter((_, i) => i !== idx) }))}
                        className="text-loga-red hover:bg-red-50 rounded p-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {/* Selector de MP: existente, nueva, o combo */}
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium block mb-1">Materia prima</label>
                      {ing.materia_prima_nueva_nombre && !ing.materia_prima_id ? (
                        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-amber-700 uppercase">Nueva materia prima</p>
                            <p className="text-sm font-semibold text-gray-900 truncate">{ing.materia_prima_nueva_nombre}</p>
                            <p className="text-[10px] text-gray-500">Se creará con código auto MP-XXX al guardar</p>
                          </div>
                          <button type="button"
                            onClick={() => updateRow({ materia_prima_nueva_nombre: '' })}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-100 hover:text-loga-red shrink-0">
                            <X size={14} />
                          </button>
                        </div>
                      ) : ing.materia_prima_id ? (
                        <div className="rounded-lg border-2 border-gray-200 bg-white px-3 py-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {mpList.find(p => p.id === ing.materia_prima_id)?.nombre ?? '—'}
                            </p>
                            <p className="text-[10px] font-mono text-gray-400">
                              {mpList.find(p => p.id === ing.materia_prima_id)?.codigo}
                            </p>
                          </div>
                          <button type="button"
                            onClick={() => updateRow({ materia_prima_id: '' })}
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-loga-red shrink-0">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <ProductoFinalCombo
                          productos={mpList}
                          onSelectExistente={(p) => updateRow({ materia_prima_id: p.id, materia_prima_nueva_nombre: '' })}
                          onCrearNuevo={(nombre) => updateRow({ materia_prima_id: '', materia_prima_nueva_nombre: nombre })}
                          placeholder="Buscar MP o escribir nombre nuevo..."
                          crearLabel="Se creará como materia prima con código auto MP-XXX al guardar"
                          stockUnit="kg"
                        />
                      )}
                    </div>
                    {/* Cantidad / Unidad / Merma — más ancho en merma para que se vea */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500 font-medium">Cantidad</label>
                        <Input
                          type="number" min="0" step="0.001"
                          value={ing.cantidad}
                          onChange={e => updateRow({ cantidad: e.target.value })}
                          placeholder="0"
                          className="!text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 font-medium">Unidad</label>
                        <Select
                          value={ing.unidad_medida}
                          onChange={e => updateRow({ unidad_medida: e.target.value })}
                          className="!text-xs"
                        >
                          <option value="kg">kg</option>
                          <option value="L">L</option>
                          <option value="ud">ud</option>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 font-medium">Merma %</label>
                        <Input
                          type="number" min="0" step="0.01"
                          value={ing.porcentaje_merma}
                          onChange={e => updateRow({ porcentaje_merma: e.target.value })}
                          placeholder="0"
                          className="!text-xs"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              {(formReceta.ingredientes ?? []).length > 0 && (
                <p className="text-[10px] text-gray-500 italic">Tras guardar podrás reordenarlos o asignarlos a pasos en el editor.</p>
              )}
            </div>
          )}

          <FormField label="Notas">
            <Textarea
              rows={2}
              value={formReceta.notas}
              onChange={e => setFormReceta(f => ({ ...f, notas: e.target.value }))}
              placeholder="Instrucciones, observaciones..."
            />
          </FormField>

          {/* Pasos del proceso */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide">
                Pasos del proceso ({formReceta.pasos.length})
              </p>
              <button
                type="button"
                onClick={() => setFormReceta(f => ({ ...f, pasos: [...f.pasos, { ...EMPTY_PASO }] }))}
                className="flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-200 transition-colors"
              >
                <Plus size={11} /> Añadir paso
              </button>
            </div>
            {formReceta.pasos.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-2">Sin pasos. Añade pasos para definir el proceso de fabricación.</p>
            )}
            <div className="space-y-2">
              {formReceta.pasos.map((paso, pi) => (
                <div key={pi} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-gray-300 shrink-0" />
                    <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 rounded px-1.5 py-0.5">{pi + 1}</span>
                    <Select
                      value={paso.fase}
                      onChange={e => {
                        const p = [...formReceta.pasos];
                        p[pi] = { ...p[pi], fase: e.target.value };
                        setFormReceta(f => ({ ...f, pasos: p }));
                      }}
                      className="!py-1 !text-xs flex-1"
                    >
                      {FASES.map(f => <option key={f} value={f}>{f}</option>)}
                    </Select>
                    <button
                      type="button"
                      onClick={() => {
                        const p = formReceta.pasos.filter((_, i) => i !== pi);
                        setFormReceta(f => ({ ...f, pasos: p }));
                      }}
                      className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <Input
                    value={paso.titulo}
                    onChange={e => {
                      const p = [...formReceta.pasos];
                      p[pi] = { ...p[pi], titulo: e.target.value };
                      setFormReceta(f => ({ ...f, pasos: p }));
                    }}
                    placeholder="Título del paso (ej: Cargar agua)"
                    className="!text-xs"
                  />
                  <Textarea
                    rows={2}
                    value={paso.descripcion}
                    onChange={e => {
                      const p = [...formReceta.pasos];
                      p[pi] = { ...p[pi], descripcion: e.target.value };
                      setFormReceta(f => ({ ...f, pasos: p }));
                    }}
                    placeholder="Descripción detallada del paso..."
                    className="!text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Temperatura °C</label>
                      <Input
                        type="number" min="0" max="200" step="1"
                        value={paso.temperatura ?? ''}
                        onChange={e => {
                          const p = [...formReceta.pasos];
                          p[pi] = { ...p[pi], temperatura: e.target.value };
                          setFormReceta(f => ({ ...f, pasos: p }));
                        }}
                        placeholder="25"
                        className="!text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Duración (min)</label>
                      <Input
                        type="number" min="1" max="600" step="1"
                        value={paso.duracion_min ?? ''}
                        onChange={e => {
                          const p = [...formReceta.pasos];
                          p[pi] = { ...p[pi], duracion_min: parseInt(e.target.value) || 3 };
                          setFormReceta(f => ({ ...f, pasos: p }));
                        }}
                        placeholder="3"
                        className="!text-xs"
                      />
                    </div>
                  </div>
                  {/* Limpieza — solo info en receta, los datos se rellenan en produccion */}
                  {paso.fase === 'Limpieza' && (
                    <p className="text-[10px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                      Los datos de limpieza (interna/externa) se rellenan en produccion al fabricar.
                    </p>
                  )}
                  {/* Cantidad de agua a echar en este paso (subdivide el total del agua) */}
                  {editandoReceta && recetaDetalle && (() => {
                    const totalAgua = (recetaDetalle.ingredientes ?? [])
                      .filter(i => esAguaMP(i.nombre_mp))
                      .reduce((s, i) => s + parseFloat(i.cantidad), 0);
                    if (totalAgua <= 0) return null;
                    const sumaPasos = formReceta.pasos.reduce((s, pp) => s + (Number(pp.cantidad_agua) || 0), 0);
                    return (
                      <div>
                        <label className="text-[10px] text-gray-500 font-medium">
                          Agua en este paso (kg) <span className="text-gray-400">— total receta: {totalAgua.toFixed(2)}</span>
                        </label>
                        <Input
                          type="number" min="0" step="0.01"
                          value={paso.cantidad_agua ?? ''}
                          onChange={e => {
                            const p = [...formReceta.pasos];
                            p[pi] = { ...p[pi], cantidad_agua: e.target.value === '' ? undefined : e.target.value };
                            setFormReceta(f => ({ ...f, pasos: p }));
                          }}
                          placeholder={`Ej: ${(totalAgua / Math.max(1, formReceta.pasos.length)).toFixed(2)}`}
                          className="!text-xs"
                        />
                        {sumaPasos > 0 && Math.abs(sumaPasos - totalAgua) > 0.01 && (
                          <p className="text-[10px] text-amber-600 mt-1">
                            ⚠ Suma de pasos: {sumaPasos.toFixed(2)} kg (debería ser {totalAgua.toFixed(2)})
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {/* Ingredient selector for this step.
                      Fuente unificada: en edición usamos recetaDetalle.ingredientes
                      (datos en BD); al crear usamos formReceta.ingredientes (form
                      state) y enriquecemos con nombre/unidad desde productos. */}
                  {(() => {
                    type IngFuente = { id: string; materia_prima_id: string; nombre_mp: string; cantidad: string; unidad_medida: string };
                    const fuente: IngFuente[] = editandoReceta && recetaDetalle
                      ? ((recetaDetalle.ingredientes ?? []) as IngFuente[])
                      : (formReceta.ingredientes ?? [])
                          .filter(i => i.materia_prima_id && i.cantidad)
                          .map(i => {
                            const p = productos.find(pp => pp.id === i.materia_prima_id);
                            return {
                              id: i.materia_prima_id, // pseudo id para key
                              materia_prima_id: i.materia_prima_id,
                              nombre_mp: p?.nombre ?? '—',
                              cantidad: String(i.cantidad),
                              unidad_medida: i.unidad_medida || 'kg',
                            };
                          });
                    if (fuente.length === 0) return null;
                    return (
                    <div>
                      <label className="text-[10px] text-gray-500 font-medium">Ingredientes en este paso (orden = orden de echado)</label>
                      {/* Lista ordenada de seleccionados, con flechas para reordenar */}
                      {(paso.ingredientes_ids ?? []).length > 0 && (
                        <div className="mt-1 space-y-1 rounded-md border border-indigo-100 bg-indigo-50/40 p-1.5">
                          {(paso.ingredientes_ids ?? []).map((mpId, idx, arr) => {
                            const ing = fuente.find(i => i.materia_prima_id === mpId);
                            if (!ing) return null;
                            // Si es agua y este paso tiene cantidad_agua, mostramos la
                            // porción del paso (30, no 60). Permite ver el reparto real.
                            const esAg = esAguaMP(ing.nombre_mp);
                            const cantidadPasoAgua = Number(paso.cantidad_agua) > 0
                              ? Number(paso.cantidad_agua) : null;
                            const cantidadShown = esAg && cantidadPasoAgua != null
                              ? cantidadPasoAgua
                              : parseFloat(ing.cantidad);
                            const moverArr = (a: string[], from: number, to: number) => {
                              const cp = [...a];
                              const [el] = cp.splice(from, 1);
                              cp.splice(to, 0, el);
                              return cp;
                            };
                            const updateIds = (next: string[]) => {
                              const p = [...formReceta.pasos];
                              p[pi] = { ...p[pi], ingredientes_ids: next };
                              setFormReceta(f => ({ ...f, pasos: p }));
                            };
                            return (
                              <div key={mpId} className="flex items-center gap-1.5 bg-white rounded px-2 py-1 border border-indigo-100">
                                <span className="text-[10px] font-bold tabular-nums text-indigo-600 w-4">{idx + 1}.</span>
                                <span className="flex-1 text-[11px] font-medium text-indigo-900 truncate">
                                  {ing.nombre_mp} <span className="text-indigo-500 font-mono">({cantidadShown.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ing.unidad_medida})</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => idx > 0 && updateIds(moverArr(arr, idx, idx - 1))}
                                  disabled={idx === 0}
                                  className="rounded p-0.5 text-indigo-400 hover:bg-indigo-100 disabled:opacity-20"
                                  title="Subir"
                                >▲</button>
                                <button
                                  type="button"
                                  onClick={() => idx < arr.length - 1 && updateIds(moverArr(arr, idx, idx + 1))}
                                  disabled={idx === arr.length - 1}
                                  className="rounded p-0.5 text-indigo-400 hover:bg-indigo-100 disabled:opacity-20"
                                  title="Bajar"
                                >▼</button>
                                <button
                                  type="button"
                                  onClick={() => updateIds(arr.filter(x => x !== mpId))}
                                  className="rounded p-0.5 text-loga-red hover:bg-red-50"
                                  title="Quitar del paso"
                                >×</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Disponibles para añadir — excluye los YA seleccionados en
                          este paso Y los usados en pasos anteriores (para no repetir).
                          Excepción para agua: muestra el restante (total − sumado en
                          pasos previos); si no queda, no se muestra. */}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(() => {
                          // Ingredientes usados en pasos PREVIOS (no agua).
                          const usadosPrevios = new Set<string>();
                          for (let j = 0; j < pi; j++) {
                            for (const mpId of (formReceta.pasos[j]?.ingredientes_ids ?? [])) {
                              usadosPrevios.add(mpId);
                            }
                          }
                          // Agua consumida en pasos previos (sumada).
                          const aguaPrevios = formReceta.pasos.slice(0, pi)
                            .reduce((s, pp) => s + (Number(pp.cantidad_agua) || 0), 0);
                          // Total agua de la receta (sobre fuente unificada).
                          const totalAguaReceta = fuente
                            .filter(i => esAguaMP(i.nombre_mp))
                            .reduce((s, i) => s + parseFloat(i.cantidad), 0);
                          const aguaRestante = Math.max(0, totalAguaReceta - aguaPrevios);

                          return fuente
                            .filter(ing => !(paso.ingredientes_ids ?? []).includes(ing.materia_prima_id))
                            .filter(ing => {
                              const esAg = esAguaMP(ing.nombre_mp);
                              if (esAg) return aguaRestante > 0.001;
                              // No-agua: ocultar si ya está en pasos previos.
                              return !usadosPrevios.has(ing.materia_prima_id);
                            })
                            .map(ing => {
                              const esAg = esAguaMP(ing.nombre_mp);
                              const cantidadMostrar = esAg ? aguaRestante : parseFloat(ing.cantidad);
                              return (
                                <button
                                  key={ing.id}
                                  type="button"
                                  onClick={() => {
                                    const p = [...formReceta.pasos];
                                    const ids = p[pi].ingredientes_ids ?? [];
                                    p[pi] = { ...p[pi], ingredientes_ids: [...ids, ing.materia_prima_id] };
                                    setFormReceta(f => ({ ...f, pasos: p }));
                                  }}
                                  className="rounded-md px-2 py-0.5 text-[10px] font-medium border border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                                >
                                  + {ing.nombre_mp} <span className="text-gray-400 font-mono">({cantidadMostrar.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ing.unidad_medida})</span>
                                </button>
                              );
                            });
                        })()}
                      </div>
                    </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>

          {errorReceta && (
            <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
              {errorReceta}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setModalReceta(false)}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={guardarReceta}
              disabled={savingReceta}
              className="flex-1 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors"
            >
              {savingReceta ? 'Guardando...' : editandoReceta ? 'Guardar cambios' : 'Crear receta'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal HISTORIAL de versiones de receta */}
      {historialRec.recetaId && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setHistorialRec({ recetaId: '', recetaNombre: '', items: null })} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="px-5 py-3 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100 shrink-0">
              <p className="text-sm font-bold text-gray-900">Historial de versiones</p>
              <p className="text-[11px] text-gray-500 truncate">{historialRec.recetaNombre}</p>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {historialRec.items === null && (
                <p className="text-xs text-gray-400 italic text-center py-6">Cargando…</p>
              )}
              {historialRec.items && historialRec.items.length === 0 && (
                <p className="text-xs text-gray-400 italic text-center py-6">Sin versiones anteriores. Esta receta no se ha editado todavía.</p>
              )}
              {(historialRec.items ?? []).map((h: any, idx: number) => {
                const s = h.snapshot ?? {};
                const fecha = new Date(h.created_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                // Diff con la versión anterior (más reciente → más antigua, así que la "anterior" es la SIGUIENTE en el array).
                const prev = (historialRec.items ?? [])[idx + 1]?.snapshot;
                const diffs: { campo: string; antes: string; despues: string }[] = [];
                if (prev) {
                  const f = (v: unknown) => (v == null || v === '' ? '—' : String(v));
                  const cmp = (campo: string, a: unknown, b: unknown) => {
                    const sa = f(a), sb = f(b);
                    if (sa !== sb) diffs.push({ campo, antes: sa, despues: sb });
                  };
                  cmp('Nombre', prev.nombre, s.nombre);
                  cmp('Rendimiento', prev.rendimiento, s.rendimiento);
                  cmp('Notas', prev.notas, s.notas);
                  cmp('Tipo', prev.tipo_receta, s.tipo_receta);
                  cmp('pH min', prev.ph_min, s.ph_min);
                  cmp('pH max', prev.ph_max, s.ph_max);
                  cmp('Sólidos min', prev.solidos_min, s.solidos_min);
                  cmp('Sólidos max', prev.solidos_max, s.solidos_max);
                  cmp('Viscosidad min', prev.viscosidad_min, s.viscosidad_min);
                  cmp('Viscosidad max', prev.viscosidad_max, s.viscosidad_max);
                  const prevPasos = JSON.stringify(prev.pasos ?? []);
                  const sPasos = JSON.stringify(s.pasos ?? []);
                  if (prevPasos !== sPasos) {
                    diffs.push({ campo: 'Pasos', antes: `${(prev.pasos ?? []).length} pasos`, despues: `${(s.pasos ?? []).length} pasos (modificados)` });
                  }
                  const prevIngs = JSON.stringify(prev.ingredientes ?? []);
                  const sIngs = JSON.stringify(s.ingredientes ?? []);
                  if (prevIngs !== sIngs) {
                    const prevN = (prev.ingredientes ?? []).length;
                    const sN = (s.ingredientes ?? []).length;
                    diffs.push({
                      campo: 'Ingredientes',
                      antes: `${prevN} ing`,
                      despues: prevN === sN ? `${sN} ing (cantidades cambiaron)` : `${sN} ing`,
                    });
                  }
                }
                return (
                  <div key={h.id} className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 inline-flex items-center rounded bg-loga-red/15 border border-loga-red/30 text-loga-red px-2 py-0.5 text-[11px] font-bold font-mono">
                          v{h.version}
                        </span>
                        <span className="text-[11px] text-gray-700 font-medium truncate">{h.motivo ?? 'Edición'}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`¿Restaurar a la versión v${h.version}?\nLa receta volverá al contenido de ese snapshot. El estado actual se guardará primero como una versión más.`)) return;
                            try {
                              await notify.promise(recetasApi.restaurar(historialRec.recetaId, h.id), {
                                loading: 'Restaurando…',
                                success: `Restaurada a v${h.version}`,
                                error: (e) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al restaurar',
                              });
                              setHistorialRec({ recetaId: '', recetaNombre: '', items: null });
                              cargar();
                            } catch { /* notificado */ }
                          }}
                          className="rounded bg-violet-600 text-white px-2.5 py-1 text-[10px] font-bold hover:bg-violet-700"
                        >
                          Restaurar
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`¿Borrar la versión v${h.version} del historial?\nEsta acción no se puede deshacer.`)) return;
                            try {
                              await notify.promise(recetasApi.eliminarHistorial(historialRec.recetaId, h.id), {
                                loading: 'Eliminando…',
                                success: `v${h.version} eliminada`,
                                error: (e) => (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al eliminar',
                              });
                              // Refrescar la lista del modal
                              const { data } = await recetasApi.historial(historialRec.recetaId);
                              setHistorialRec(prev => ({ ...prev, items: data as any[] }));
                            } catch { /* notificado */ }
                          }}
                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-loga-red"
                          title="Borrar esta versión"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      {fecha}{h.usuario_nombre ? ` · ${h.usuario_nombre}` : ''}
                    </p>
                    <p className="text-[10px] text-gray-600 mt-0.5 font-mono">
                      <b>{s.nombre ?? '—'}</b>
                      {s.rendimiento && <> · {parseFloat(s.rendimiento).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</>}
                      {' · '}{(s.ingredientes ?? []).length} ing
                      {(s.pasos ?? []).length > 0 && <> · {(s.pasos ?? []).length} pasos</>}
                    </p>
                    {/* Diff vs versión anterior */}
                    {diffs.length > 0 && (
                      <div className="mt-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5">
                        <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wide mb-1">
                          {diffs.length} cambio{diffs.length !== 1 ? 's' : ''} respecto a la anterior
                        </p>
                        <ul className="space-y-0.5">
                          {diffs.map((d, di) => (
                            <li key={di} className="text-[10px] flex items-center gap-1.5">
                              <span className="font-semibold text-amber-800 shrink-0">{d.campo}:</span>
                              <span className="line-through text-gray-400 font-mono truncate">{d.antes}</span>
                              <span className="text-gray-300">→</span>
                              <span className="text-emerald-700 font-mono font-semibold truncate">{d.despues}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {prev && diffs.length === 0 && (
                      <p className="text-[10px] text-gray-400 italic mt-1">Sin cambios respecto a la anterior</p>
                    )}
                    {/* Desglose: ingredientes y pasos del snapshot */}
                    {((s.ingredientes ?? []).length > 0 || (s.pasos ?? []).length > 0) && (
                      <div className="mt-2 space-y-2">
                        {(s.ingredientes ?? []).length > 0 && (
                          <div className="rounded border border-violet-100 bg-white/60 px-2 py-1.5">
                            <p className="text-[9px] font-bold text-violet-700 uppercase tracking-wide mb-0.5">Ingredientes</p>
                            <ul className="space-y-0.5">
                              {(s.ingredientes ?? []).map((ing: any, k: number) => {
                                const prod = productos.find(p => p.id === ing.materia_prima_id);
                                return (
                                  <li key={k} className="flex justify-between text-[10px] gap-2">
                                    <span className="text-gray-700 truncate">
                                      {prod?.nombre ?? '(MP desconocido)'}
                                      {ing.paso_index != null && (
                                        <span className="ml-1 text-blue-700">· paso {Number(ing.paso_index) + 1}</span>
                                      )}
                                    </span>
                                    <span className="font-mono font-semibold text-gray-800 shrink-0">
                                      {parseFloat(ing.cantidad ?? '0').toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {ing.unidad_medida ?? 'kg'}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                        {(s.pasos ?? []).length > 0 && (
                          <div className="rounded border border-violet-100 bg-white/60 px-2 py-1.5">
                            <p className="text-[9px] font-bold text-violet-700 uppercase tracking-wide mb-0.5">Pasos</p>
                            <ol className="space-y-1 list-none">
                              {(s.pasos ?? []).map((p: any, k: number) => (
                                <li key={k} className="text-[10px] leading-tight">
                                  <div className="flex items-baseline gap-1 flex-wrap">
                                    <span className="font-bold text-gray-700">{k + 1}.</span>
                                    {p.fase && <span className="text-loga-red font-bold uppercase">{p.fase}</span>}
                                    {p.titulo && <span className="text-gray-800">— {p.titulo}</span>}
                                    {p.temperatura && <span className="text-gray-500">· {p.temperatura}°C</span>}
                                    {p.duracion_min && <span className="text-gray-500">· {p.duracion_min}min</span>}
                                    {p.cantidad_agua && <span className="text-blue-700 font-mono">· agua {p.cantidad_agua}</span>}
                                  </div>
                                  {p.descripcion && (
                                    <p className="text-gray-500 italic ml-3">{p.descripcion}</p>
                                  )}
                                  {(p.ingredientes_ids ?? []).length > 0 && (
                                    <p className="text-[9px] text-gray-400 ml-3">
                                      ingredientes: {(p.ingredientes_ids as string[]).map(mpId => productos.find(pr => pr.id === mpId)?.nombre ?? '?').join(', ')}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <button
                onClick={() => setHistorialRec({ recetaId: '', recetaNombre: '', items: null })}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                Cerrar
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal CONFIRMAR cambios de receta */}
      {confirmCambios && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setConfirmCambios(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl flex flex-col max-h-[80vh]"
          >
            <div className="px-5 py-3 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100 shrink-0">
              <p className="text-sm font-bold text-gray-900">Confirmar cambios en la receta</p>
              <p className="text-[11px] text-gray-500">
                Vas a guardar {confirmCambios.length} cambio{confirmCambios.length !== 1 ? 's' : ''}. La versión subirá de
                <b className="text-loga-red"> v{editandoReceta?.version}</b> a
                <b className="text-loga-red"> v{(editandoReceta?.version ?? 0) + 1}</b>.
              </p>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {confirmCambios.map((c, i) => (
                <div key={i} className="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2">
                  <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-1">{c.campo}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="line-through text-gray-400 font-mono truncate flex-1">{c.antes}</span>
                    <span className="text-gray-300">→</span>
                    <span className="text-emerald-700 font-semibold font-mono truncate flex-1">{c.despues}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
              <button
                onClick={() => setConfirmCambios(null)}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                Cancelar
              </button>
              <button
                onClick={() => { setConfirmCambios(null); ejecutarGuardadoReceta(); }}
                disabled={savingReceta}
                className="flex items-center gap-2 rounded-xl bg-loga-red px-5 py-2 text-sm font-bold text-white hover:bg-loga-red-dark disabled:bg-gray-300"
              >
                <Check size={15} /> Sí, guardar cambios
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal Importar Recetas */}
      <Modal
        open={modalImportar}
        onClose={() => setModalImportar(false)}
        title="Importar Recetas (JSON)"
        subtitle="Pega un JSON con el array de recetas a importar"
      >
        <div className="space-y-4">
          <Textarea
            rows={14}
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='{"recetas":[...]}'
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
                  const { data } = await recetasApi.importar(parsed);
                  const d = data as { ok: boolean; creadas: number };
                  setImportResult(`${d.creadas} receta(s) importada(s) correctamente.`);
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

      {/* Modal Ingrediente */}
      <Modal
        open={modalIng}
        onClose={() => setModalIng(false)}
        title={editandoIng ? 'Editar Ingrediente' : 'Añadir Ingrediente'}
        subtitle={recetaDetalle?.nombre}
      >
        <div className="space-y-4">
          <FormField label="Ingrediente" required>
            {formIng.materia_prima_id ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm font-medium text-gray-800">
                  {productos.find(p => p.id === formIng.materia_prima_id)?.nombre ?? '—'}
                </span>
                <button type="button" onClick={() => { setFormIng(f => ({ ...f, materia_prima_id: '' })); setBusqIng(''); }}
                  className="text-xs text-gray-400 hover:text-loga-red underline">Cambiar</button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={busqIng}
                  onChange={e => setBusqIng(e.target.value)}
                  placeholder="Buscar materia prima, cola, embalaje..."
                  autoFocus
                />
                {(() => {
                  const q = busqIng.toLowerCase();
                  const disponibles = productos.filter(p => p.activo && p.tipo !== 'producto_envasado');
                  const filtrados = q ? disponibles.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)) : disponibles;
                  const mp = filtrados.filter(p => p.tipo === 'materia_prima');
                  const fab = filtrados.filter(p => p.tipo === 'producto_fabricado' || p.tipo === 'producto_terminado');
                  const emb = filtrados.filter(p => p.tipo === 'material_embalaje');
                  const pick = (p: Producto) => { setFormIng(f => ({ ...f, materia_prima_id: p.id, unidad_medida: p.unidad_medida })); setBusqIng(''); };
                  if (filtrados.length === 0) return <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs text-gray-400 text-center">Sin resultados para "{busqIng}"</div>;
                  return (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                      {mp.length > 0 && <>
                        <p className="px-2 py-1 text-[10px] font-bold uppercase sticky top-0 bg-blue-50 text-blue-600">Materia Prima</p>
                        {mp.map(p => <button key={p.id} onClick={() => pick(p)} className="w-full text-left px-3 py-1.5 hover:bg-blue-50 flex items-center gap-2 text-xs"><span className="font-mono text-gray-400 text-[10px]">{p.codigo}</span><span className="font-medium text-gray-800 flex-1 truncate">{p.nombre}</span></button>)}
                      </>}
                      {fab.length > 0 && <>
                        <p className="px-2 py-1 text-[10px] font-bold uppercase sticky top-0 bg-red-50 text-loga-red">Cola Fabricada</p>
                        {fab.map(p => <button key={p.id} onClick={() => pick(p)} className="w-full text-left px-3 py-1.5 hover:bg-red-50 flex items-center gap-2 text-xs"><span className="font-mono text-gray-400 text-[10px]">{p.codigo}</span><span className="font-medium text-gray-800 flex-1 truncate">{p.nombre}</span></button>)}
                      </>}
                      {emb.length > 0 && <>
                        <p className="px-2 py-1 text-[10px] font-bold uppercase sticky top-0 bg-gray-50 text-gray-500">Material Embalaje</p>
                        {emb.map(p => <button key={p.id} onClick={() => pick(p)} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 text-xs"><span className="font-mono text-gray-400 text-[10px]">{p.codigo}</span><span className="font-medium text-gray-800 flex-1 truncate">{p.nombre}</span></button>)}
                      </>}
                    </div>
                  );
                })()}
              </div>
            )}
          </FormField>

          <FormField label="Cantidad" required>
            <Input
              type="number" min="0.001" step="0.001"
              value={formIng.cantidad}
              onChange={e => setFormIng(f => ({ ...f, cantidad: e.target.value }))}
              placeholder="100"
              className="w-full text-lg py-3 font-mono"
            />
          </FormField>
          <FormField label="Unidad">
            <Select
              value={formIng.unidad_medida}
              onChange={e => setFormIng(f => ({ ...f, unidad_medida: e.target.value }))}
            >
              {['kg', 'g', 'L', 'mL', 'ud'].map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="% Merma" hint="Porcentaje de perdida estimada">
            <Input
              type="number" min="0" max="100" step="0.1"
              value={formIng.porcentaje_merma}
              onChange={e => setFormIng(f => ({ ...f, porcentaje_merma: e.target.value }))}
              placeholder="0"
            />
          </FormField>

          {/* Asignación a paso (especialmente útil para agua repartida en varias echadas) */}
          {(() => {
            const prodSel = productos.find(p => p.id === formIng.materia_prima_id);
            const aguaSel = esAguaMP(prodSel?.nombre);
            const pasos = recetaDetalle?.pasos ?? [];
            if (!aguaSel || pasos.length === 0) return null;
            return (
              <FormField
                label="Paso (opcional)"
                hint="Asigna esta parte del agua a un paso concreto. Puedes añadir la misma agua varias veces, cada parte en su paso."
              >
                <Select
                  value={formIng.paso_index}
                  onChange={e => setFormIng(f => ({ ...f, paso_index: e.target.value }))}
                >
                  <option value="">— Sin asignar —</option>
                  {pasos.map((p, i) => (
                    <option key={i} value={i}>
                      Paso {i + 1}: {p.titulo || p.fase || '—'}
                    </option>
                  ))}
                </Select>
              </FormField>
            );
          })()}

          {errorIng && (
            <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-loga-red">
              {errorIng}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setModalIng(false)}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={guardarIng}
              disabled={savingIng}
              className="flex-1 rounded-lg bg-loga-red py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark disabled:bg-gray-300 transition-colors"
            >
              {savingIng ? 'Guardando...' : editandoIng ? 'Guardar cambios' : 'Añadir ingrediente'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// EnvaseCombo: selector híbrido — elige envase existente o crea nuevo
// material de embalaje. Mismo patrón que ProductoFinalCombo.
function EnvaseCombo({ materiales, onSelectExistente, onCrearNuevo }: {
  materiales: Producto[];
  onSelectExistente: (p: Producto) => void;
  onCrearNuevo: (nombre: string) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(text.trim());
  const matches = q
    ? materiales.filter(p => norm(p.nombre).includes(q) || norm(p.codigo).includes(q))
    : materiales;
  const exact = materiales.find(p => norm(p.nombre) === q);

  return (
    <div className="relative">
      <input
        value={text}
        onChange={e => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Buscar envase existente o escribir nombre nuevo..."
        className="w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
      />
      {open && (
        <div className="absolute z-[200] mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {matches.length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Existentes</p>
              {matches.map(p => (
                <button key={p.id} type="button" onMouseDown={() => onSelectExistente(p)}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{p.nombre}</p>
                    <p className="text-[10px] font-mono text-gray-400">{p.codigo}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">{parseFloat(p.stock_actual).toLocaleString('es-ES')} ud</span>
                </button>
              ))}
            </div>
          )}
          {q && !exact && (
            <div className="border-t border-gray-100 bg-emerald-50/50">
              <button type="button" onMouseDown={() => onCrearNuevo(text.trim())}
                className="w-full text-left px-3 py-3 hover:bg-emerald-100 transition-colors">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">+ Crear nuevo envase</p>
                <p className="text-sm font-semibold text-gray-900">«{text.trim()}»</p>
                <p className="text-[10px] text-gray-500">Material de embalaje · código auto ME-XXX</p>
              </button>
            </div>
          )}
          {!q && matches.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">Empieza a escribir para buscar o crear</p>
          )}
        </div>
      )}
    </div>
  );
}

// ProductoFinalCombo: selector híbrido — elige existente o crea nuevo
// ───────────────────────────────────────────────────────────────
function ProductoFinalCombo({ productos, onSelectExistente, onCrearNuevo, placeholder = 'Buscar existente o escribir nombre nuevo...', crearLabel = 'Se creará como producto envasado con código auto PE-XXX', stockUnit = 'ud', focusBorderColor = 'emerald' }: {
  productos: Producto[];
  onSelectExistente: (p: Producto) => void;
  onCrearNuevo: (nombre: string) => void;
  placeholder?: string;
  crearLabel?: string;
  stockUnit?: string;
  focusBorderColor?: 'emerald' | 'red';
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = norm(text.trim());
  const matches = q
    ? productos.filter(p => norm(p.nombre).includes(q) || norm(p.codigo).includes(q))
    : productos;
  const exact = productos.find(p => norm(p.nombre) === q);

  return (
    <div className="relative">
      <input
        value={text}
        onChange={e => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className={clsx(
          "w-full rounded-xl border-2 border-gray-200 bg-white px-3 py-2.5 text-sm outline-none",
          focusBorderColor === 'red'
            ? "focus:border-loga-red focus:ring-2 focus:ring-red-100"
            : "focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
        )}
      />
      {open && (
        <div className="absolute z-[200] mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
          {matches.length > 0 && (
            <div>
              <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Existentes</p>
              {matches.map(p => (
                <button key={p.id} type="button" onMouseDown={() => onSelectExistente(p)}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition-colors flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{p.nombre}</p>
                    <p className="text-[10px] font-mono text-gray-400">{p.codigo}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">{parseFloat(p.stock_actual).toLocaleString('es-ES')} {stockUnit}</span>
                </button>
              ))}
            </div>
          )}
          {q && !exact && (
            <div className={clsx("border-t border-gray-100", focusBorderColor === 'red' ? 'bg-red-50/50' : 'bg-emerald-50/50')}>
              <button type="button" onMouseDown={() => onCrearNuevo(text.trim())}
                className={clsx("w-full text-left px-3 py-3 transition-colors", focusBorderColor === 'red' ? 'hover:bg-red-100' : 'hover:bg-emerald-100')}>
                <p className={clsx("text-[10px] font-bold uppercase tracking-wider", focusBorderColor === 'red' ? 'text-loga-red' : 'text-emerald-600')}>+ Crear nuevo</p>
                <p className="text-sm font-semibold text-gray-900">«{text.trim()}»</p>
                <p className="text-[10px] text-gray-500">{crearLabel}</p>
              </button>
            </div>
          )}
          {!q && matches.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">Empieza a escribir para buscar o crear</p>
          )}
        </div>
      )}
    </div>
  );
}
