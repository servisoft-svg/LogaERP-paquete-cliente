import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Truck, Mail, Phone, MapPin, Search } from 'lucide-react';
import { proveedoresApi } from '../api/client';
import type { Proveedor } from '../types';
import SpinnerColaBlanca from '../components/SpinnerColaBlanca';
import Modal from '../components/Modal';
import { FormField, Input, Textarea } from '../components/FormField';

export default function Proveedores() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading]         = useState(true);
  const [busqueda, setBusqueda]       = useState('');
  const [modalOpen, setModalOpen]     = useState(false);
  const [editando, setEditando]       = useState<Proveedor | null>(null);
  const [form, setForm]               = useState({ nombre: '', email: '', telefono: '', direccion: '' });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const cargar = useCallback(async () => {
    try {
      const { data } = await proveedoresApi.listar();
      setProveedores(data as Proveedor[]);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm({ nombre: '', email: '', telefono: '', direccion: '' });
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (p: Proveedor) => {
    setEditando(p);
    setForm({
      nombre:    p.nombre,
      email:     p.email,
      telefono:  p.telefono ?? '',
      direccion: p.direccion ?? '',
    });
    setError('');
    setModalOpen(true);
  };

  const handleGuardar = async () => {
    if (!form.nombre || !form.email) {
      setError('Nombre y email son obligatorios');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editando) {
        await proveedoresApi.editar(editando.id, form);
      } else {
        await proveedoresApi.crear(form);
      }
      setModalOpen(false);
      cargar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleEliminar = async (p: Proveedor) => {
    if (!confirm(`¿Desactivar proveedor "${p.nombre}"?`)) return;
    await proveedoresApi.eliminar(p.id);
    cargar();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <SpinnerColaBlanca />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Proveedores</h1>
          <p className="text-xs text-gray-400 mt-0.5">{proveedores.length} proveedor{proveedores.length !== 1 ? 'es' : ''}</p>
        </div>
        <button
          onClick={abrirNuevo}
          className="flex items-center gap-2 rounded-lg bg-loga-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-loga-red-dark transition-colors shadow-sm"
        >
          <Plus size={16} /> Nuevo Proveedor
        </button>
      </div>

      {/* Barra de búsqueda */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o email…"
          className="pl-9 w-full sm:w-72"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {proveedores
          .filter((p) => {
            if (!busqueda.trim()) return true;
            const q = busqueda.toLowerCase();
            return p.nombre.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
          })
          .map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 shrink-0">
                  <Truck size={18} className="text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{p.nombre}</p>
                  {p.num_productos && (
                    <p className="text-[11px] text-gray-400">
                      {p.num_productos} producto{Number(p.num_productos) !== 1 ? 's' : ''} asignado{Number(p.num_productos) !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => abrirEditar(p)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleEliminar(p)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-loga-red transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <Mail size={12} className="text-gray-400 shrink-0" />
                <a href={`mailto:${p.email}`} className="truncate hover:text-loga-red transition-colors">
                  {p.email}
                </a>
              </div>
              {p.telefono && (
                <div className="flex items-center gap-2">
                  <Phone size={12} className="text-gray-400 shrink-0" />
                  <span>{p.telefono}</span>
                </div>
              )}
              {p.direccion && (
                <div className="flex items-start gap-2">
                  <MapPin size={12} className="text-gray-400 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{p.direccion}</span>
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {proveedores.length === 0 && (
          <div className="col-span-full flex flex-col items-center py-16 text-gray-300">
            <Truck size={48} className="mb-3" />
            <p className="text-sm text-gray-400">No hay proveedores. Crea el primero.</p>
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editando ? 'Editar Proveedor' : 'Nuevo Proveedor'}
      >
        <div className="space-y-4">
          <FormField label="Nombre" required>
            <Input
              value={form.nombre}
              onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
              placeholder="Química del Norte S.L."
            />
          </FormField>

          <FormField label="Email de contacto" required hint="Se usará para enviar pedidos de stock">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="pedidos@proveedor.com"
            />
          </FormField>

          <FormField label="Teléfono">
            <Input
              type="tel"
              value={form.telefono}
              onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
              placeholder="+34 912 000 000"
            />
          </FormField>

          <FormField label="Dirección">
            <Textarea
              rows={2}
              value={form.direccion}
              onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
              placeholder="Calle, ciudad…"
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
              {saving ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear proveedor'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
