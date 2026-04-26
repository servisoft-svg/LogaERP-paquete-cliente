/**
 * Middleware de auditoría automática
 * Registra TODAS las operaciones POST/PUT/DELETE en la tabla auditoria
 */
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';

// Mapeo de rutas a acciones legibles
const ACCIONES: Record<string, string> = {
  'POST /api/productos': 'CREAR_PRODUCTO',
  'PUT /api/productos': 'EDITAR_PRODUCTO',
  'DELETE /api/productos': 'DESACTIVAR_PRODUCTO',
  'POST /api/productos/importar': 'IMPORTAR_PRODUCTOS',
  'POST /api/recetas': 'CREAR_RECETA',
  'PUT /api/recetas': 'EDITAR_RECETA',
  'DELETE /api/recetas': 'DESACTIVAR_RECETA',
  'POST /api/recetas/importar': 'IMPORTAR_RECETAS',
  'POST /api/recetas/ingredientes': 'AÑADIR_INGREDIENTE',
  'PUT /api/recetas/ingredientes': 'EDITAR_INGREDIENTE',
  'DELETE /api/recetas/ingredientes': 'ELIMINAR_INGREDIENTE',
  'POST /api/produccion': 'CREAR_ORDEN',
  'PUT /api/produccion': 'EDITAR_ORDEN',
  'DELETE /api/produccion': 'ELIMINAR_ORDEN',
  'POST /api/produccion/confirmar': 'CONFIRMAR_PRODUCCION',
  'POST /api/produccion/adjuntar': 'ADJUNTAR_ARCHIVO',
  'POST /api/pedidos': 'CREAR_PEDIDO',
  'PUT /api/pedidos': 'EDITAR_PEDIDO',
  'DELETE /api/pedidos': 'CANCELAR_PEDIDO',
  'POST /api/pedidos/consumir': 'CONSUMIR_STOCK_PEDIDO',
  'POST /api/pedidos/enviar-albaran': 'ENVIAR_ALBARAN',
  'POST /api/clientes': 'CREAR_CLIENTE',
  'PUT /api/clientes': 'EDITAR_CLIENTE',
  'DELETE /api/clientes': 'DESACTIVAR_CLIENTE',
  'POST /api/proveedores': 'CREAR_PROVEEDOR',
  'PUT /api/proveedores': 'EDITAR_PROVEEDOR',
  'DELETE /api/proveedores': 'DESACTIVAR_PROVEEDOR',
  'POST /api/stock/ajuste': 'AJUSTE_STOCK',
  'POST /api/stock/pedido': 'PEDIDO_STOCK',
  'PUT /api/configuracion': 'CAMBIAR_CONFIGURACION',
  'POST /api/configuracion/backup': 'CREAR_BACKUP',
  'POST /api/configuracion/restaurar': 'RESTAURAR_BACKUP',
  'POST /api/configuracion/enviar-email': 'ENVIAR_EMAIL',
  'POST /api/auth/register': 'CREAR_USUARIO',
};

function getAccion(method: string, path: string): string | null {
  // Intentar match exacto primero, luego parcial
  for (const [pattern, accion] of Object.entries(ACCIONES)) {
    const [m, p] = pattern.split(' ');
    if (method === m && path.startsWith(p)) return accion;
  }
  return null;
}

function getDetalle(req: Request, res: Response): string {
  const body = req.body ?? {};
  const id = req.params?.id;
  const parts: string[] = [];

  if (body.nombre) parts.push(body.nombre);
  if (body.codigo) parts.push(body.codigo);
  if (body.estado) parts.push(`estado: ${body.estado}`);
  if (body.cantidad) parts.push(`cantidad: ${body.cantidad}`);
  if (body.cantidad_planificada) parts.push(`cantidad: ${body.cantidad_planificada}`);
  if (body.email) parts.push(body.email);
  if (id) parts.push(`id: ${id.slice(0, 8)}`);

  return parts.join(' · ') || '—';
}

export function auditoriaMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();

  const accion = getAccion(req.method, req.path);
  if (!accion) return next();

  // Capturar respuesta para registrar después
  const originalSend = res.send.bind(res);
  res.send = function (body: any) {
    // Solo auditar si la respuesta fue exitosa (2xx)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const userId = (req as any).user?.id ?? null;
      const detalle = getDetalle(req, res);
      const tabla = req.path.split('/')[2] ?? '—'; // /api/productos/xxx → productos

      pool.query(
        `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, accion, tabla, req.params?.id ?? null, detalle]
      ).catch(() => {}); // No bloquear si falla
    }
    return originalSend(body);
  };

  next();
}
