import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

export const productosApi = {
  listar:  (params?: Record<string, string | boolean>) => api.get('/productos', { params }),
  obtener: (id: string) => api.get(`/productos/${id}`),
  crear:   (data: object) => api.post('/productos', data),
  editar:  (id: string, data: object) => api.put(`/productos/${id}`, data),
  eliminar:(id: string) => api.delete(`/productos/${id}`),
  importar: (data: object) => api.post('/productos/importar', data),
  subirSDS: (id: string, file: File) => { const fd = new FormData(); fd.append('sds', file); return api.post(`/productos/${id}/sds`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); },
  eliminarSDS: (id: string) => api.delete(`/productos/${id}/sds`),
};

export const recetasApi = {
  listar:  (params?: Record<string, string | boolean>) => api.get('/recetas', { params }),
  obtener: (id: string) => api.get(`/recetas/${id}`),
  crear:   (data: object) => api.post('/recetas', data),
  editar:  (id: string, data: object) => api.put(`/recetas/${id}`, data),
  eliminar:(id: string) => api.delete(`/recetas/${id}`),
  addIngrediente:    (recetaId: string, data: object) => api.post(`/recetas/${recetaId}/ingredientes`, data),
  editarIngrediente: (recetaId: string, ingId: string, data: object) => api.put(`/recetas/${recetaId}/ingredientes/${ingId}`, data),
  eliminarIngrediente: (recetaId: string, ingId: string) => api.delete(`/recetas/${recetaId}/ingredientes/${ingId}`),
  importar: (data: object) => api.post('/recetas/importar', data),
};

export const proveedoresApi = {
  listar:  () => api.get('/proveedores'),
  obtener: (id: string) => api.get(`/proveedores/${id}`),
  crear:   (data: object) => api.post('/proveedores', data),
  editar:  (id: string, data: object) => api.put(`/proveedores/${id}`, data),
  eliminar:(id: string) => api.delete(`/proveedores/${id}`),
};

export const clientesApi = {
  listar:  (params?: Record<string, string | boolean>) => api.get('/clientes', { params }),
  obtener: (id: string) => api.get(`/clientes/${id}`),
  crear:   (data: object) => api.post('/clientes', data),
  editar:  (id: string, data: object) => api.put(`/clientes/${id}`, data),
  eliminar:(id: string) => api.delete(`/clientes/${id}`),
};

export const stockApi = {
  listarProductos:    (params?: Record<string, string | boolean>) => api.get('/stock', { params }),
  ajustarStock:       (data: object) => api.post('/stock/ajuste', data),
  historial:          (id: string, limit?: number) => api.get(`/stock/${id}/historial`, { params: { limit } }),
  notificaciones:     (todas = false) => api.get('/stock/notificaciones', { params: { todas } }),
  enviarPedido:       (data: object) => api.post('/stock/pedido', data),
  cantidadSugerida:   (id: string) => api.get(`/stock/${id}/cantidad-sugerida`),
  reconciliar:        () => api.get('/stock/reconciliar'),
  ejecutarReconciliar:() => api.post('/stock/reconciliar'),
};

