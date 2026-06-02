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
             p.unidad_medida,
             COALESCE(
               (SELECT json_agg(json_build_object(
                  'spec_id', ls.spec_id, 'valor', ls.valor,
                  'nombre', sc.nombre, 'unidad', sc.unidad, 'decimales', sc.decimales
                ) ORDER BY sc.nombre)
                FROM lote_specs ls JOIN spec_catalogo sc ON sc.id = ls.spec_id
                WHERE ls.lote_id = l.id
               ),
               '[]'::json
             ) AS specs_valores
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
      // Coste de porte/transporte
      porte,
      // Unidad en la que se introdujo el precio (kg, L, ud…). NULL = unidad del producto.
      unidad_precio,
      // Specs dinámicas: array [{spec_id, valor}]
      specs_valores,
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
            solidos, ph, viscosidad, porte, unidad_precio)
         VALUES ($1,$2,$3,$4::NUMERIC,$5::NUMERIC,$6,$7,$8,$9,COALESCE($10::estado_lote,'cuarentena'),$11::NUMERIC,
                 $12::NUMERIC,$13::NUMERIC,$14::NUMERIC,$15::NUMERIC,$16)
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
          porte      != null && porte      !== '' ? Number(porte)      : 0,
          unidad_precio != null && String(unidad_precio).trim() !== '' ? String(unidad_precio).trim() : null,
        ]
      );
      lote = result.rows[0];

      // Inserta valores de specs dinámicas si vinieron + crea control de calidad
      // analítico firmado automáticamente con esos mismos valores (un único registro
      // de QC por lote que el responsable puede ver/ampliar luego en Calidad).
      if (Array.isArray(specs_valores) && specs_valores.length > 0) {
        const valoresFiltrados = specs_valores.filter((sv: { spec_id?: number; valor?: string | number }) =>
          sv?.spec_id != null && sv.valor != null && sv.valor !== ''
        );

        for (const sv of valoresFiltrados) {
          await client.query(
            `INSERT INTO lote_specs (lote_id, spec_id, valor)
             VALUES ($1, $2, $3::NUMERIC)
             ON CONFLICT (lote_id, spec_id) DO UPDATE SET valor = EXCLUDED.valor`,
            [lote.id, sv.spec_id, Number(sv.valor)]
          );
        }

        // ── Auto-crear control de calidad analítico ──────────────────────
        // Solo si hay al menos un valor introducido. Evalúa APTO/NO APTO comparando
        // con los rangos del producto. Firmado por el usuario actual.
        if (valoresFiltrados.length > 0) {
          try {
            const userId = (req as any).user?.id ?? null;
            let firmadoPorNombre: string | null = null;
            if (userId) {
              const { rows: [u] } = await client.query(`SELECT nombre FROM usuarios WHERE id = $1`, [userId]);
              firmadoPorNombre = u?.nombre ?? null;
            }
            // Carga specs del producto para evaluar rango → resultado
            const { rows: rangos } = await client.query(
              `SELECT ps.spec_id, sc.nombre, sc.unidad, ps.min_valor, ps.max_valor
               FROM producto_specs ps JOIN spec_catalogo sc ON sc.id = ps.spec_id
               WHERE ps.producto_id = $1`,
              [producto_id]
            );
            const rangosMap = new Map<number, { nombre: string; unidad: string | null; min: number | null; max: number | null }>();
            for (const r of rangos) rangosMap.set(r.spec_id, {
              nombre: r.nombre, unidad: r.unidad,
              min: r.min_valor != null ? parseFloat(r.min_valor) : null,
              max: r.max_valor != null ? parseFloat(r.max_valor) : null,
            });
            let resultado: 'apto' | 'no_apto' = 'apto';
            for (const sv of valoresFiltrados) {
              const r = rangosMap.get(sv.spec_id);
              if (!r) continue;
              const v = Number(sv.valor);
              if ((r.min != null && v < r.min) || (r.max != null && v > r.max)) {
                resultado = 'no_apto'; break;
              }
            }

            // Detecta columna estado (migración 045)
            const { rows: [meta] } = await client.query(
              `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='controles_calidad' AND column_name='estado') AS has_estado`
            );
            const hasEstado = !!meta?.has_estado;

            // Mapea a campos legacy
            let phVal: number | null = null, solVal: number | null = null, viscVal: number | null = null;
            const valoresFull: { spec_id: number; nombre: string; valor: number; unidad: string | null }[] = [];
            for (const sv of valoresFiltrados) {
              const r = rangosMap.get(sv.spec_id);
              const nombre = r?.nombre ?? '';
              const v = Number(sv.valor);
              valoresFull.push({ spec_id: sv.spec_id, nombre, valor: v, unidad: r?.unidad ?? null });
              if (nombre === 'pH') phVal = v;
              if (nombre === 'Sólidos') solVal = v;
              if (nombre === 'Viscosidad') viscVal = v;
            }

            const ccCols = `tipo, fecha, lote_codigo, producto_id, producto_nombre,
                            ph_valor, solidos_valor, viscosidad_valor,
                            resultado, firmado_por_id, firmado_por_nombre, firmado_at, created_by_id`;
            const ccVals = `'analitico', CURRENT_DATE, $1, $2, (SELECT nombre FROM productos WHERE id = $2),
                            $3::NUMERIC, $4::NUMERIC, $5::NUMERIC,
                            $6, $7, $8, NOW(), $7`;
            const ccParams: unknown[] = [lote.lote_interno, producto_id, phVal, solVal, viscVal, resultado, userId, firmadoPorNombre];
            const sqlCC = hasEstado
              ? `INSERT INTO controles_calidad (${ccCols}, estado) VALUES (${ccVals}, 'completado') RETURNING id`
              : `INSERT INTO controles_calidad (${ccCols}) VALUES (${ccVals}) RETURNING id`;
            const { rows: [cc] } = await client.query(sqlCC, ccParams);

            // Guarda valores en tabla nueva (si existe)
            try {
              for (const v of valoresFull) {
                await client.query(
                  `INSERT INTO controles_calidad_valores (control_id, spec_id, nombre, valor, unidad)
                   VALUES ($1, $2, $3, $4::NUMERIC, $5)`,
                  [cc.id, v.spec_id, v.nombre, v.valor, v.unidad]
                );
              }
            } catch { /* migración 047 puede no estar */ }
          } catch (e) {
            console.warn('[POST /lotes] Auto-crear control de calidad falló:', (e as Error).message);
          }
        }
      }

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
    const { cantidad_actual, ubicacion, observaciones, precio_compra, solidos, ph, viscosidad, porte, lote_interno } = req.body;

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
        viscosidad = COALESCE($8::NUMERIC, viscosidad),
        porte      = COALESCE($9::NUMERIC, porte),
        lote_interno = COALESCE($10, lote_interno)
       WHERE id = $5 RETURNING *`,
      [
        cantidad_actual ?? null, ubicacion ?? null, observaciones ?? null, precio_compra ?? null, req.params.id,
        solidos    != null && solidos    !== '' ? Number(solidos)    : null,
        ph         != null && ph         !== '' ? Number(ph)         : null,
        viscosidad != null && viscosidad !== '' ? Number(viscosidad) : null,
        porte      != null && porte      !== '' ? Number(porte)      : null,
        lote_interno != null && String(lote_interno).trim() !== '' ? String(lote_interno).trim().toUpperCase() : null,
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
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { estado, motivo } = req.body;
    if (!['cuarentena', 'aprobado', 'rechazado'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }
    if (!motivo) return res.status(400).json({ error: 'motivo es obligatorio para cambios de estado' });

    await client.query('BEGIN');

    // Lock lote + leer estado actual en la misma tx para evitar race entre
    // UPDATE estado e INSERT stock_move (antes eran 2 pool.query separadas).
    const { rows: [actual] } = await client.query<{ estado: string; cantidad_actual: string }>(
      `SELECT estado, cantidad_actual FROM lotes WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!actual) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lote no encontrado' });
    }
    const TRANS_LOTE: Record<string, string[]> = { cuarentena: ['aprobado', 'rechazado'], aprobado: ['cuarentena', 'rechazado'], rechazado: [] };
    if (!(TRANS_LOTE[actual.estado] ?? []).includes(estado)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: `No se puede cambiar de "${actual.estado}" a "${estado}"` });
    }

    const userId = (req as any).user?.id ?? null;
    const userRol = (req as any).user?.rol ?? null;
    const esAprobacionDeCuarentena = actual.estado === 'cuarentena' && estado === 'aprobado';

    // Aprobación cuarentena → aprobado: SOLO ADMIN puede ejecutarla.
    // Normativa REACH exige firma de responsable de calidad autorizado.
    if (esAprobacionDeCuarentena) {
      if (userRol !== 'admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Solo un administrador (responsable de calidad) puede aprobar un lote en cuarentena. Esta restricción cumple normativa REACH.',
        });
      }
      const motivoTrim = String(motivo).trim();
      if (motivoTrim.length < 10) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Aprobar un lote en cuarentena requiere motivo de al menos 10 caracteres explicando por qué se aprueba pese a la desviación QC.',
        });
      }
      if (!userId) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: 'Sesión no identificada — no se puede registrar revisor.' });
      }
    }

    // Leer stock_actual del producto ANTES del UPDATE para registrar antes/después
    // reales en el stock_move (no usar 0 como placeholder — el timeline del
    // producto debe ser coherente con el resto de movimientos).
    const { rows: [productoAntes] } = await client.query<{ producto_id: string; stock_actual: string }>(
      `SELECT l.producto_id, p.stock_actual
       FROM lotes l JOIN productos p ON p.id = l.producto_id
       WHERE l.id = $1 FOR UPDATE`,
      [id]
    );
    const stockAntesProd = productoAntes ? parseFloat(productoAntes.stock_actual) : 0;

    const { rows: [lote] } = esAprobacionDeCuarentena
      ? await client.query(
          `UPDATE lotes SET estado = $1,
             revisor_id = $3, revisado_at = NOW(), motivo_revision = $4
           WHERE id = $2 RETURNING *`,
          [estado, id, userId, String(motivo).trim()]
        )
      : await client.query(
          `UPDATE lotes SET estado = $1 WHERE id = $2 RETURNING *`,
          [estado, id]
        );
    if (!lote) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lote no encontrado' });
    }

    // Stock move for estado change (aprobado = stock entry, rechazado = stock exit)
    const cantLote = parseFloat(lote.cantidad_actual);
    if (cantLote > 0) {
      // Releer stock_actual tras el UPDATE (el trigger 025 ya lo recalculó)
      const { rows: [prodDespues] } = await client.query<{ stock_actual: string }>(
        `SELECT stock_actual FROM productos WHERE id = $1`,
        [lote.producto_id]
      );
      const stockDespuesProd = parseFloat(prodDespues?.stock_actual ?? '0');

      if (estado === 'aprobado' && actual.estado === 'cuarentena') {
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'entrada', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
          [lote.producto_id, lote.id, cantLote.toFixed(6), stockAntesProd.toFixed(6), stockDespuesProd.toFixed(6), userId, `Lote ${lote.lote_interno} aprobado: ${motivo}`]
        );
      } else if (estado === 'rechazado' && actual.estado === 'aprobado') {
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
          [lote.producto_id, lote.id, (-cantLote).toFixed(6), stockAntesProd.toFixed(6), stockDespuesProd.toFixed(6), userId, `Lote ${lote.lote_interno} rechazado: ${motivo}`]
        );
      } else if (estado === 'cuarentena' && actual.estado === 'aprobado') {
        await client.query(
          `INSERT INTO stock_moves (producto_id, lote_id, tipo, cantidad, cantidad_antes, cantidad_despues, usuario_id, motivo)
           VALUES ($1, $2, 'salida', $3::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)`,
          [lote.producto_id, lote.id, (-cantLote).toFixed(6), stockAntesProd.toFixed(6), stockDespuesProd.toFixed(6), userId, `Lote ${lote.lote_interno} devuelto a cuarentena: ${motivo}`]
        );
      }
    }

    await client.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'CAMBIO_ESTADO_LOTE', 'lotes', $2, $3)`,
      [userId, id, motivo]
    );

    await client.query('COMMIT');
    invalidarCacheFinanzas(); // estado lote afecta inmovilizado (sólo aprobado cuenta)
    return res.json(lote);
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    const msg = err instanceof Error ? err.message : 'Error';
    return res.status(500).json({ error: msg });
  } finally {
    client.release();
  }
});

export default router;
