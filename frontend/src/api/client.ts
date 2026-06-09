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
  // Botes compatibles con una caja: lista y reemplazo (PUT atómico).
  listarBotesCompatibles: (cajaId: string) => api.get(`/productos/${cajaId}/botes-compatibles`),
  setBotesCompatibles: (cajaId: string, data: { bote_ids: string[]; botes_por_caja?: number }) =>
    api.put(`/productos/${cajaId}/botes-compatibles`, data),
  // Inverso: cajas compatibles con un bote (PE o frasco-ME).
  listarCajasCompatibles: (boteId: string) => api.get(`/productos/${boteId}/cajas-compatibles`),
  setCajasCompatibles: (boteId: string, data: { caja_ids: string[] }) =>
    api.put(`/productos/${boteId}/cajas-compatibles`, data),
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
  historial: (id: string) => api.get(`/recetas/${id}/historial`),
  restaurar: (id: string, historialId: string) => api.post(`/recetas/${id}/restaurar/${historialId}`),
  eliminarHistorial: (id: string, historialId: string) => api.delete(`/recetas/${id}/historial/${historialId}`),
};

export const recetasEnvasadoApi = {
  listar:  () => api.get('/recetas-envasado'),
  obtener: (id: string) => api.get(`/recetas-envasado/${id}`),
  crear:   (data: object) => api.post('/recetas-envasado', data),
  editar:  (id: string, data: object) => api.put(`/recetas-envasado/${id}`, data),
  eliminar:(id: string) => api.delete(`/recetas-envasado/${id}`),
  simular: (data: object) => api.post('/recetas-envasado/simular', data),
  ejecutar:(data: object) => api.post('/recetas-envasado/ejecutar', data),
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
  precios: (id: string) => api.get(`/clientes/${id}/precios`),
  archivar: (id: string, motivo?: string) => api.post(`/clientes/${id}/archivar`, { motivo }),
  recuperar: (id: string) => api.post(`/clientes/${id}/recuperar`),
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
  pedidosProveedor:   (params?: { estado?: string; producto_id?: string }) => api.get('/stock/pedidos-proveedor', { params }),
};