export const produccionApi = {
  listar:    (estado?: string) => api.get('/produccion', { params: estado ? { estado } : {} }),
  crear:     (data: object) => api.post('/produccion', data),
  confirmar: (id: string, data?: {
    ph?: string; solidos?: string; viscosidad?: string;
    fecha_fabricacion?: string; fotos?: File[]; cantidad_real_producida?: string; registro_limpieza?: string;
    fecha_inicio_cliente?: string;
    ingredientes_ajustados?: { materia_prima_id: string; cantidad: number }[];
  }) => {
    const hasAjustes = data?.ingredientes_ajustados && data.ingredientes_ajustados.length > 0;
    const hasData = data && (data.ph || data.solidos || data.viscosidad || data.fecha_fabricacion || data.cantidad_real_producida || data.registro_limpieza || data.fecha_inicio_cliente || (data.fotos && data.fotos.length > 0) || hasAjustes);
    if (hasData) {
      const fd = new FormData();
      if (data!.ph) fd.append('ph', data!.ph);
      if (data!.solidos) fd.append('solidos', data!.solidos);
      if (data!.viscosidad) fd.append('viscosidad', data!.viscosidad);
      if (data!.fecha_fabricacion) fd.append('fecha_fabricacion', data!.fecha_fabricacion);
      if (data!.cantidad_real_producida) fd.append('cantidad_real_producida', data!.cantidad_real_producida);
      if (data!.registro_limpieza) fd.append('registro_limpieza', data!.registro_limpieza);
      if (data!.fecha_inicio_cliente) fd.append('fecha_inicio_cliente', data!.fecha_inicio_cliente);
      if (data!.fotos) data!.fotos.forEach(f => fd.append('fotos', f));
      if (hasAjustes) fd.append('ingredientes_ajustados', JSON.stringify(data!.ingredientes_ajustados));
      return api.post(`/produccion/${id}/confirmar`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    }
    return api.post(`/produccion/${id}/confirmar`);
  },
  editar:    (id: string, data: object) => api.put(`/produccion/${id}`, data),
  detalle:   (id: string) => api.get(`/produccion/${id}/detalle`),
  adjuntar:  (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach(f => fd.append('archivos', f));
    return api.post(`/produccion/${id}/adjuntar`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  enviarTrazabilidad: (id: string, email: string) => api.post(`/produccion/${id}/enviar-trazabilidad`, { email }),
  eliminar:  (id: string, modo?: 'revertir' | 'borrar') => api.delete(`/produccion/${id}`, { params: modo ? { modo } : {} }),
  envasadoRapido: (data: { cola_id: string; envase_id: string; etiqueta_id?: string; cantidad_unidades: number; formato_label?: string }) => api.post('/produccion/envasado-rapido', data),
  envasadoPlanificar: (data: { producto_final_id?: string; cola_id: string; envase_id: string; cantidad_unidades: number; fecha_planificada?: string; cliente?: string; cliente_id?: string; formato_label?: string; notas?: string; materiales?: { producto_id: string; cantidad: number }[] }) => api.post('/produccion/envasado-planificar', data),
  previewEnvasado: (id: string) => api.get(`/produccion/${id}/preview-envasado`),
  confirmarEnvasado: (id: string) => api.post(`/produccion/${id}/confirmar-envasado`),
  origenLote: (loteId: string) => api.get(`/produccion/lote/${loteId}/origen`),
  dashboard: (mes?: string) => api.get('/produccion/dashboard', { params: mes ? { mes } : {} }),
  recordatorios: (mes?: string) => api.get('/produccion/recordatorios', { params: mes ? { mes } : {} }),
  crearRecordatorio: (data: { fecha: string; titulo: string; descripcion?: string; color?: string }) => api.post('/produccion/recordatorios', data),
  moverRecordatorio: (id: string, fecha: string) => api.put(`/produccion/recordatorios/${id}`, { fecha }),
  eliminarRecordatorio: (id: string) => api.delete(`/produccion/recordatorios/${id}`),
};

export const lotesApi = {
  listar:       (params?: Record<string, string>) => api.get('/lotes', { params }),
  crear:        (data: object) => api.post('/lotes', data),
  cambiarEstado:(id: string, estado: string, motivo: string) =>
    api.patch(`/lotes/${id}/estado`, { estado, motivo }),
  trazabilidad: (id: string) => api.get(`/lotes/${id}/trazabilidad`),
  historialEstado: (id: string) => api.get(`/lotes/${id}/historial-estado`),
  actualizar:   (id: string, data: object) => api.put(`/lotes/${id}`, data),
};

export const pedidosApi = {
  listar:   (params?: Record<string, string>) => api.get('/pedidos', { params }),
  crear:    (data: object) => api.post('/pedidos', data),
  editar:   (id: string, data: object) => api.put(`/pedidos/${id}`, data),
  consumir: (id: string, lotesOverride?: Record<string, string[]>) => api.post(`/pedidos/${id}/consumir`, { lotes_override: lotesOverride }),
  lotesDisponibles: (id: string) => api.get(`/pedidos/${id}/lotes-disponibles`),
  desgloseCoste: (id: string) => api.get(`/pedidos/${id}/desglose-coste`),
  cancelar: (id: string) => api.delete(`/pedidos/${id}`),
  descargarAlbaran: (id: string) => api.get(`/pedidos/${id}/albaran.pdf`, { responseType: 'blob' }),
  enviarAlbaran: (id: string, email: string) => api.post(`/pedidos/${id}/enviar-albaran`, { email }),
};

export const configuracionApi = {
  obtener:        () => api.get('/configuracion'),
  editar:         (data: object) => api.put('/configuracion', data),
  recheckAlertas: () => api.post('/configuracion/recheck-alertas'),
  testSmtp:       () => api.post('/configuracion/test-smtp'),
  backup:         () => api.post('/configuracion/backup'),
  backupStatus:   () => api.get('/configuracion/backup-status'),
  listarBackups:  () => api.get('/configuracion/backups'),
  restaurarBackup:(filename: string) => api.post('/configuracion/restaurar', { filename }),
  enviarEmail:    (data: { to: string; subject: string; body: string }) => api.post('/configuracion/enviar-email', data),
  auditoria:      () => api.get('/configuracion/auditoria'),
};

export const automatizacionesApi = {
  getConfig:        () => api.get('/automatizaciones/config'),
  setConfig:        (data: object) => api.put('/automatizaciones/config', data),
  productos:        () => api.get('/automatizaciones/productos'),
  setProducto:      (id: string, data: object) => api.put(`/automatizaciones/productos/${id}`, data),
  log:              (params?: Record<string, string | number>) => api.get('/automatizaciones/log', { params }),
  noLeidas:         () => api.get('/automatizaciones/log/no-leidas'),
  marcarLeidas:     (ids?: string[]) => api.post('/automatizaciones/log/marcar-leidas', ids ? { ids } : {}),
  reintentar:       (id: string) => api.post(`/automatizaciones/log/${id}/retry`),
  test:             (productoId: string) => api.post(`/automatizaciones/test/${productoId}`),
  // Reglas
  reglas:           () => api.get('/automatizaciones/reglas'),
  reglaObtener:     (id: string) => api.get(`/automatizaciones/reglas/${id}`),
  reglaCrear:       (data: object) => api.post('/automatizaciones/reglas', data),
  reglaEditar:      (id: string, data: object) => api.put(`/automatizaciones/reglas/${id}`, data),
  reglaEliminar:    (id: string) => api.delete(`/automatizaciones/reglas/${id}`),
  reglaEjecutar:    (id: string, productoId?: string) => api.post(`/automatizaciones/reglas/${id}/ejecutar`, productoId ? { producto_id: productoId } : {}),
  reglaDuplicar:    (id: string) => api.post(`/automatizaciones/reglas/${id}/duplicar`),
  sistemaRun:       (accion: string) => api.post(`/automatizaciones/sistema/${accion}/run`),
};

export const controlesCalidadApi = {
  listar:   (tipo?: string) => api.get('/controles-calidad', { params: tipo ? { tipo } : {} }),
  crear:    (data: object) => api.post('/controles-calidad', data),
  editar:   (id: string, data: object) => api.put(`/controles-calidad/${id}`, data),
  eliminar: (id: string) => api.delete(`/controles-calidad/${id}`),
};

export const finanzasApi = {
  resumen: (año?: number) => api.get('/finanzas/resumen', { params: año ? { año } : {} }),
  historialPrecios: (productoId?: string) => api.get('/finanzas/historial-precios', { params: productoId ? { producto_id: productoId } : {} }),
  impactoCostes: () => api.get('/finanzas/impacto-costes'),
  exportar: (tipo: string, año?: number) => api.get(`/finanzas/exportar/${tipo}`, { responseType: 'blob', params: año ? { año } : {} }),
  predicciones: () => api.get('/finanzas/predicciones'),
  informePlastico: (desde?: string, hasta?: string) => api.get('/finanzas/informe-plastico', { params: { desde, hasta }, responseType: 'blob' }),
  informePlasticoResumen: (desde?: string, hasta?: string) => api.get('/finanzas/informe-plastico/resumen', { params: { desde, hasta } }),
};

// Interceptor: auto-retry on serialization conflict (PostgreSQL 40001)
// + auto-refresh on 401 antes de logout
let refreshPromise: Promise<string> | null = null;

async function refrescarToken(): Promise<string> {
  if (refreshPromise) return refreshPromise; // dedupe concurrent refreshes
  refreshPromise = (async () => {
    const old = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token');
    if (!old) throw new Error('NO_TOKEN');
    const { data } = await api.post('/auth/refresh', {}, {
      headers: { Authorization: `Bearer ${old}` },
      _skipRefresh: true,
    } as never);
    const { token } = data as { token: string };
    const storage = localStorage.getItem('loga_token') ? localStorage : sessionStorage;
    storage.setItem('loga_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    return token;
  })();
  try { return await refreshPromise; }
  finally { refreshPromise = null; }
}

api.interceptors.response.use(
  response => response,
  async error => {
    const config = error.config ?? {};
    const status = error.response?.status;
    const msg = error.response?.data?.error ?? '';

    // Retry on 500 with serialization keywords (max 2 retries)
    const isSerializationError = status === 500 && (
      msg.includes('serializ') || msg.includes('could not serialize') ||
      msg.includes('deadlock') || msg.includes('concurrent')
    );
    if (isSerializationError && (config._retryCount ?? 0) < 2) {
      config._retryCount = (config._retryCount ?? 0) + 1;
      await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
      return api(config);
    }

    // 401 → intentar refresh y reintentar la request original UNA vez
    const path = String(config.url ?? '');
    const isAuthCall = path.includes('/auth/login') || path.includes('/auth/refresh');
    if (status === 401 && !isAuthCall && !config._refreshTried) {
      try {
        const newToken = await refrescarToken();
        config._refreshTried = true;
        config.headers = { ...(config.headers ?? {}), Authorization: `Bearer ${newToken}` };
        return api(config);
      } catch {
        // refresh falló → logout limpio
      }
    }

    // 401 sin posibilidad de refrescar → logout
    if (status === 401) {
      localStorage.removeItem('loga_token');
      sessionStorage.removeItem('loga_token');
      delete api.defaults.headers.common['Authorization'];
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
