import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Users, Mail, Phone, MapPin, Search, Archive, ArchiveRestore } from 'lucide-react';
import clsx from 'clsx';
import { clientesApi } from '../api/client';
import type { Cliente } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import { FormField, Input, Textarea } from '../components/FormField';
import { notify } from '../lib/notify';
import { ToastBlock, ToastField } from '../components/ToastFields';
import { cpAProvincia } from '../lib/provincia';

type Tab = 'activos' | 'archivados';

export default function Clientes() {
  const [clientes, setClientes]       = useState<Cliente[]>([]);
  const [loading, setLoading]         = useState(true);
  const [busqueda, setBusqueda]       = useState('');
  const [tab, setTab]                 = useState<Tab>('activos');
  const [modalOpen, setModalOpen]     = useState(false);
  const [editando, setEditando]       = useState<Cliente | null>(null);
  const [form, setForm]               = useState({ nombre: '', email: '', telefono: '', direccion: '', codigo_postal: '', nif: '', notas: '' });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [confirmArchivar, setConfirmArchivar] = useState<Cliente | null>(null);
  const [archivando, setArchivando]   = useState(false);

  const cargar = useCallback(async () => {
    try {
      // Cargamos TODOS (activos + archivados) en una sola query; filtramos en cliente
      const { data } = await clientesApi.listar({ archivados: 'all' });
      setClientes(data as Cliente[]);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm({ nombre: '', email: '', telefono: '', direccion: '', codigo_postal: '', nif: '', notas: '' });
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (c: Cliente) => {
    setEditando(c);
    setForm({
      nombre:        c.nombre,
      email:         c.email ?? '',
      telefono:      c.telefono ?? '',
      direccion:     c.direccion ?? '',
      codigo_postal: c.codigo_postal ?? '',
      nif:           c.nif ?? '',
      notas:         c.notas ?? '',
    });
    setError('');
    setModalOpen(true);
  };

  const provinciaForm = cpAProvincia(form.codigo_postal);

  const handleGuardar = async () => {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    if (form.codigo_postal.trim() && !/^\d{5}$/.test(form.codigo_postal.trim())) {
      setError('El código postal debe tener 5 dígitos');
      return;
    }
    setSaving(true);
    setError('');
    const ejecutar = async () => {
      let nivel: string | undefined;
      if (editando) {
        const res = await clientesApi.editar(editando.id, form);
        nivel = (res.data as { nivel?: string | null } | undefined)?.nivel ?? editando.nivel ?? undefined;
      } else {
        const res = await clientesApi.crear(form);
        nivel = (res.data as { nivel?: string | null } | undefined)?.nivel ?? undefined;
      }
      return { ...form, nivel };
    };
    try {
      await notify.promise(ejecutar(), {
        loading: editando ? 'Guardando cliente…' : 'Creando cliente…',
        success: editando ? 'Cliente guardado' : 'Cliente creado',
        successDesc: (d) => (
          <ToastBlock title={d.nombre}>
            <ToastField label="NIF/CIF" value={d.nif} />
            <ToastField label="Nivel" value={d.nivel ? String(d.nivel).toUpperCase() : undefined} />
            <ToastField label="Email" value={d.email} span={2} />
            <ToastField label="Teléfono" value={d.telefono} />
            <ToastField label="CP" value={d.codigo_postal ? `${d.codigo_postal} · ${cpAProvincia(d.codigo_postal) ?? '—'}` : undefined} />
            <ToastField label="Dirección" value={d.direccion} span={2} />
          </ToastBlock>
        ),
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Error al guardar',
      });
      setModalOpen(false);
      cargar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleArchivar = async () => {
    if (!confirmArchivar) return;
    setArchivando(true);
    const c = confirmArchivar;
    try {
      await notify.promise(clientesApi.archivar(c.id), {
        loading: 'Archivando…',
        success: 'Cliente archivado',
        successDesc: (
          <ToastBlock title={c.nombre}>
            <ToastField label="NIF/CIF" value={c.nif} />
            <ToastField label="Email" value={c.email} span={2} />
            <ToastField
              label="Disponible en"
              value="Pestaña Archivados (se puede recuperar)"
              span={2}
            />
          </ToastBlock>
        ),
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo archivar',
      });
      setConfirmArchivar(null);
      cargar();
    } catch { /* notificado */ }
    finally { setArchivando(false); }
  };

  const handleRecuperar = async (c: Cliente) => {
    try {
      await notify.promise(clientesApi.recuperar(c.id), {
        loading: 'Recuperando…',
        success: 'Cliente recuperado',
        successDesc: (
          <ToastBlock title={c.nombre}>
            <ToastField label="NIF/CIF" value={c.nif} />
            <ToastField label="Estado" value="Activo · disponible para nuevos pedidos" span={2} />
          </ToastBlock>
        ),
        error: (err) => (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'No se pudo recuperar',
      });
      cargar();
    } catch { /* notificado */ }
  };

  const activos = clientes.filter(c => !c.archivado_at);
  const archivados = clientes.filter(c => !!c.archivado_at);
  const tabClientes = tab === 'activos' ? activos : archivados;

  const filtrados = tabClientes.filter((c) => {
    if (!busqueda.trim()) return true;
    const q = busqueda.toLowerCase();
    return (
      c.nombre.toLowerCase().includes(q) ||
      (c.email?.toLowerCase().includes(q)) ||
      (c.nif?.toLowerCase().includes(q))
    );
  }).sort((a, b) => {
    if (tab === 'archivados') {
      // ordenar por archivado_at DESC (los más recientemente archivados arriba)
      return (b.archivado_at ?? '').localeCompare(a.archivado_at ?? '');
    }
    return parseFloat(b.consumo_total ?? '0') - parseFloat(a.consumo_total ?? '0');
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Clientes</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {activos.length} activo{activos.length !== 1 ? 's' : ''}
            {archivados.length > 0 && (
              <span className="ml-1.5 text-gray-300">· {archivados.length} archivado{archivados.length !== 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <button
          onClick={abrirNuevo}
          className="flex items-center gap-2 rounded-lg bg-loga-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
        >
          <Plus size={16} /> Nuevo Cliente
        </button>
      </div>

      {/* Tabs + búsqueda */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          <button
            onClick={() => setTab('activos')}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 transition-colors',
              tab === 'activos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Users size={12} /> Activos
            <span className={clsx('inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-mono',
              tab === 'activos' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-500')}>
              {activos.length}
            </span>
          </button>
          <button
            onClick={() => setTab('archivados')}
            className={clsx(
              'rounded-md px-3 py-1.5 text-xs font-bold flex items-center gap-1.5 transition-colors',
              tab === 'archivados' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Archive size={12} /> Archivados
            <span className={clsx('inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-mono',
              tab === 'archivados' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500')}>
              {archivados.length}
            </span>
          </button>
        </div>
        <div className="relative flex-1 max-w-md">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder={tab === 'archivados' ? 'Buscar en archivados…' : 'Buscar por nombre, email o NIF…'}
            className="pl-9 w-full"
          />
        </div>
      </div>

      {tab === 'archivados' && (
        <div className="rounded-lg bg-amber-50/60 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-2">
          <Archive size={12} className="shrink-0 mt-0.5" />
          <span>
            <b>Clientes archivados:</b> no aparecen al crear pedidos. Se archivan automáticamente tras <b>24 meses sin pedido</b>, o manualmente desde la pestaña Activos. Vuelven solos a la lista activa cuando les creas un pedido nuevo, o usa el botón <b>Recuperar</b>.
          </span>
        </div>
      )}

      {/* Cards mobile + desktop table */}
      {/* Mobile cards */}
      <div className="grid gap-4 sm:hidden">
        {filtrados.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 shrink-0">
                  <Users size={18} className="text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-gray-900 truncate">{c.nombre}</p>
                    {c.nivel === 'oro' && <span title="Cliente Oro (>150K EUR)" className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-1.5 py-0.5 text-[8px] font-black text-white tracking-wider shadow-sm">ORO</span>}
                    {c.nivel === 'plata' && <span title="Cliente Plata (>80K EUR)" className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-gray-300 to-gray-400 px-1.5 py-0.5 text-[8px] font-black text-white tracking-wider shadow-sm">PLATA</span>}
                    {c.nivel === 'bronce' && <span title="Cliente Bronce (>20K EUR)" className="inline-flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-600 to-orange-700 px-1.5 py-0.5 text-[8px] font-black text-white tracking-wider shadow-sm">BRONCE</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.nif && <span className="text-[11px] text-gray-400 font-mono">{c.nif}</span>}
                    {c.consumo_total && parseFloat(c.consumo_total) > 0 && (
                      <span className="text-[10px] font-bold tabular-nums text-emerald-600">
                        {parseFloat(c.consumo_total).toLocaleString('es-ES', { maximumFractionDigits: 0 })} EUR
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => abrirEditar(c)}
                  title="Editar"
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                >
                  <Pencil size={14} />
                </button>
                {c.archivado_at ? (
                  <button
                    onClick={() => handleRecuperar(c)}
                    title="Recuperar (volver a activos)"
                    className="rounded-lg p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors"
                  >
                    <ArchiveRestore size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmArchivar(c)}
                    title="Archivar (no se borra, se puede recuperar)"
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                  >
                    <Archive size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-gray-500">
              {c.email && (
                <div className="flex items-center gap-2">
                  <Mail size={12} className="text-gray-400 shrink-0" />
                  <a href={`mailto:${c.email}`} className="truncate hover:text-loga-red transition-colors">
                    {c.email}
                  </a>
                </div>
              )}
              {c.telefono && (
                <div className="flex items-center gap-2">
                  <Phone size={12} className="text-gray-400 shrink-0" />
                  <span>{c.telefono}</span>
                </div>
              )}
              {(c.direccion || c.codigo_postal) && (
                <div className="flex items-start gap-2">
                  <MapPin size={12} className="text-gray-400 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">
                    {c.codigo_postal && (
                      <span className="font-mono text-gray-700">{c.codigo_postal}</span>
                    )}
                    {c.codigo_postal && cpAProvincia(c.codigo_postal) && (
                      <span className="ml-1 text-indigo-600 font-semibold">{cpAProvincia(c.codigo_postal)}</span>
                    )}
                    {c.direccion && <span className="ml-1">{c.codigo_postal ? '· ' : ''}{c.direccion}</span>}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block rounded-xl border border-gray-100 overflow-hidden shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Nombre', 'Consumo', 'Email', 'Telefono', 'CP / Provincia', 'NIF', 'Acciones'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {filtrados.map((c, i) => (
              <motion.tr
                key={c.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 shrink-0">
                      <Users size={14} className="text-indigo-600" />
                    </div>
                    <span className="font-medium text-gray-900">{c.nombre}</span>
                    {c.nivel === 'oro' && <span className="inline-flex rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-1.5 py-0.5 text-[7px] font-black text-white tracking-wider shadow-sm">ORO</span>}
                    {c.nivel === 'plata' && <span className="inline-flex rounded-full bg-gradient-to-r from-gray-300 to-gray-400 px-1.5 py-0.5 text-[7px] font-black text-white tracking-wider shadow-sm">PLATA</span>}
                    {c.nivel === 'bronce' && <span className="inline-flex rounded-full bg-gradient-to-r from-amber-600 to-orange-700 px-1.5 py-0.5 text-[7px] font-black text-white tracking-wider shadow-sm">BRONCE</span>}
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums text-xs">
                  {c.consumo_total && parseFloat(c.consumo_total) > 0 ? (
                    <span className="font-bold text-emerald-600">{parseFloat(c.consumo_total).toLocaleString('es-ES', { maximumFractionDigits: 0 })} EUR</span>
                  ) : (
                    <span className="text-gray-300">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="hover:text-loga-red transition-colors">{c.email}</a>
                  ) : (
                    <span className="text-gray-300">--</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{c.telefono || <span className="text-gray-300">--</span>}</td>
                <td className="px-4 py-3 text-xs">
                  {c.codigo_postal ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-gray-700">{c.codigo_postal}</span>
                      {cpAProvincia(c.codigo_postal) && (
                        <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5 text-[10px] font-semibold">{cpAProvincia(c.codigo_postal)}</span>
                      )}
                    </div>
                  ) : <span className="text-gray-300">--</span>}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 font-mono">{c.nif || <span className="text-gray-300">--</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => abrirEditar(c)}
                      title="Editar"
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    {c.archivado_at ? (
                      <button
                        onClick={() => handleRecuperar(c)}
                        title="Recuperar (volver a activos)"
                        className="rounded-lg p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition-colors flex items-center gap-1 text-[11px] font-bold"
                      >
                        <ArchiveRestore size={14} /> Recuperar
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirmArchivar(c)}
                        title="Archivar (no se borra, se puede recuperar)"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-700 transition-colors"
                      >
                        <Archive size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </motion.tr>
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Users size={32} className="mx-auto mb-2 text-gray-200" />
                  <p className="text-sm text-gray-400">
                    {busqueda.trim() ? 'Sin resultados para la busqueda' : 'No hay clientes. Crea el primero.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile empty state */}
      {filtrados.length === 0 && (
        <div className="flex flex-col items-center py-16 text-gray-300 sm:hidden">
          <Users size={48} className="mb-3" />
          <p className="text-sm text-gray-400">
            {busqueda.trim() ? 'Sin resultados' : 'No hay clientes. Crea el primero.'}
          </p>
        </div>
      )}

      {/* Modal crear/editar */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editando ? 'Editar Cliente' : 'Nuevo Cliente'}
      >
        <div className="space-y-4">
          <FormField label="Nombre" required>
            <Input
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Empresa Ejemplo S.L."
            />
          </FormField>

          <FormField label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="contacto@empresa.com"
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Telefono">
              <Input
                type="tel"
                value={form.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                placeholder="+34 912 000 000"
              />
            </FormField>

            <FormField label="NIF / CIF">
              <Input
                value={form.nif}
                onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value }))}
                placeholder="B12345678"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Código postal">
              <Input
                value={form.codigo_postal}
                onChange={(e) => setForm((f) => ({ ...f, codigo_postal: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                placeholder="28001"
                inputMode="numeric"
                maxLength={5}
              />
              {form.codigo_postal.length === 5 && (
                <p className={`mt-1 text-[10px] font-medium ${provinciaForm ? 'text-emerald-600' : 'text-loga-red'}`}>
                  {provinciaForm ? `→ ${provinciaForm}` : 'CP no reconocido'}
                </p>
              )}
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Dirección">
                <Textarea
                  rows={2}
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                  placeholder="Calle, ciudad..."
                />
              </FormField>
            </div>
          </div>

          <FormField label="Notas">
            <Textarea
              rows={2}
              value={form.notas}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
              placeholder="Observaciones internas..."
            />
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
              {saving ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm archivar */}
      <ConfirmModal
        open={!!confirmArchivar}
        title="Archivar cliente"
        message={`Se archivará "${confirmArchivar?.nombre}". Dejará de aparecer al crear pedidos, pero el histórico se conserva y podrás recuperarlo en cualquier momento desde la pestaña Archivados.`}
        confirmText="Archivar"
        loading={archivando}
        onConfirm={handleArchivar}
        onCancel={() => setConfirmArchivar(null)}
      />
    </div>
  );
}
