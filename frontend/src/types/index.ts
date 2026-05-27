export type EstadoLote   = 'cuarentena' | 'aprobado' | 'rechazado';
export type EstadoOrden  = 'borrador' | 'confirmada' | 'en_proceso' | 'completada' | 'cancelada';
export type TipoProducto = 'materia_prima' | 'producto_terminado' | 'producto_fabricado' | 'producto_envasado' | 'material_embalaje';

export interface Cliente {
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  nif?: string;
  notas?: string;
  activo: boolean;
  consumo_total?: string;
  nivel?: 'oro' | 'plata' | 'bronce' | null;
  created_at: string;
}

export interface Proveedor {
  id: string;
  nombre: string;
  email: string;
  emails_adicionales?: string[] | null;
  ultimos_destinatarios?: string[] | null;
  telefono?: string;
  direccion?: string;
  activo: boolean;
  num_productos?: string;
  created_at: string;
}

export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  tipo: TipoProducto;
  subtipo?: 'granel' | 'envasado' | null;
  unidad_medida: string;
  stock_actual: string;
  stock_minimo: string;
  stock_maximo: string;
  precio_unitario: string;
  precio_venta?: string;
  proveedor_id?: string;
  proveedor_nombre?: string;
  proveedor_email?: string;
  proveedor_emails_adicionales?: string[] | null;
  proveedor_ultimos_destinatarios?: string[] | null;
  porcentaje_stock?: string;
  porcentaje_alerta?: string;
  alerta_activa?: boolean;
  nivel_stock?: 'rojo' | 'naranja' | 'verde';
  activo: boolean;
  stock_disponible?: string;
  coste_medio_actual?: string;
  version?: number;
  caducidad_meses?: number | null;
  peso_unitario_kg?: string | null;
  peso_plastico_kg?: string | null;
  sds_url?: string | null;
  granel_id?: string;
  granel_nombre?: string;
  granel_stock?: string;
  granel_unidad?: string;
  // Nº CAS (Chemical Abstracts Service)
  numero_cas?: string | null;
  // Specs físico-químicas (materia prima) — legacy, sustituido por producto_specs
  solidos_min?: string | null;
  solidos_max?: string | null;
  ph_min?: string | null;
  ph_max?: string | null;
  viscosidad_min?: string | null;
  viscosidad_max?: string | null;
  // Sub-categoría libre para materias primas (resina, agua, otros…)
  subcategoria_mp?: string | null;
  // Flag: materia prima usada como aditivo
  es_aditivo?: boolean;
  // Mensaje opcional de confirmación en fabricación (ej: "verifica viscosidad")
  confirmacion_msg?: string | null;
}

export interface SpecCatalogo {
  id: number;
  nombre: string;
  unidad?: string | null;
  decimales: number;
  rango_min?: string | null;
  rango_max?: string | null;
  activo: boolean;
}

export interface ProductoSpec {
  spec_id: number;
  nombre: string;
  unidad?: string | null;
  decimales: number;
  min_valor?: string | null;
  max_valor?: string | null;
  orden: number;
  parametros?: Record<string, string | number | null> | null;
}

export interface Lote {
  id: string;
  producto_id: string;
  producto_nombre: string;
  producto_codigo: string;
  lote_interno: string;
  lote_proveedor?: string;
  cantidad_inicial: string;
  cantidad_actual: string;
  fecha_fabricacion?: string;
  fecha_caducidad?: string;
  fecha_entrada: string;
  estado: EstadoLote;
  ubicacion?: string;
  unidad_medida: string;
  observaciones?: string;
  precio_compra?: string | null;
  created_at?: string;
  // Valores físico-químicos medidos del lote
  solidos?: string | null;
  ph?: string | null;
  viscosidad?: string | null;
}

export interface IngredienteReceta {
  id: string;
  receta_id: string;
  materia_prima_id: string;
  nombre_mp: string;
  codigo_mp: string;
  cantidad: string;
  porcentaje_merma: string;
  unidad_medida: string;
  stock_actual?: string;
  stock_disponible?: string;
  sds_url?: string | null;
  confirmacion_msg?: string | null;
}

export interface Receta {
  id: string;
  nombre: string;
  producto_id: string;
  producto_nombre: string;
  producto_codigo: string;
  unidad_medida: string;
  rendimiento: string;
  version: number;
  activa: boolean;
  notas?: string;
  num_ingredientes?: string;
  ingredientes_total?: string;
  ingredientes_sin_stock?: string;
  max_producible?: string;
  ingredientes?: IngredienteReceta[];
  ph_min?: string;
  ph_max?: string;
  solidos_min?: string;
  solidos_max?: string;
  viscosidad_min?: string;
  viscosidad_max?: string;
  pasos?: PasoReceta[];
  tipo_receta?: 'fabricacion' | 'envasado';
  created_at?: string;
  updated_at?: string;
}

