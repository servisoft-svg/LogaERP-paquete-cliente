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
  sds_url?: string | null;
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
}

export interface PasoReceta {
  fase: string;
  titulo: string;
  descripcion: string;
  temperatura?: string;
  duracion_min?: number;
  ingredientes_ids?: string[];
  color?: string;
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
