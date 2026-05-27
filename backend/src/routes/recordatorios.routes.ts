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

// GET /api/recordatorios — lista del mes del calendario, filtrada al usuario actual
// El calendario muestra TODOS los recordatorios visibles para el user (destinatario o rol).
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user as { id: string; rol?: string };
    const mes = String(req.query.mes ?? ''); // formato YYYY-MM
    let sql = `
      SELECT id, TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
             programado_para, titulo, descripcion, color, completado,
             usuario_id, destinatarios, destinatario_roles,
             con_sonido, con_notificacion, entregados_por, origen, created_at
      FROM recordatorios
      WHERE (
        -- Visible para mí: soy destinatario directo, mi rol está en roles, o yo lo creé
        $1::UUID = ANY(COALESCE(destinatarios, '{}'::UUID[]))
        OR $2::TEXT = ANY(COALESCE(destinatario_roles, '{}'::TEXT[]))
        OR usuario_id = $1::UUID
      )
    `;
    const params: unknown[] = [user.id, user.rol ?? ''];
    if (mes) {
      sql += ` AND TO_CHAR(fecha, 'YYYY-MM') = $3`;
      params.push(mes);
    }
    sql += ` ORDER BY fecha ASC, programado_para ASC NULLS LAST`;
    const { rows } = await pool.query(sql, params);
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
      `SELECT id, programado_para, titulo, descripcion, color,
              con_sonido, con_notificacion, origen
       FROM recordatorios
       WHERE programado_para IS NOT NULL
         AND programado_para <= NOW()
         AND NOT ($1::UUID = ANY(COALESCE(entregados_por, '{}'::UUID[])))
         AND (
           $1::UUID = ANY(COALESCE(destinatarios, '{}'::UUID[]))
           OR $2::TEXT = ANY(COALESCE(destinatario_roles, '{}'::TEXT[]))
         )
       ORDER BY programado_para ASC
       LIMIT 20`,
      [user.id, user.rol ?? '']
    );
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
    } = req.body;
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: 'titulo obligatorio' });
    }
    if (!fecha && !programado_para) {
      return res.status(400).json({ error: 'fecha o programado_para obligatorio' });
    }
    // Si fecha no viene, deriva del timestamp
    const fechaFinal = fecha ?? String(programado_para).slice(0, 10);
    // Default destinatarios: el creador
    const destFinal: string[] = Array.isArray(destinatarios) && destinatarios.length > 0
      ? destinatarios : [user.id];
    const rolesFinal: string[] = Array.isArray(destinatario_roles) ? destinatario_roles : [];

    const { rows: [r] } = await pool.query(
      `INSERT INTO recordatorios
         (fecha, programado_para, titulo, descripcion, color, usuario_id,
          destinatarios, destinatario_roles, con_sonido, con_notificacion, origen)
       VALUES ($1::DATE, $2::TIMESTAMPTZ, $3, $4, COALESCE($5, 'indigo'), $6,
               $7::UUID[], $8::TEXT[], COALESCE($9, TRUE), COALESCE($10, TRUE), COALESCE($11, 'manual'))
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
