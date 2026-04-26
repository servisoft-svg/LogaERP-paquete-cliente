export type EstadoLote      = 'cuarentena' | 'aprobado' | 'rechazado';
export type TipoMovimiento  = 'entrada' | 'salida' | 'ajuste' | 'produccion_consumo' | 'produccion_salida' | 'merma';
export type EstadoOrden     = 'borrador' | 'confirmada' | 'en_proceso' | 'completada' | 'cancelada';
export type TipoProducto    = 'materia_prima' | 'producto_terminado' | 'material_embalaje';

export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  tipo: TipoProducto;
  unidad_medida: string;
  stock_actual: string;   // NUMERIC viene como string desde pg
  stock_minimo: string;
  stock_maximo: string;
  precio_unitario: string;
  proveedor_id?: string;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Lote {
  id: string;
  producto_id: string;
  lote_interno: string;
  lote_proveedor?: string;
  cantidad_inicial: string;
  cantidad_actual: string;
  fecha_fabricacion?: Date;
  fecha_caducidad?: Date;
  fecha_entrada: Date;
  estado: EstadoLote;
  ubicacion?: string;
  observaciones?: string;
}

export interface Receta {
  id: string;
  producto_id: string;
  nombre: string;
  version: number;
  rendimiento: string;
  activa: boolean;
  notas?: string;
}

export interface IngredienteReceta {
  id: string;
  receta_id: string;
  materia_prima_id: string;
  cantidad: string;
  porcentaje_merma: string;
  unidad_medida: string;
}

export interface OrdenProduccion {
  id: string;
  numero_orden: string;
  receta_id: string;
  cantidad_planificada: string;
  cantidad_producida: string;
  estado: EstadoOrden;
  lote_producido_id?: string;
  fecha_planificada?: Date;
  fecha_inicio?: Date;
  fecha_fin?: Date;
  operario_id?: string;
  notas?: string;
}

export interface StockMove {
  id: string;
  producto_id: string;
  lote_id?: string;
  tipo: TipoMovimiento;
  cantidad: string;
  cantidad_antes: string;
  cantidad_despues: string;
  orden_id?: string;
  referencia_externa?: string;
  usuario_id?: string;
  motivo?: string;
  created_at: Date;
}

export interface ConfirmarProduccionPayload {
  orden_id: string;
  usuario_id?: string;
  notas?: string;
}

export interface ApiError {
  codigo: string;
  mensaje: string;
  detalle?: string;
}

// Tipo helper: convierte strings NUMERIC a number
export function toNum(val: string | number): number {
  return typeof val === 'number' ? val : parseFloat(val);
}
