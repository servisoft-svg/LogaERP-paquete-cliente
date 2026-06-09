// Recordatorios con alerta horaria + destinatarios (usuarios concretos o por rol).
// Reutiliza la tabla `recordatorios` extendida en migración 043.
import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

// GET /api/recordatorios/usuarios — lista de usuarios activos para selector destinatarios
router.get('/usuarios', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, rol FROM usuarios WHERE activo = TRUE ORDER BY nombre`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Helper: resuelve `nombre + url` para un par (tipo, id) de referencia.
// Devuelve null si el tipo no se reconoce o el recurso no existe.
// Si userRol no es 'admin' y el tipo es cliente/proveedor, no se resuelve
// (datos comerciales sensibles — solo admin ve el chip).
async function resolverReferencia(tipo: string | null, id: string | null, userRol?: string): Promise<{ label: string; url: string } | null> {
  if (!tipo || !id) return null;
  if ((tipo === 'cliente' || tipo === 'proveedor') && userRol !== 'admin') return null;
  switch (tipo) {
    case 'producto': {
      const { rows: [r] } = await pool.query('SELECT codigo, nombre FROM productos WHERE id = $1', [id]);
      return r ? { label: `${r.codigo} · ${r.nombre}`, url: `/productos?q=${encodeURIComponent(r.codigo)}` } : null;
    }
    case 'lote': {
      const { rows: [r] } = await pool.query('SELECT lote_interno FROM lotes WHERE id = $1', [id]);
      return r ? { label: `Lote ${r.lote_interno}`, url: `/lotes?q=${encodeURIComponent(r.lote_interno)}` } : null;
    }
    case 'orden': {
      const { rows: [r] } = await pool.query('SELECT numero_orden FROM ordenes_produccion WHERE id = $1', [id]);
      return r ? { label: r.numero_orden, url: '/produccion' } : null;
    }
    case 'pedido': {
      const { rows: [r] } = await pool.query('SELECT numero_pedido FROM pedidos WHERE id = $1', [id]);
      return r ? { label: r.numero_pedido, url: '/pedidos' } : null;
    }
    case 'cliente': {
      const { rows: [r] } = await pool.query('SELECT nombre, telefono FROM clientes WHERE id = $1', [id]);
      return r ? { label: r.telefono ? `${r.nombre} · ${r.telefono}` : r.nombre, url: `/clientes?q=${encodeURIComponent(r.nombre)}` } : null;
    }
    case 'proveedor': {
      const { rows: [r] } = await pool.query('SELECT nombre, telefono FROM proveedores WHERE id = $1', [id]);
      return r ? { label: r.telefono ? `${r.nombre} · ${r.telefono}` : r.nombre, url: `/proveedores?q=${encodeURIComponent(r.nombre)}` } : null;
    }
    default:
      return null;
  }
}

// GET /api/recordatorios — lista del mes del calendario, filtrada al usuario actual
// El calendario muestra TODOS los recordatorios visibles para el user (destinatario o rol).
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user as { id: string; rol?: string };
    const mes = String(req.query.mes ?? ''); // formato YYYY-MM
    let sql = `
      SELECT r.id, TO_CHAR(r.fecha, 'YYYY-MM-DD') AS fecha,
             r.programado_para, r.titulo, r.descripcion, r.color, r.completado,
             r.usuario_id, r.destinatarios, r.destinatario_roles,
             r.con_sonido, r.con_notificacion, r.entregados_por, r.origen, r.created_at,
             r.referencia_tipo, r.referencia_id,
             u.nombre AS creador_nombre, u.rol::text AS creador_rol,
             COALESCE(
               (SELECT array_agg(uu.nombre ORDER BY uu.nombre)
                FROM usuarios uu WHERE uu.id = ANY(COALESCE(r.entregados_por, '{}'::UUID[]))),
               '{}'::TEXT[]
             ) AS entregados_nombres
      FROM recordatorios r
      LEFT JOIN usuarios u ON u.id = r.usuario_id
      WHERE (
        -- Visible para mí: soy destinatario directo, mi rol está en roles, o yo lo creé
        $1::UUID = ANY(COALESCE(r.destinatarios, '{}'::UUID[]))
        OR ($2::TEXT = ANY(COALESCE(r.destinatario_roles, '{}'::TEXT[]))
            OR ($2::TEXT = 'trabajador' AND 'operario' = ANY(COALESCE(r.destinatario_roles, '{}'::TEXT[]))))
        OR r.usuario_id = $1::UUID
      )
    `;
    const params: unknown[] = [user.id, user.rol ?? ''];
    if (mes) {
      sql += ` AND TO_CHAR(r.fecha, 'YYYY-MM') = $3`;
      params.push(mes);
    }
    sql += ` ORDER BY r.fecha ASC, r.programado_para ASC NULLS LAST`;
    const { rows } = await pool.query(sql, params);
    // Resolver labels de referencia (1 query por recordatorio con ref; OK por volumen)
    for (const r of rows) {
      r.referencia = await resolverReferencia(r.referencia_tipo, r.referencia_id, user.rol);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/recordatorios/pendientes — alertas vencidas no entregadas al usuario actual
router.get('/pendientes', async (req, res) => {
  try {
    const user = (req as any).user as { id: string; rol?: string };
    const { rows } = await pool.query(
      `SELECT r.id, r.programado_para, r.titulo, r.descripcion, r.color,
              r.con_sonido, r.con_notificacion, r.origen,
              r.referencia_tipo, r.referencia_id,
              u.nombre AS creador_nombre, u.rol::text AS creador_rol
       FROM recordatorios r
       LEFT JOIN usuarios u ON u.id = r.usuario_id
       WHERE r.programado_para IS NOT NULL
         AND r.programado_para <= NOW()
         AND NOT ($1::UUID = ANY(COALESCE(r.entregados_por, '{}'::UUID[])))
         AND (
           $1::UUID = ANY(COALESCE(r.destinatarios, '{}'::UUID[]))
           OR ($2::TEXT = ANY(COALESCE(r.destinatario_roles, '{}'::TEXT[]))
            OR ($2::TEXT = 'trabajador' AND 'operario' = ANY(COALESCE(r.destinatario_roles, '{}'::TEXT[]))))
         )
       ORDER BY r.programado_para ASC
       LIMIT 20`,
      [user.id, user.rol ?? '']
    );
    for (const r of rows) {
      r.referencia = await resolverReferencia(r.referencia_tipo, r.referencia_id, user.rol);
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/recordatorios — crear recordatorio
router.post('/', async (req, res) => {
  try {
    const user = (req as any).user as { id: string; rol?: string };
    const {
      fecha, programado_para, titulo, descripcion, color,
      destinatarios, destinatario_roles, con_sonido, con_notificacion, origen,
      referencia_tipo, referencia_id,
    } = req.body;
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: 'titulo obligatorio' });
    }
    if (!fecha && !programado_para) {
      return res.status(400).json({ error: 'fecha o programado_para obligatorio' });
    }
    // Solo admin puede vincular a clientes / proveedores (datos comerciales).
    if ((referencia_tipo === 'cliente' || referencia_tipo === 'proveedor') && user.rol !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden vincular recordatorios a clientes o proveedores' });
    }
    // Si fecha no viene, deriva del timestamp
    const fechaFinal = fecha ?? String(programado_para).slice(0, 10);
    // Si el cliente especificó roles (ej. "Operarios" o "Todos"), respetamos
    // SOLO ese filtro — no añadimos al creador como destinatario. Solo cuando
    // no hay ni roles ni destinatarios explícitos caemos al fallback "para mí"
    // (creador como único destinatario), comportamiento clásico de "Solo a mí".
    const tieneDest = Array.isArray(destinatarios) && destinatarios.length > 0;
    const tieneRoles = Array.isArray(destinatario_roles) && destinatario_roles.length > 0;
    const destFinal: string[] = tieneDest ? destinatarios
      : (tieneRoles ? [] : [user.id]);
    const rolesFinal: string[] = tieneRoles ? destinatario_roles : [];

    const { rows: [r] } = await pool.query(
      `INSERT INTO recordatorios
         (fecha, programado_para, titulo, descripcion, color, usuario_id,
          destinatarios, destinatario_roles, con_sonido, con_notificacion, origen,
          referencia_tipo, referencia_id)
       VALUES ($1::DATE, $2::TIMESTAMPTZ, $3, $4, COALESCE($5, 'indigo'), $6,
               $7::UUID[], $8::TEXT[], COALESCE($9, TRUE), COALESCE($10, TRUE), COALESCE($11, 'manual'),
               $12, $13::UUID)
       RETURNING *`,
      [
        fechaFinal,
        programado_para ?? null,
        String(titulo).trim(),
        descripcion ?? null,
        color ?? null,
        user.id,
        destFinal,
        rolesFinal,
        con_sonido,
        con_notificacion,
        origen,
        referencia_tipo ?? null,
        referencia_id ?? null,
      ]
    );
    res.status(201).json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// PUT /api/recordatorios/:id — editar
router.put('/:id', async (req, res) => {
  try {
    const {
      fecha, programado_para, titulo, descripcion, color, completado,
      destinatarios, destinatario_roles, con_sonido, con_notificacion,
    } = req.body;
    const { rows: [r] } = await pool.query(
      `UPDATE recordatorios SET
         fecha               = COALESCE($1::DATE, fecha),
         programado_para     = $2::TIMESTAMPTZ,
         titulo              = COALESCE($3, titulo),
         descripcion         = $4,
         color               = COALESCE($5, color),
         completado          = COALESCE($6, completado),
         destinatarios       = COALESCE($7::UUID[], destinatarios),
         destinatario_roles  = COALESCE($8::TEXT[], destinatario_roles),
         con_sonido          = COALESCE($9, con_sonido),
         con_notificacion    = COALESCE($10, con_notificacion)
       WHERE id = $11
       RETURNING *`,
      [
        fecha ?? null,
        programado_para ?? null,
        titulo ?? null,
        descripcion ?? null,
        color ?? null,
        completado ?? null,
        destinatarios ?? null,
        destinatario_roles ?? null,
        con_sonido ?? null,
        con_notificacion ?? null,
        req.params.id,
      ]
    );
    if (!r) return res.status(404).json({ error: 'No encontrado' });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/recordatorios/:id/marcar-entregado — marca como visto por el usuario actual
router.post('/:id/marcar-entregado', async (req, res) => {
  try {
    const user = (req as any).user as { id: string };
    const { rows: [r] } = await pool.query(
      `UPDATE recordatorios
       SET entregados_por = array_append(COALESCE(entregados_por, '{}'::UUID[]), $1::UUID)
       WHERE id = $2 AND NOT ($1::UUID = ANY(COALESCE(entregados_por, '{}'::UUID[])))
       RETURNING id`,
      [user.id, req.params.id]
    );
    res.json({ ok: true, marcado: !!r });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// DELETE /api/recordatorios/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM recordatorios WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

export default router;
