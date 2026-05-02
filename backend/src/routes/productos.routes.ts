import { Router } from 'express';
import { pool } from '../db/pool';
import { invalidarCacheFinanzas } from './finanzas.routes';

const router = Router();

// Validaciones reusables (Fix #24) — POST y bulk import.
const TIPOS_VALIDOS = new Set(['materia_prima', 'producto_fabricado', 'producto_envasado', 'material_embalaje']);
const UNIDADES_VALIDAS = new Set(['kg', 'g', 'l', 'ml', 'unidad', 'm', 'cm', 'caja', 'rollo']);
function validarProductoPayload(p: any): string | null {
  if (!p || typeof p !== 'object') return 'payload vacío';
  if (!p.nombre || typeof p.nombre !== 'string' || p.nombre.trim().length === 0) return 'nombre obligatorio';
  if (p.nombre.length > 200) return 'nombre máximo 200 caracteres';
  if (!p.tipo || !TIPOS_VALIDOS.has(p.tipo)) return `tipo debe ser uno de: ${[...TIPOS_VALIDOS].join(', ')}`;
  if (p.unidad_medida && !UNIDADES_VALIDAS.has(p.unidad_medida)) return `unidad_medida no válida: ${p.unidad_medida}`;
  if (p.codigo && (typeof p.codigo !== 'string' || p.codigo.length > 50)) return 'codigo máximo 50 caracteres';
  if (p.descripcion && (typeof p.descripcion !== 'string' || p.descripcion.length > 2000)) return 'descripcion máximo 2000 caracteres';
  for (const f of ['stock_minimo', 'stock_maximo', 'precio_unitario', 'precio_venta'] as const) {
    if (p[f] != null) {
      const n = Number(p[f]);
      if (!Number.isFinite(n)) return `${f} debe ser un número finito`;
      if (n < 0) return `${f} no puede ser negativo`;
      if (n > 1e9) return `${f} excede el máximo permitido (1e9)`;
    }
  }
  if (p.stock_minimo != null && p.stock_maximo != null && Number(p.stock_minimo) > Number(p.stock_maximo)) {
    return 'stock_minimo no puede ser mayor que stock_maximo';
  }
  return null;
}

