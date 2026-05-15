import { Router } from 'express';
import { pool } from '../db/pool';
import { invalidarCacheFinanzas } from './finanzas.routes';
import { nextLoteCode } from '../lib/loteCode';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { producto_id, estado, busqueda } = req.query;
    let sql = `
      SELECT l.*, p.nombre AS producto_nombre, p.codigo AS producto_codigo,
             p.unidad_medida
      FROM lotes l
      JOIN productos p ON p.id = l.producto_id
      WHERE 1=1
    `;
    const params: string[] = [];
    let idx = 1;

    if (producto_id) { sql += ` AND l.producto_id = $${idx++}`; params.push(String(producto_id)); }
    if (estado)      { sql += ` AND l.estado = $${idx++}`;      params.push(String(estado)); }
    if (busqueda)    {
      // Búsqueda accent-insensitive: normalizamos texto y patrón quitando diacríticos.
      // unaccent() requiere extensión postgres; si no está, usamos translate como fallback.
      sql += ` AND (
        translate(lower(l.lote_interno), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN') ILIKE $${idx}
        OR translate(lower(COALESCE(l.lote_proveedor,'')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN') ILIKE $${idx}
        OR translate(lower(p.nombre), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN') ILIKE $${idx}
        OR translate(lower(p.codigo), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN') ILIKE $${idx}
      )`;
      const qNorm = String(busqueda).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      params.push(`%${qNorm}%`); idx++;
    }

    sql += ` ORDER BY l.fecha_caducidad ASC NULLS LAST, l.fecha_entrada ASC LIMIT 500`;
    const { rows } = await pool.query(sql, params);
    // Defensivo: trabajador no debe ver precio_compra ni en el JSON de Network.
    // Filtrar server-side evita que un operario inspeccione el navegador y lo lea.
    const user = (req as any).user as { rol?: string } | undefined;
    if (user?.rol !== 'admin') {
      for (const r of rows) {
        delete r.precio_compra;
      }
    }
    res.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    res.status(500).json({ error: msg });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      producto_id, lote_interno: loteInternoBody, lote_proveedor,
      cantidad, cantidad_inicial, cantidad_actual,
      fecha_caducidad, fecha_fabricacion, ubicacion, observaciones, estado, precio_compra,
      // Valores medidos del lote (físico-químicos)
      solidos, ph, viscosidad,
    } = req.body;

    const qty = cantidad ?? cantidad_inicial;
    if (!producto_id || !qty) {
      return res.status(400).json({ error: 'producto_id y cantidad son obligatorios' });
    }
    if (Number(qty) <= 0) {
      return res.status(400).json({ error: 'cantidad debe ser mayor que 0' });
    }

    let lote_interno = loteInternoBody?.trim().toUpperCase();
    const qty_actual = cantidad_actual ?? qty;

    // Auto-calcular caducidad si el producto tiene caducidad_meses y no se proporcionó fecha
    let fechaCad = fecha_caducidad ?? null;
    if (!fechaCad) {
      const { rows: [prod] } = await pool.query(`SELECT caducidad_meses FROM productos WHERE id = $1`, [producto_id]);
      if (prod?.caducidad_meses) {
        const d = new Date();
        d.setMonth(d.getMonth() + prod.caducidad_meses);
        fechaCad = d.toISOString().slice(0, 10);
      }
    }

    // Generación de código + INSERT en una sola transacción para que el
    // advisory_xact_lock de nextLoteCode serialice frente a otros creadores
    // concurrentes (otra ruta o produccion.service).
    const client = await pool.connect();
    let lote: any;
    try {
      await client.query('BEGIN');
      if (!lote_interno) {
        lote_interno = await nextLoteCode(client);
      }
      const result = await client.query(
        `INSERT INTO lotes
           (producto_id, lote_interno, lote_proveedor, cantidad_inicial, cantidad_actual,
            fecha_fabricacion, fecha_caducidad, ubicacion, observaciones, estado, precio_compra,
            solidos, ph, viscosidad)
         VALUES ($1,$2,$3,$4::NUMERIC,$5::NUMERIC,$6,$7,$8,$9,COALESCE($10::estado_lote,'cuarentena'),$11::NUMERIC,
                 $12::NUMERIC,$13::NUMERIC,$14::NUMERIC)
         RETURNING *`,
        [
          producto_id,
          lote_interno,
          lote_proveedor ?? null,
          Number(qty).toFixed(6),
          Number(qty_actual).toFixed(6),
          fecha_fabricacion ?? null,
          fechaCad          ?? null,
          ubicacion         ?? null,
          observaciones     ?? null,
          estado            ?? null,
          precio_compra     ?? null,
          solidos    != null && solidos    !== '' ? Number(solidos)    : null,
          ph         != null && ph         !== '' ? Number(ph)         : null,
          viscosidad != null && viscosidad !== '' ? Number(viscosidad) : null,
        ]
      );
      lote = result.rows[0];
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    // [H2.1 audit v3] Eliminado UPDATE defensivo de stock_actual.
    // El trigger fn_trg_lotes_stock_actual (migración 025) ya recalcula
    // productos.stock_actual = SUM(lotes aprobados con stock>0) automáticamente
    // tras el INSERT/UPDATE/DELETE de lotes. Doble escritura era redundante y
    // creaba ventana de inconsistencia bajo concurrencia.

    // Auto-complete pending supplier order: match by product, mark as completado, calculate lead time
    // Side-effect — un fallo aquí (ej. tabla no migrada) NO debe romper la creación del lote.
    try {
      const { rows: pendientes } = await pool.query(
        `SELECT id, fecha_solicitud, cantidad_solicitada
         FROM pedidos_proveedor
         WHERE producto_id = $1 AND estado IN ('borrador', 'enviado', 'pendiente')
         ORDER BY fecha_solicitud ASC`,
        [producto_id]
      );
      if (pendientes.length > 0) {
        const pp = pendientes[0];
        const cantRecibida = parseFloat(String(qty));
        const ahora = new Date();
        const solicitud = new Date(pp.fecha_solicitud);
        const leadTimeHoras = Math.round(((ahora.getTime() - solicitud.getTime()) / (1000 * 60 * 60)) * 10) / 10;

        await pool.query(
          `UPDATE pedidos_proveedor SET
             lote_id = $1,
             cantidad_recibida = $2::NUMERIC,
             fecha_recepcion = NOW(),
             lead_time_horas = $3,
             estado = 'completado'
           WHERE id = $4`,
          [lote.id, cantRecibida.toFixed(6), leadTimeHoras, pp.id]
        );
        // Cancela el resto de borradores/enviados pendientes del mismo producto
        // (ya hay material entrante, no necesitamos varios pedidos abiertos)
        if (pendientes.length > 1) {
          const restoIds = pendientes.slice(1).map(p => p.id);
          await pool.query(
            `UPDATE pedidos_proveedor SET estado = 'cancelado',
               notas = COALESCE(notas, '') || E'\nCancelado automáticamente al recibir lote ' || $1
             WHERE id = ANY($2::uuid[])`,
            [lote.lote_interno, restoIds]
          );
        }
      }
    } catch (e) {
      console.warn('[POST /lotes] Auto-complete pedidos_proveedor falló (no crítico):', e);
    }

    // Stock move for traceability
    if (lote.estado === 'aprobado' && parseFloat(lote.cantidad_actual) > 0) {
      await pool.query(
        `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
         VALUES ($1, $2, 'entrada', $3::NUMERIC, 0, $3::NUMERIC, $4, $5)`,
        [producto_id, lote.id, lote.cantidad_actual, (req as any).user?.id ?? null, `Lote ${lote.lote_interno} creado`]
      );
    }

    // Audit trail
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'ENTRADA_STOCK', 'lotes', $2, $3)`,
      [(req as any).user?.id ?? null, lote.id, `Lote ${lote.lote_interno} creado: ${Number(qty).toFixed(2)} ${req.body.unidad_medida ?? 'kg'}`]
    );

    invalidarCacheFinanzas(); // nuevo lote afecta inmovilizado
    return res.status(201).json(lote);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    console.error('[POST /lotes] Error:', msg, err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe un lote con ese código. Cambia el código de lote.' });
    }
    if (msg.includes('constraint') || msg.includes('violates')) {
      return res.status(400).json({ error: `Datos inválidos: ${msg}` });
    }
    return res.status(500).json({ error: `Error al crear lote: ${msg}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { cantidad_actual, ubicacion, observaciones, precio_compra, solidos, ph, viscosidad } = req.body;

    if (cantidad_actual != null && Number(cantidad_actual) < 0) {
      return res.status(400).json({ error: 'La cantidad no puede ser negativa' });
    }

    // Get old quantity before update for stock_move
    const { rows: [antes] } = await pool.query(`SELECT cantidad_actual, producto_id FROM lotes WHERE id = $1`, [req.params.id]);

    const { rows: [lote] } = await pool.query(
      `UPDATE lotes SET
        cantidad_actual = COALESCE($1::NUMERIC, cantidad_actual),
        cantidad_inicial = GREATEST(cantidad_inicial, COALESCE($1::NUMERIC, cantidad_actual)),
        ubicacion = COALESCE($2, ubicacion),
        observaciones = COALESCE($3, observaciones),
        precio_compra = COALESCE($4::NUMERIC, precio_compra),
        solidos    = COALESCE($6::NUMERIC, solidos),
        ph         = COALESCE($7::NUMERIC, ph),
        viscosidad = COALESCE($8::NUMERIC, viscosidad)
       WHERE id = $5 RETURNING *`,
      [
        cantidad_actual ?? null, ubicacion ?? null, observaciones ?? null, precio_compra ?? null, req.params.id,
        solidos    != null && solidos    !== '' ? Number(solidos)    : null,
        ph         != null && ph         !== '' ? Number(ph)         : null,
        viscosidad != null && viscosidad !== '' ? Number(viscosidad) : null,
      ]
    );
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

    // Stock move for quantity change
    if (cantidad_actual != null && antes) {
      const diff = parseFloat(lote.cantidad_actual) - parseFloat(antes.cantidad_actual);
      if (Math.abs(diff) > 0.0001) {
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'ajuste', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
          [lote.producto_id, lote.id, diff.toFixed(6), antes.cantidad_actual, lote.cantidad_actual,
           (req as any).user?.id ?? null, `Ajuste manual lote ${lote.lote_interno}`]
        );
      }
    }

    // [H2.1 audit v3] Eliminado UPDATE defensivo: trigger 025 ya recalcula stock_actual.

    // Audit
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'MODIFICAR_LOTE', 'lotes', $2, $3)`,
      [(req as any).user?.id ?? null, lote.id, `Lote ${lote.lote_interno} modificado`]
    );

    invalidarCacheFinanzas(); // cambio cantidad/precio_compra afecta inmovilizado
    res.json(lote);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/lotes/:id/historial-estado
// Devuelve el historial de cambios de estado del lote desde tabla auditoria,
// + el revisor/motivo permanente cuando el lote pasó por cuarentena → aprobado.
// Permite al admin ver: quien lo aprobó, cuándo, y por qué (texto del motivo).
router.get('/:id/historial-estado', async (req, res) => {
  try {
    const { id } = req.params;

    // Datos del lote + revisor (si aplica)
    const { rows: [lote] } = await pool.query(
      `SELECT l.id, l.lote_interno, l.estado, l.revisor_id, l.revisado_at, l.motivo_revision,
              u.nombre AS revisor_nombre, u.rol AS revisor_rol,
              p.nombre AS producto_nombre, p.codigo AS producto_codigo
       FROM lotes l
       JOIN productos p ON p.id = l.producto_id
       LEFT JOIN usuarios u ON u.id = l.revisor_id
       WHERE l.id = $1`,
      [id]
    );
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

    // Historial de cambios de estado: tabla auditoria filtrada por accion='CAMBIO_ESTADO_LOTE'
    // y registro_id = id del lote. Devuelve motivo + usuario + timestamp.
    const { rows: cambios } = await pool.query(
      `SELECT a.id, a.accion, a.motivo, a.created_at,
              u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE a.tabla_afectada = 'lotes'
         AND a.accion IN ('CAMBIO_ESTADO_LOTE', 'ENTRADA_STOCK', 'MODIFICAR_LOTE')
         AND a.registro_id = $1
       ORDER BY a.created_at DESC`,
      [id]
    );

    return res.json({
      lote,
      revisor: lote.revisor_id ? {
        id: lote.revisor_id,
        nombre: lote.revisor_nombre,
        rol: lote.revisor_rol,
        revisado_at: lote.revisado_at,
        motivo: lote.motivo_revision,
      } : null,
      cambios,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.get('/:id/trazabilidad', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT sm.tipo, sm.cantidad, sm.created_at, sm.motivo,
              op.numero_orden, op.estado, op.registro_limpieza,
              p.nombre AS producto_nombre, p.codigo AS producto_codigo
       FROM stock_moves sm
       LEFT JOIN ordenes_produccion op ON op.id = sm.orden_id
       JOIN productos p ON p.id = sm.producto_id
       WHERE sm.lote_id = $1
       ORDER BY sm.created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    res.status(500).json({ error: msg });
  }
});

router.patch('/:id/estado', async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, motivo } = req.body;
    if (!['cuarentena', 'aprobado', 'rechazado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    if (!motivo) return res.status(400).json({ error: 'motivo es obligatorio para cambios de estado' });

    // Validate state transition
    const { rows: [actual] } = await pool.query(`SELECT estado, cantidad_actual FROM lotes WHERE id = $1`, [id]);
    if (!actual) return res.status(404).json({ error: 'Lote no encontrado' });
    const TRANS_LOTE: Record<string, string[]> = { cuarentena: ['aprobado', 'rechazado'], aprobado: ['cuarentena', 'rechazado'], rechazado: [] };
    if (!(TRANS_LOTE[actual.estado] ?? []).includes(estado)) {
      return res.status(422).json({ error: `No se puede cambiar de "${actual.estado}" a "${estado}"` });
    }

    const userId = (req as any).user?.id ?? null;
    const userRol = (req as any).user?.rol ?? null;
    const esAprobacionDeCuarentena = actual.estado === 'cuarentena' && estado === 'aprobado';

    // Aprobación cuarentena → aprobado: SOLO ADMIN puede ejecutarla.
    // Normativa REACH exige firma de responsable de calidad autorizado.
    // Un operario aunque escriba un motivo válido no puede aprobar lotes
    // desviados de QC (riesgo legal + producto fuera de spec a cliente).
    if (esAprobacionDeCuarentena) {
      if (userRol !== 'admin') {
        return res.status(403).json({
          error: 'Solo un administrador (responsable de calidad) puede aprobar un lote en cuarentena. Esta restricción cumple normativa REACH.',
        });
      }
      const motivoTrim = String(motivo).trim();
      if (motivoTrim.length < 10) {
        return res.status(400).json({
          error: 'Aprobar un lote en cuarentena requiere motivo de al menos 10 caracteres explicando por qué se aprueba pese a la desviación QC.',
        });
      }
      if (!userId) {
        return res.status(401).json({ error: 'Sesión no identificada — no se puede registrar revisor.' });
      }
    }

    const { rows: [lote] } = esAprobacionDeCuarentena
      ? await pool.query(
          `UPDATE lotes SET estado = $1,
             revisor_id = $3, revisado_at = NOW(), motivo_revision = $4
           WHERE id = $2 RETURNING *`,
          [estado, id, userId, String(motivo).trim()]
        )
      : await pool.query(
          `UPDATE lotes SET estado = $1 WHERE id = $2 RETURNING *`,
          [estado, id]
        );
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

    // [H2.1 audit v3] Eliminado UPDATE defensivo: trigger 025 ya recalcula stock_actual al cambiar estado del lote.

    // Stock move for estado change (aprobado = stock entry, rechazado = stock exit)
    const cantLote = parseFloat(lote.cantidad_actual);
    if (cantLote > 0) {
      if (estado === 'aprobado' && actual.estado === 'cuarentena') {
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'entrada', $3::NUMERIC, 0, $3::NUMERIC, $4, $5)`,
          [lote.producto_id, lote.id, cantLote.toFixed(6), (req as any).user?.id ?? null, `Lote ${lote.lote_interno} aprobado: ${motivo}`]
        );
      } else if (estado === 'rechazado' && actual.estado === 'aprobado') {
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, 0, $5, $6)`,
          [lote.producto_id, lote.id, (-cantLote).toFixed(6), cantLote.toFixed(6), (req as any).user?.id ?? null, `Lote ${lote.lote_interno} rechazado: ${motivo}`]
        );
      } else if (estado === 'cuarentena' && actual.estado === 'aprobado') {
        // Vuelta a cuarentena (revisión post-aprobación) — sale del stock disponible
        await pool.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, 0, $5, $6)`,
          [lote.producto_id, lote.id, (-cantLote).toFixed(6), cantLote.toFixed(6), (req as any).user?.id ?? null, `Lote ${lote.lote_interno} devuelto a cuarentena: ${motivo}`]
        );
      }
    }

    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'CAMBIO_ESTADO_LOTE', 'lotes', $2, $3)`,
      [(req as any).user?.id ?? null, id, motivo]
    );
    invalidarCacheFinanzas(); // estado lote afecta inmovilizado (sólo aprobado cuenta)
    return res.json(lote);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    return res.status(500).json({ error: msg });
  }
});

export default router;