export const produccionApi = {
  listar:    (estado?: string) => api.get('/produccion', { params: estado ? { estado } : {} }),
  crear:     (data: object) => api.post('/produccion', data),
  confirmar: (id: string, data?: {
    ph?: string; solidos?: string; viscosidad?: string;
    fecha_fabricacion?: string; fotos?: File[]; cantidad_real_producida?: string; registro_limpieza?: string;
    fecha_inicio_cliente?: string;
    ingredientes_ajustados?: { materia_prima_id: string; cantidad: number }[];
    lotes_override?: { materia_prima_id: string; lotes: { lote_id: string; cantidad: number }[] }[];
  }) => {
    const hasAjustes = data?.ingredientes_ajustados && data.ingredientes_ajustados.length > 0;
    const hasLotesOverride = data?.lotes_override && data.lotes_override.length > 0;
    const hasData = data && (data.ph || data.solidos || data.viscosidad || data.fecha_fabricacion || data.cantidad_real_producida || data.registro_limpieza || data.fecha_inicio_cliente || (data.fotos && data.fotos.length > 0) || hasAjustes || hasLotesOverride);
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
      if (hasLotesOverride) fd.append('lotes_override', JSON.stringify(data!.lotes_override));
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
  etiquetaPdf: (id: string, params?: {
    lote?: string; cantidad?: number; unidad?: string; contenedorText?: string;
    titulo?: string; subtitulo?: string; qr?: string;
  }) =>
    api.get(`/produccion/${id}/etiqueta.pdf`, { params, responseType: 'blob' }),
  etiquetaEzpx: (id: string, params?: {
    lote?: string; cantidad?: number; unidad?: string; contenedorText?: string;
    titulo?: string; subtitulo?: string;
  }) =>
    api.get(`/produccion/${id}/etiqueta.ezpx`, { params, responseType: 'blob' }),
  // Defaults sugeridos para el preview: trae el lote y cantidad reales de la orden.
  etiquetaDefaults: (id: string) => api.get(`/produccion/${id}/etiqueta-defaults`),
  eliminar:  (id: string, modo?: 'revertir' | 'borrar') => api.delete(`/produccion/${id}`, { params: modo ? { modo } : {} }),
  envasadoRapido: (data: { cola_id: string; envase_id: string; etiqueta_id?: string; cantidad_unidades: number; formato_label?: string }) => api.post('/produccion/envasado-rapido', data),
  envasadoPlanificar: (data: { producto_final_id?: string; cola_id: string; envase_id: string; cantidad_unidades: number; fecha_planificada?: string; cliente?: string; cliente_id?: string; formato_label?: string; notas?: string; materiales?: { producto_id: string; cantidad: number }[] }) => api.post('/produccion/envasado-planificar', data),
  previewEnvasado: (id: string) => api.get(`/produccion/${id}/preview-envasado`),
  confirmarEnvasado: (id: string) => api.post(`/produccion/${id}/confirmar-envasado`),
  origenLote: (loteId: string) => api.get(`/produccion/lote/${loteId}/origen`),
  dashboard: (mes?: string) => api.get('/produccion/dashboard', { params: mes ? { mes } : {} }),
  // Dosificación parcial — echadas durante la fabricación
  listarDosificaciones: (ordenId: string) => api.get(`/produccion/${ordenId}/dosificaciones`),
  // Confirmaciones manuales (source-of-truth en BD, sustituye localStorage)
  listarConfirmaciones: (ordenId: string) => api.get(`/produccion/${ordenId}/confirmaciones`),
  confirmarIngrediente:  (ordenId: string, ingrediente_receta_id: string, paso_index: number) =>
    api.post(`/produccion/${ordenId}/confirmaciones`, { ingrediente_receta_id, paso_index }),
  deshacerIngrediente:   (ordenId: string, ingrediente_receta_id: string, paso_index: number) =>
    api.delete(`/produccion/${ordenId}/confirmaciones/${ingrediente_receta_id}?paso=${paso_index}`),
  reiniciarConfirmaciones: (ordenId: string) =>
    api.delete(`/produccion/${ordenId}/confirmaciones`),
  dosificar: (ordenId: string, data: { producto_id: string; lote_id?: string | null; cantidad: number; notas?: string; ingrediente_receta_id?: string; paso_index?: number | null }) =>
    api.post(`/produccion/${ordenId}/dosificar`, data),
  revertirDosificacion: (ordenId: string, dosifId: string) =>
    api.delete(`/produccion/${ordenId}/dosificar/${dosifId}`),
  // Admin firma la revisión pre-fabricación + persiste el override de lotes.
  // Después cualquier operario entra directo a producción con esos lotes.
  revisarLotes: (ordenId: string, lotes_override: Array<{ materia_prima_id: string; lotes: { lote_id: string; cantidad: number }[] }>) =>
    api.post(`/produccion/${ordenId}/revisar-lotes`, { lotes_override }),
  // Apunta al nuevo endpoint /api/recordatorios — filtra por usuario destinatario.
  recordatorios: (mes?: string) => api.get('/recordatorios', { params: mes ? { mes } : {} }),
  crearRecordatorio: (data: { fecha: string; titulo: string; descripcion?: string; color?: string }) => api.post('/recordatorios', data),
  moverRecordatorio: (id: string, fecha: string) => api.put(`/recordatorios/${id}`, { fecha }),
  eliminarRecordatorio: (id: string) => api.delete(`/recordatorios/${id}`),
  marcarRecordatorioLeido: (id: string) => api.post(`/recordatorios/${id}/marcar-entregado`),
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
  porCliente: (clienteId: string, limit = 20) => api.get('/pedidos', { params: { cliente_id: clienteId, limit: String(limit) } }),
  crear:    (data: object) => api.post('/pedidos', data),
  editar:   (id: string, data: object) => api.put(`/pedidos/${id}`, data),
  consumir: (id: string, lotesOverride?: Record<string, string[] | Array<{ lote_id: string; cantidad: number }>>) =>
    api.post(`/pedidos/${id}/consumir`, { lotes_override: lotesOverride }),
  lotesDisponibles: (id: string) => api.get(`/pedidos/${id}/lotes-disponibles`),
  desgloseCoste: (id: string) => api.get(`/pedidos/${id}/desglose-coste`),
  cancelar: (id: string) => api.delete(`/pedidos/${id}`),
  // Cajas compatibles con un bote (PE/ME): usado para autoenlazar caja al hacer pedido
  cajasCompatiblesPara: (boteId: string) => api.get(`/productos/${boteId}/cajas-compatibles`),
  descargarAlbaran: (id: string) => api.get(`/pedidos/${id}/albaran.pdf`, { responseType: 'blob' }),
  enviarAlbaran: (id: string, email: string) => api.post(`/pedidos/${id}/enviar-albaran`, { email }),
  // Hoja de preparación PDF para el operario (checklist materiales).
  descargarPreparacion: (id: string) => api.get(`/pedidos/${id}/preparacion.pdf`, { responseType: 'blob' }),
  // Fotos del pedido empaquetado (respaldo ante incidencias).
  listarFotos: (id: string) => api.get(`/pedidos/${id}/fotos`),
  subirFotos: (id: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('fotos', f);
    return api.post(`/pedidos/${id}/fotos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  borrarFoto: (id: string, filename: string) => api.delete(`/pedidos/${id}/fotos/${filename}`),
  // Material de embalaje EXTRA (precio>0 → aparece en albarán/factura como línea).
  listarEmbalajesExtra: (id: string) => api.get(`/pedidos/${id}/embalajes-extra`),
  agregarEmbalajeExtra: (id: string, data: { producto_id: string; cantidad: number; notas?: string; precio_unitario?: number }) =>
    api.post(`/pedidos/${id}/embalajes-extra`, data),
  editarEmbalajeExtra: (id: string, extraId: string, data: { precio_unitario?: number; cantidad?: number; notas?: string }) =>
    api.put(`/pedidos/${id}/embalajes-extra/${extraId}`, data),
  borrarEmbalajeExtra: (id: string, extraId: string) =>
    api.delete(`/pedidos/${id}/embalajes-extra/${extraId}`),
};

export const configuracionApi = {
  obtener:        () => api.get('/configuracion'),
  editar:         (data: object) => api.put('/configuracion', data),
  recheckAlertas: () => api.post('/configuracion/recheck-alertas'),
  testSmtp:       () => api.post('/configuracion/test-smtp'),
  // Backup puede tardar bastante (pg_dump + cifrado + subida a Drive). 5 min de margen.
  backup:         () => api.post('/configuracion/backup', undefined, { timeout: 300_000 }),
  backupStatus:   () => api.get('/configuracion/backup-status'),
  backupPasswordStatus: () => api.get('/configuracion/backup-password'),
  backupPasswordSet:    (password: string) => api.put('/configuracion/backup-password', { password }),
  gdriveStatus:         () => api.get('/configuracion/gdrive'),
  gdriveSave:           (data: { client_id: string; client_secret: string; folder_id?: string }) => api.put('/configuracion/gdrive', data),
  gdriveAuthorize:      (redirectUri: string) => api.get('/configuracion/gdrive/authorize', { params: { redirect_uri: redirectUri } }),
  gdriveCallback:       (code: string, redirectUri: string) => api.post('/configuracion/gdrive/callback', { code, redirect_uri: redirectUri }),
  gdriveDisconnect:     () => api.post('/configuracion/gdrive/disconnect'),
  listarBackups:  () => api.get('/configuracion/backups'),
  restaurarBackup:(filename: string) => api.post('/configuracion/restaurar', { filename }),
  enviarEmail:    (data: { to: string; subject: string; body: string }) => api.post('/configuracion/enviar-email', data),
  auditoria:      (params?: Record<string, string | number | undefined>) =>
                     api.get('/configuracion/auditoria', { params: params as Record<string, string | number> | undefined }),
  auditoriaAcciones: () => api.get('/configuracion/auditoria/acciones'),
  // Sub-categorías de materias primas (catálogo editable)
  listarSubcategoriasMP: () => api.get('/configuracion/subcategorias-mp'),
  crearSubcategoriaMP:   (data: { nombre: string; orden?: number }) => api.post('/configuracion/subcategorias-mp', data),
  editarSubcategoriaMP:  (id: string, data: { nombre?: string; orden?: number; activo?: boolean }) =>
    api.put(`/configuracion/subcategorias-mp/${id}`, data),
  eliminarSubcategoriaMP: (id: string) => api.delete(`/configuracion/subcategorias-mp/${id}`),
  // Integración Alilo (admin: status, log, regenerar secret)
  aliloStatus: () => api.get('/configuracion/integracion/alilo/status'),
  aliloLog:    () => api.get('/configuracion/integracion/alilo/log'),
  aliloRegenerarSecret: () => api.post('/configuracion/integracion/alilo/regenerar-secret'),
  // Sub-categorías de material de embalaje (catálogo editable: Bote, Caja, Etiqueta…)
  listarSubcategoriasME: () => api.get('/configuracion/subcategorias-me'),
  crearSubcategoriaME:   (data: { nombre: string; orden?: number }) => api.post('/configuracion/subcategorias-me', data),
  editarSubcategoriaME:  (id: string, data: { nombre?: string; orden?: number; activo?: boolean }) =>
    api.put(`/configuracion/subcategorias-me/${id}`, data),
  eliminarSubcategoriaME: (id: string) => api.delete(`/configuracion/subcategorias-me/${id}`),
  // Tipos de material de embalaje (Plástico, Cartón, Madera…)
  listarTiposMaterial: () => api.get('/configuracion/tipos-material-embalaje'),
  crearTipoMaterial:   (data: { nombre: string; orden?: number }) => api.post('/configuracion/tipos-material-embalaje', data),
  editarTipoMaterial:  (id: string, data: { nombre?: string; orden?: number; activo?: boolean }) =>
    api.put(`/configuracion/tipos-material-embalaje/${id}`, data),
  eliminarTipoMaterial: (id: string) => api.delete(`/configuracion/tipos-material-embalaje/${id}`),
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
  listar:       (tipo?: string) => api.get('/controles-calidad', { params: tipo ? { tipo } : {} }),
  lotesEstado:  () => api.get('/controles-calidad/lotes-estado'),
  crear:        (data: object) => api.post('/controles-calidad', data),
  confirmar:    (id: string, data?: object) => api.post(`/controles-calidad/${id}/confirmar`, data ?? {}),
  editar:       (id: string, data: object) => api.put(`/controles-calidad/${id}`, data),
  eliminar:     (id: string) => api.delete(`/controles-calidad/${id}`),
};

export const cambioApi = {
  todas:    () => api.get('/cambio'),
  obtener:  (divisa: string) => api.get(`/cambio/${divisa}`),
};

export const portesApi = {
  provincias: () => api.get<string[]>('/portes/provincias'),
  calcular: (data: { peso: number; provincia: string; numPallets?: number; servicio?: 'ECONOMY' | 'PREMIUM' }) =>
    api.post('/portes/calcular', data),
  getConfig: () => api.get<{ subida: number; seguro: number; combustible: number; actualizado_at?: string }>('/portes/config'),
  setConfig: (data: { subida: number; seguro: number; combustible: number }) => api.put('/portes/config', data),
  plantillaPaletrapid: () => api.get('/portes/tarifas/paletrapid/plantilla', { responseType: 'blob' }),
  plantillaPalletways: () => api.get('/portes/tarifas/palletways/plantilla', { responseType: 'blob' }),
  importarPaletrapid: (file: File) => {
    const fd = new FormData(); fd.append('archivo', file);
    return api.post('/portes/tarifas/paletrapid/importar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  importarPalletways: (file: File) => {
    const fd = new FormData(); fd.append('archivo', file);
    return api.post('/portes/tarifas/palletways/importar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

export const recordatoriosApi = {
  listar:           (mes?: string) => api.get('/recordatorios', { params: mes ? { mes } : {} }),
  pendientes:       () => api.get('/recordatorios/pendientes'),
  crear:            (data: object) => api.post('/recordatorios', data),
  editar:           (id: string, data: object) => api.put(`/recordatorios/${id}`, data),
  marcarEntregado:  (id: string) => api.post(`/recordatorios/${id}/marcar-entregado`),
  eliminar:         (id: string) => api.delete(`/recordatorios/${id}`),
};

export const specsApi = {
  catalogo:        () => api.get('/specs/catalogo'),
  catalogoCrear:   (data: object) => api.post('/specs/catalogo', data),
  catalogoEditar:  (id: number, data: object) => api.put(`/specs/catalogo/${id}`, data),
  catalogoBorrar:  (id: number) => api.delete(`/specs/catalogo/${id}`),
  productoSpecs:   (productoId: string) => api.get(`/specs/producto/${productoId}`),
  guardarProducto: (productoId: string, specs: object[]) => api.put(`/specs/producto/${productoId}`, specs),
  loteSpecs:       (loteId: string) => api.get(`/specs/lote/${loteId}`),
};

export const facturasApi = {
  // Usamos fetch directo (no axios) porque axios tenía conflictos con su
  // Content-Type default cuando subimos FormData. Fetch nativo no tiene ese
  // problema y deja al browser poner el boundary multipart correcto.
  parse: async (file: File) => {
    const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token');
    const fd = new FormData();
    fd.append('factura', file);
    const base = (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api');
    const res = await fetch(`${base}/facturas/parse`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { error?: string })?.error ?? `Error ${res.status}`;
      throw Object.assign(new Error(msg), { response: { status: res.status, data } });
    }
    return { data };
  },
  // Devuelve URL absoluta con token en query para usar en <iframe src>.
  // El backend valida token via query y lee el archivo de uploads/.
  fileUrl: (archivoUrl: string): string => {
    const token = localStorage.getItem('loga_token') || sessionStorage.getItem('loga_token');
    const base = (import.meta.env.VITE_API_URL ?? '');
    return `${base}${archivoUrl}?token=${encodeURIComponent(token ?? '')}`;
  },
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
    const data = error.response?.data;

    // `error` siempre string (compat). `error_info` lleva el código simbólico.
    const codigo: string | undefined = data?.error_info?.codigo;
    const msg: string = (typeof data?.error === 'string' ? data.error : '')
      || data?.mensaje
      || data?.error_info?.mensaje
      || '';

    // Retry en conflictos de concurrencia (max 2). El backend ya mapea pg 40001
    // a CONFLICTO_CONCURRENCIA; los 500 antiguos por keywords siguen cubiertos.
    const isSerializationError = codigo === 'CONFLICTO_CONCURRENCIA' || (status === 500 && (
      msg.includes('serializ') || msg.includes('could not serialize') ||
      msg.includes('deadlock') || msg.includes('concurrent')
    ));
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

// Helpers para componentes: extraen código simbólico, mensaje y detalles del
// error de axios sin tener que conocer la forma exacta de la respuesta.
// Uso típico:
//   try { ... } catch (e) {
//     const { codigo, mensaje } = parseApiError(e);
//     if (codigo === 'STOCK_INSUFICIENTE') notify.warn(mensaje);
//     else notify.error(mensaje);
//   }
export type ApiErrorInfo = {
  codigo?: string;
  http?: number;
  mensaje: string;
  detalles?: Record<string, unknown>;
  traceId?: string;
};

export function parseApiError(err: unknown): ApiErrorInfo {
  const ax = err as { response?: { status?: number; data?: any }; message?: string };
  const data = ax?.response?.data;
  const http = ax?.response?.status;
  const traceId = data?.traceId;
  if (data?.error_info) {
    return {
      codigo: data.error_info.codigo,
      http: data.error_info.http ?? http,
      mensaje: data.error_info.mensaje ?? (typeof data.error === 'string' ? data.error : null) ?? data.mensaje ?? 'Error',
      detalles: data.error_info.detalles,
      traceId,
    };
  }
  return {
    http,
    mensaje: (typeof data?.error === 'string' ? data.error : null) ?? data?.mensaje ?? ax?.message ?? 'Error',
    traceId,
  };
}

export function getErrorCode(err: unknown): string | undefined {
  return parseApiError(err).codigo;
}

export default api;