// POST /api/productos/importar
router.post('/importar', async (req, res) => {
  try {
    const { productos } = req.body;
    if (!Array.isArray(productos)) return res.status(400).json({ error: 'productos debe ser un array' });
    if (productos.length > 1000) return res.status(400).json({ error: 'Máximo 1000 productos por import' });

    let creados = 0;
    const errores: string[] = [];
    for (const [i, p] of productos.entries()) {
      const validationErr = validarProductoPayload(p);
      if (validationErr) {
        errores.push(`fila ${i}: ${validationErr}`);
        continue;
      }
      // Auto-generate code if missing
      let codigo = p.codigo;
      if (!codigo) {
        const prefijo = p.tipo === 'materia_prima' ? 'MP' : p.tipo === 'producto_terminado' ? 'PT' : 'ME';
        const { rows: [maxRow] } = await pool.query(
          `SELECT codigo FROM productos WHERE codigo LIKE $1 || '-%' ORDER BY codigo DESC LIMIT 1`, [prefijo]
        );
        let nextNum = 1;
        if (maxRow) {
          const match = maxRow.codigo.match(new RegExp(`^${prefijo}-(\\d+)`));
          if (match) nextNum = parseInt(match[1], 10) + 1;
        }
        codigo = `${prefijo}-${String(nextNum).padStart(3, '0')}`;
      }

      await pool.query(
        `INSERT INTO productos (codigo, nombre, descripcion, tipo, unidad_medida, stock_minimo, stock_maximo, precio_unitario, precio_venta)
         VALUES ($1, $2, $3, $4, $5, $6::NUMERIC, $7::NUMERIC, $8::NUMERIC, $9::NUMERIC)
         ON CONFLICT (codigo) DO NOTHING`,
        [codigo.toUpperCase(), p.nombre, p.descripcion ?? null, p.tipo, p.unidad_medida ?? 'kg',
         Number(p.stock_minimo ?? 0).toFixed(6), Number(p.stock_maximo ?? 0).toFixed(6),
         Number(p.precio_unitario ?? 0).toFixed(6), Number(p.precio_venta ?? 0).toFixed(6)]
      );
      creados++;
    }
    res.json({ ok: true, creados, ...(errores.length > 0 ? { errores } : {}) });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/productos
router.get('/', async (req, res) => {
  try {
    const { tipo, busqueda, activo } = req.query;
    let sql = `
      SELECT p.*, pv.nombre AS proveedor_nombre, pv.email AS proveedor_email,
        pg.nombre AS granel_nombre, pg.stock_actual AS granel_stock, pg.unidad_medida AS granel_unidad,
        p.stock_actual - COALESCE((SELECT SUM(r.cantidad) FROM reservas_stock r WHERE r.producto_id = p.id AND r.estado = 'activa'), 0) AS stock_disponible,
        CASE WHEN p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo THEN TRUE ELSE FALSE END AS alerta_activa,
        CASE
          WHEN p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo THEN 'rojo'
          WHEN p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo * (1 + COALESCE((SELECT porcentaje_alerta FROM configuracion_global LIMIT 1), 20) / 100.0) THEN 'naranja'
          ELSE 'verde'
        END AS nivel_stock
      FROM productos p
      LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
      LEFT JOIN productos pg ON pg.id = p.granel_id
      WHERE 1=1
    `;
    const params: string[] = [];
    let idx = 1;

    if (tipo)    { sql += ` AND p.tipo = $${idx++}`;   params.push(String(tipo)); }
    if (activo !== undefined) { sql += ` AND p.activo = $${idx++}`; params.push(activo === 'false' ? 'false' : 'true'); }
    if (busqueda) {
      sql += ` AND (p.nombre ILIKE $${idx} OR p.codigo ILIKE $${idx})`;
      params.push(`%${busqueda}%`); idx++;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(2000, parseInt(String(req.query.limit ?? '1000'), 10));
    const offset = (page - 1) * limit;
    sql += ` ORDER BY p.tipo ASC, p.nombre ASC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(String(limit), String(offset));

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/productos/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [prod] } = await pool.query(
      `SELECT p.*, pv.nombre AS proveedor_nombre, pv.email AS proveedor_email
       FROM productos p
       LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
    return res.json(prod);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/productos
router.post('/', async (req, res) => {
  try {
    const validationErr = validarProductoPayload(req.body);
    if (validationErr) return res.status(400).json({ error: validationErr });

    let { codigo } = req.body;
    const {
      nombre, descripcion, tipo, unidad_medida,
      stock_minimo, stock_maximo, precio_unitario, precio_venta, proveedor_id,
    } = req.body;

    // Auto-generar codigo si no viene
    if (!codigo) {
      const prefijo = tipo === 'materia_prima' ? 'MP' : tipo === 'material_embalaje' ? 'ME' : tipo === 'producto_envasado' ? 'PE' : 'PF';
      const { rows: [maxRow] } = await pool.query(
        `SELECT codigo FROM productos WHERE codigo LIKE $1 || '-%' ORDER BY codigo DESC LIMIT 1`,
        [prefijo]
      );
      let nextNum = 1;
      if (maxRow) {
        const match = maxRow.codigo.match(new RegExp(`^${prefijo}-(\\d+)`));
        if (match) nextNum = parseInt(match[1], 10) + 1;
      }
      codigo = `${prefijo}-${String(nextNum).padStart(3, '0')}`;
    }

    const { rows: [prod] } = await pool.query(
      `INSERT INTO productos
         (codigo, nombre, descripcion, tipo, unidad_medida,
          stock_minimo, stock_maximo, precio_unitario, precio_venta, proveedor_id)
       VALUES ($1,$2,$3,$4,$5,$6::NUMERIC,$7::NUMERIC,$8::NUMERIC,$9::NUMERIC,$10)
       RETURNING *`,
      [
        codigo.trim().toUpperCase(),
        nombre.trim(),
        descripcion ?? null,
        tipo,
        unidad_medida ?? 'kg',
        Number(stock_minimo ?? 0).toFixed(6),
        Number(stock_maximo ?? 0).toFixed(6),
        Number(precio_unitario ?? 0).toFixed(6),
        Number(precio_venta ?? 0).toFixed(6),
        proveedor_id ?? null,
      ]
    );
    invalidarCacheFinanzas(); // nuevo producto puede afectar valoración inventario
    return res.status(201).json(prod);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe un producto con ese código.' });
    }
    return res.status(500).json({ error: 'Error al crear el producto. Inténtalo de nuevo.' });
  }
});

// PUT /api/productos/:id
router.put('/:id', async (req, res) => {
  try {
    const {
      codigo, nombre, descripcion, unidad_medida,
      stock_minimo, stock_maximo, precio_unitario, precio_venta, proveedor_id, activo, caducidad_meses, peso_unitario_kg, peso_plastico_kg,
    } = req.body;

    if (stock_minimo != null && stock_maximo != null && Number(stock_minimo) > Number(stock_maximo)) {
      return res.status(400).json({ error: 'stock_minimo no puede ser mayor que stock_maximo' });
    }

    // Registrar cambio de precio si aplica
    if (precio_unitario != null || precio_venta != null) {
      const { rows: [anterior] } = await pool.query(`SELECT precio_unitario, precio_venta FROM productos WHERE id = $1`, [req.params.id]);
      if (anterior) {
        if (precio_unitario != null && Math.abs(Number(precio_unitario) - parseFloat(anterior.precio_unitario)) > 0.0001) {
          await pool.query(
            `INSERT INTO historial_precios (producto_id, tipo, precio_anterior, precio_nuevo, motivo)
             VALUES ($1, 'compra', $2, $3, 'Actualizacion precio de compra')`,
            [req.params.id, anterior.precio_unitario, Number(precio_unitario).toFixed(6)]
          );
        }
        if (precio_venta != null && Math.abs(Number(precio_venta) - parseFloat(anterior.precio_venta ?? '0')) > 0.0001) {
          await pool.query(
            `INSERT INTO historial_precios (producto_id, tipo, precio_anterior, precio_nuevo, motivo)
             VALUES ($1, 'venta', $2, $3, 'Actualizacion precio de venta')`,
            [req.params.id, anterior.precio_venta ?? '0', Number(precio_venta).toFixed(6)]
          );
        }
        // Audit trail
        await pool.query(
          `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
           VALUES ($1, 'CAMBIO_PRECIO', 'productos', $2, $3)`,
          [(req as any).user?.id ?? null, req.params.id,
           `Precio: compra ${anterior.precio_unitario}→${precio_unitario ?? 'sin cambio'}, venta ${anterior.precio_venta ?? '0'}→${precio_venta ?? 'sin cambio'}`]
        );
        invalidarCacheFinanzas();
      }
    }

    const { rows: [prod] } = await pool.query(
      `UPDATE productos SET
         codigo = COALESCE($1, codigo),
         nombre = COALESCE($2, nombre),
         descripcion = $3,
         unidad_medida = COALESCE($4, unidad_medida),
         stock_minimo  = COALESCE($5::NUMERIC, stock_minimo),
         stock_maximo  = COALESCE($6::NUMERIC, stock_maximo),
         precio_unitario = COALESCE($7::NUMERIC, precio_unitario),
         precio_venta    = COALESCE($8::NUMERIC, precio_venta),
         proveedor_id  = $9,
         activo        = COALESCE($10, activo),
         caducidad_meses = $12,
         peso_unitario_kg = $13,
         peso_plastico_kg = COALESCE($14::NUMERIC, peso_plastico_kg)
       WHERE id = $11
       RETURNING *`,
      [
        codigo ? codigo.trim().toUpperCase() : null,
        nombre?.trim() ?? null,
        descripcion ?? null,
        unidad_medida ?? null,
        stock_minimo != null ? Number(stock_minimo).toFixed(6) : null,
        stock_maximo != null ? Number(stock_maximo).toFixed(6) : null,
        precio_unitario != null ? Number(precio_unitario).toFixed(6) : null,
        precio_venta != null ? Number(precio_venta).toFixed(6) : null,
        proveedor_id ?? null,
        activo ?? null,
        req.params.id,
        caducidad_meses != null ? Number(caducidad_meses) || null : null,
        peso_unitario_kg != null ? Number(peso_unitario_kg) || null : null,
        peso_plastico_kg != null ? Number(peso_plastico_kg).toFixed(4) : null,
      ]
    );
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
    invalidarCacheFinanzas(); // cualquier edit puede afectar valor inventario
    return res.json(prod);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/productos/:id/trazabilidad.csv
router.get('/:id/trazabilidad.csv', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: [prod] } = await pool.query(
      `SELECT p.*, pv.nombre AS proveedor_nombre FROM productos p LEFT JOIN proveedores pv ON pv.id = p.proveedor_id WHERE p.id = $1`,
      [id]
    );
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const { rows: lotes } = await pool.query(
      `SELECT lote_interno, lote_proveedor, cantidad_inicial, cantidad_actual, estado, fecha_fabricacion, fecha_caducidad, fecha_entrada, ubicacion
       FROM lotes WHERE producto_id = $1 ORDER BY fecha_entrada DESC`,
      [id]
    );

    const { rows: moves } = await pool.query(
      `SELECT sm.tipo, sm.cantidad, sm.cantidad_antes, sm.cantidad_despues, sm.motivo, sm.referencia_externa,
              sm.created_at, l.lote_interno, op.numero_orden
       FROM stock_moves sm
       LEFT JOIN lotes l ON l.id = sm.lote_id
       LEFT JOIN ordenes_produccion op ON op.id = sm.orden_id
       WHERE sm.producto_id = $1
       ORDER BY sm.created_at DESC`,
      [id]
    );

    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines: string[] = [];

    lines.push(`TRAZABILIDAD — ${prod.codigo} ${prod.nombre}`);
    lines.push(`Generado: ${new Date().toLocaleString('es-ES')}`);
    lines.push(`Stock actual: ${prod.stock_actual} ${prod.unidad_medida}`);
    lines.push(`Proveedor: ${prod.proveedor_nombre ?? '—'}`);
    lines.push('');

    lines.push('=== LOTES ===');
    lines.push(['Lote Interno','Lote Proveedor','Cantidad Inicial','Cantidad Actual','Unidad','Estado','F. Entrada','F. Caducidad','Ubicación'].map(esc).join(','));
    for (const l of lotes) {
      lines.push([l.lote_interno, l.lote_proveedor, l.cantidad_inicial, l.cantidad_actual, prod.unidad_medida, l.estado, l.fecha_entrada, l.fecha_caducidad, l.ubicacion].map(esc).join(','));
    }
    lines.push('');

    lines.push('=== MOVIMIENTOS DE STOCK ===');
    lines.push(['Fecha','Tipo','Lote','Orden','Cantidad','Stock Antes','Stock Después','Motivo'].map(esc).join(','));
    for (const m of moves) {
      lines.push([new Date(m.created_at).toLocaleString('es-ES'), m.tipo, m.lote_interno, m.numero_orden, m.cantidad, m.cantidad_antes, m.cantidad_despues, m.motivo ?? m.referencia_externa].map(esc).join(','));
    }

    const csv = '\uFEFF' + lines.join('\r\n'); // BOM para Excel
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trazabilidad-${prod.codigo}.csv"`);
    return res.send(csv);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/productos/:id  (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE productos SET activo = FALSE WHERE id = $1`, [req.params.id]);
    invalidarCacheFinanzas(); // producto desactivado → ya no cuenta en inventario
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/productos/:id/sds — upload safety data sheet PDF
import multer from 'multer';
import path from 'path';
const sdsUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'uploads')),
    filename: (_req, file, cb) => cb(null, `sds-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo PDF'));
  },
});

router.post('/:id/sds', sdsUpload.single('sds'), async (req, res) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'Archivo PDF requerido.' });
    const sdsUrl = `/uploads/${file.filename}`;
    await pool.query(`UPDATE productos SET sds_url = $1 WHERE id = $2`, [sdsUrl, req.params.id]);
    return res.json({ ok: true, sds_url: sdsUrl });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// DELETE /api/productos/:id/sds
router.delete('/:id/sds', async (req, res) => {
  try {
    await pool.query(`UPDATE productos SET sds_url = NULL WHERE id = $1`, [req.params.id]);
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

export default router;