export interface PasoReceta {
  fase: string;
  titulo: string;
  descripcion: string;
  temperatura?: string;
  duracion_min?: number;
  ingredientes_ids?: string[];
  color?: string;
  // Cantidad de agua a echar en este paso concreto (subdivide el total de
  // agua del ingrediente entre varios pasos). Solo aplica si la receta tiene
  // agua como ingrediente.
  cantidad_agua?: number | string;
  // Limpieza
  producto_limpieza?: string;
  limpieza_externa?: boolean;
  limpieza_proveedor?: string;
  limpieza_comentario?: string;
}

export interface OrdenProduccion {
  id: string;
  numero_orden: string;
  receta_id: string;
  receta_nombre?: string;
  producto_nombre?: string;
  cantidad_planificada: string;
  cantidad_producida: string;
  cantidad_real_producida?: string;
  merma_proceso?: string;
  merma_pct?: string;
  estado: EstadoOrden;
  cliente?: string;
  fecha_planificada?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  ph?: string;
  solidos?: string;
  viscosidad?: string;
  foto_url?: string;
  foto_urls?: string[];
  archivos?: { url: string; nombre: string; tipo: string; size: number }[];
  fecha_fabricacion?: string;
  notas?: string;
  tipo_orden?: 'fabricacion' | 'envasado';
  registro_limpieza?: string;
  cola_id?: string;
  envase_id?: string;
  formato_label?: string;
  operario_id?: string;
  operario_nombre?: string;
  operario_rol?: 'admin' | 'trabajador';
  duracion_segundos?: number;
  media_duracion_receta_segundos?: number | null;
  num_ordenes_media?: number;
  meteo?: {
    temperatura: number;
    humedad: number;
    sensacion_termica: number;
    precipitacion: number;
    weather_code: number;
    presion: number;
    viento_velocidad: number;
    viento_direccion: number;
    viento_rafagas: number;
    timestamp_utc: string;
    fuente: string;
  } | null;
  created_at: string;
}

export interface Notificacion {
  id: string;
  tipo: string;
  titulo: string;
  mensaje: string;
  producto_id: string;
  producto_nombre: string;
  producto_codigo: string;
  unidad_medida: string;
  stock_actual: string;
  stock_maximo: string;
  proveedor_email?: string;
  proveedor_nombre?: string;
  leida: boolean;
  email_enviado: boolean;
  created_at: string;
}

export type EstadoPedido = 'nuevo' | 'confirmado' | 'en_produccion' | 'fabricado' | 'envasado' | 'completado' | 'cancelado';

export interface Pedido {
  id: string;
  numero_pedido: string;
  cliente_id?: string;
  cliente_nombre?: string;
  cliente_nombre_rel?: string;
  cliente_email?: string;
  cliente_email_rel?: string;
  producto_id?: string;
  producto_nombre?: string;
  producto_nombre_rel?: string;
  producto_codigo?: string;
  cantidad?: string;
  unidad_medida?: string;
  fecha_entrega?: string;
  estado: EstadoPedido;
  origen: string;
  email_asunto?: string;
  email_cuerpo?: string;
  notas?: string;
  numero_orden?: string;
  orden_produccion_id?: string;
  subtotal?: string;
  portes?: string;
  iva_porcentaje?: string;
  total?: string;
  // Coste real: SUM(cantidad consumida × precio_compra del lote concreto).
  // Calculado server-side desde reservas_stock con estado='consumida'.
  // null si el pedido no se ha completado o no tiene lotes asociados.
  coste_real?: string | null;
  lineas?: LineaPedido[];
  created_at: string;
}

export interface LineaPedido {
  id: string;
  producto_id?: string;
  producto_nombre?: string;
  producto_nombre_rel?: string;
  producto_codigo?: string;
  producto_unidad?: string;
  cantidad?: string;
  unidad_medida?: string;
  precio_unitario?: string;
  subtotal?: string;
  notas?: string;
}

export type EstadoCompra = 'borrador' | 'enviada' | 'recibida' | 'cancelada';

export interface OrdenCompra {
  id: string;
  numero_oc: string;
  proveedor_id?: string;
  proveedor_nombre?: string;
  producto_id: string;
  producto_nombre?: string;
  producto_codigo?: string;
  unidad_medida?: string;
  cantidad: string;
  precio_unitario: string;
  estado: EstadoCompra;
  fecha_pedido?: string;
  fecha_entrega_estimada?: string;
  fecha_recepcion?: string;
  notas?: string;
  created_at: string;
}
