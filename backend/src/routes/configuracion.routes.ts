import { Router } from 'express';
import nodemailer from 'nodemailer';
import path from 'path';
import { pool } from '../db/pool';
import { alertaService } from '../services/alerta.service';
import { logger } from '../lib/logger';

const router = Router();

// GET /api/configuracion
router.get('/', async (_req, res) => {
  try {
    const { rows: [cfg] } = await pool.query(
      `SELECT id, porcentaje_alerta, plantilla_email, email_remitente,
              smtp_host, smtp_port, smtp_user,
              CASE WHEN smtp_pass_enc <> '' THEN '••••••••' ELSE '' END AS smtp_pass_set,
              empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono, empresa_web,
              datos_bancarios
       FROM configuracion_global WHERE id = 1`
    );
    return res.json(cfg);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/configuracion/recheck-alertas — fuerza inserción de notificaciones para productos bajos
router.post('/recheck-alertas', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.nombre, p.codigo, p.stock_actual, p.stock_minimo, p.stock_maximo, p.unidad_medida,
             cg.porcentaje_alerta
      FROM productos p, configuracion_global cg
      WHERE p.activo = TRUE AND (
        (p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo)
        OR
        (p.stock_maximo > 0 AND p.stock_actual <= p.stock_maximo * cg.porcentaje_alerta / 100)
      )
    `);

    let creadas = 0;
    for (const p of rows) {
      const umbral = p.stock_maximo > 0 ? (p.stock_maximo * p.porcentaje_alerta / 100).toFixed(3) : '0';
      const result = await pool.query(
        `INSERT INTO notificaciones (tipo, titulo, mensaje, producto_id)
         VALUES ('alerta_stock', $1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          `Stock bajo: ${p.nombre}`,
          `Producto ${p.codigo} — ${p.nombre} tiene stock ${p.stock_actual} ${p.unidad_medida} (mínimo: ${p.stock_minimo}, umbral %: ${umbral}).`,
          p.id,
        ]
      );
      creadas += result.rowCount ?? 0;
    }

    // Also check expiry alerts
    await alertaService.checkCaducidades();

    return res.json({ ok: true, productos_bajos: rows.length, notificaciones_creadas: creadas });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// POST /api/configuracion/test-smtp — envía email de prueba
router.post('/test-smtp', async (_req, res) => {
  try {
    const { rows: [cfg] } = await pool.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_pass_enc, email_remitente
       FROM configuracion_global WHERE id = 1`
    );

    if (!cfg?.smtp_user || !cfg?.smtp_pass_enc) {
      return res.status(400).json({ error: 'SMTP no configurado. Guarda usuario y contraseña primero.' });
    }

    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host || 'smtp.gmail.com',
      port: Number(cfg.smtp_port) || 587,
      secure: Number(cfg.smtp_port) === 465,
      auth: {
        user: cfg.smtp_user,
        pass: cfg.smtp_pass_enc,
      },
    });

    await transporter.sendMail({
      from: cfg.email_remitente || cfg.smtp_user,
      to: cfg.smtp_user,
      subject: 'Test de conexión SMTP — Colas Loga',
      text: 'Este es un email de prueba enviado desde el ERP Loga para verificar la configuración SMTP.\n\nSi recibes este mensaje, la configuración es correcta.',
    });

    return res.json({ ok: true });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : '';
    // Sanitize: never expose credentials or internal details
    const safeMsg = raw.includes('EAUTH') ? 'Credenciales SMTP incorrectas'
      : raw.includes('ECONNREFUSED') ? 'No se puede conectar al servidor SMTP'
      : raw.includes('ETIMEDOUT') ? 'Timeout conectando al servidor SMTP'
      : 'Error al enviar email de prueba';
    return res.status(500).json({ error: safeMsg });
  }
});

// POST /api/configuracion/enviar-email — enviar email genérico via SMTP del programa
router.post('/enviar-email', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'Faltan campos: to, subject, body' });

    // Anti header-injection: rechazar valores que contengan CR/LF en cabeceras
    if (typeof to !== 'string' || /[\r\n]/.test(to)) return res.status(400).json({ error: '"to" inválido' });
    if (typeof subject !== 'string' || /[\r\n]/.test(subject)) return res.status(400).json({ error: '"subject" inválido' });
    if (typeof body !== 'string') return res.status(400).json({ error: '"body" inválido' });
    // Validación email destinatario (single address, no Bcc/Cc smuggling)
    const emailOk = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to.trim());
    if (!emailOk) return res.status(400).json({ error: 'Email destinatario inválido' });

    const { rows: [cfg] } = await pool.query(`SELECT smtp_user, smtp_pass_enc FROM configuracion_global LIMIT 1`);
    const smtpUser = cfg?.smtp_user || process.env.SMTP_USER;
    const smtpPass = cfg?.smtp_pass_enc || process.env.SMTP_PASS;

    if (!smtpUser || !smtpPass) return res.status(500).json({ error: 'SMTP no configurado. Ve a Configuración.' });

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });

    // Escape HTML del body para evitar inyección en HTML mail body
    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `ERP Loga <${smtpUser}>`,
      to: to.trim(),
      subject: subject.trim(),
      text: body, // versión plana
      html: escapeHtml(body).replace(/\n/g, '<br>'),
    });

    return res.json({ ok: true, mensaje: 'Email enviado correctamente.' });
  } catch (err: unknown) {
    logger.error('[configuracion.enviar-email]', { err });
    return res.status(500).json({ error: 'Error al enviar email. Verifica la configuración SMTP.' });
  }
});

// ───────── GOOGLE DRIVE OAUTH ─────────

// GET /api/configuracion/gdrive — estado actual de credenciales
router.get('/gdrive', async (_req, res) => {
  try {
    const { loadConfig } = await import('../lib/gdrive');
    const cfg = await loadConfig();
    res.json({
      client_id_configurado: !!cfg?.client_id,
      autorizado: !!cfg?.refresh_token,
      email: cfg?.email ?? null,
      folder_id: cfg?.folder_id ?? null,
    });
  } catch (e) {
    res.json({ client_id_configurado: false, autorizado: false, email: null, folder_id: null });
  }
});

// PUT /api/configuracion/gdrive — guardar Client ID + Client Secret (sin refresh_token aún)
router.put('/gdrive', async (req, res) => {
  try {
    const { client_id, client_secret, folder_id } = req.body ?? {};
    if (!client_id || !client_secret) {
      return res.status(400).json({ error: 'client_id y client_secret obligatorios' });
    }
    const { saveCredentials } = await import('../lib/gdrive');
    await saveCredentials({
      client_id: String(client_id).trim(),
      client_secret: String(client_secret).trim(),
      folder_id: folder_id ? String(folder_id).trim() : null,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/configuracion/gdrive/authorize?redirect_uri=... — genera URL para que el user autorice
router.get('/gdrive/authorize', async (req, res) => {
  try {
    const { loadConfig, buildOAuthClient, buildAuthUrl } = await import('../lib/gdrive');
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Configura primero Client ID y Client Secret' });
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!redirectUri) return res.status(400).json({ error: 'redirect_uri obligatorio' });
    const client = buildOAuthClient(cfg, redirectUri);
    res.json({ url: buildAuthUrl(client), redirect_uri: redirectUri });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/configuracion/gdrive/callback — intercambia el code por refresh_token
router.post('/gdrive/callback', async (req, res) => {
  try {
    const { code, redirect_uri } = req.body ?? {};
    if (!code || !redirect_uri) return res.status(400).json({ error: 'code y redirect_uri obligatorios' });
    const { loadConfig, buildOAuthClient, saveCredentials } = await import('../lib/gdrive');
    const cfg = await loadConfig();
    if (!cfg) return res.status(400).json({ error: 'Falta Client ID / Secret en BD' });
    const oauth = buildOAuthClient(cfg, String(redirect_uri));
    const { tokens } = await oauth.getToken(String(code));
    if (!tokens.refresh_token) {
      return res.status(400).json({ error: 'Google no devolvió refresh_token. Revoca el acceso de la app y vuelve a autorizar.' });
    }
    // Identificar email del usuario que autorizó
    let email: string | null = null;
    try {
      oauth.setCredentials(tokens);
      const { google } = await import('googleapis');
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth });
      const info = await oauth2.userinfo.get();
      email = info.data.email ?? null;
    } catch { /* opcional */ }
    await saveCredentials({ refresh_token: tokens.refresh_token, email });
    res.json({ ok: true, email });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// POST /api/configuracion/gdrive/disconnect — borrar refresh_token
router.post('/gdrive/disconnect', async (_req, res) => {
  try {
    await pool.query(
      `UPDATE configuracion_global SET gdrive_refresh_token = NULL, gdrive_email = NULL WHERE id = 1`
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/configuracion/backup-password — indica si está configurada (no devuelve la clave)
router.get('/backup-password', async (_req, res) => {
  try {
    const { rows: [c] } = await pool.query(`SELECT backup_password FROM configuracion_global WHERE id = 1`);
    const fromDb = c?.backup_password as string | null;
    const fromEnv = process.env.BACKUP_PASSWORD;
    res.json({
      configurada: !!(fromDb && fromDb.length >= 12) || !!(fromEnv && fromEnv.length >= 12),
      origen: fromDb && fromDb.length >= 12 ? 'bd' : (fromEnv && fromEnv.length >= 12 ? 'env' : 'ninguno'),
      longitud: fromDb ? fromDb.length : (fromEnv ? fromEnv.length : 0),
    });
  } catch {
    res.json({ configurada: !!(process.env.BACKUP_PASSWORD && process.env.BACKUP_PASSWORD.length >= 12), origen: 'env', longitud: process.env.BACKUP_PASSWORD?.length ?? 0 });
  }
});

// PUT /api/configuracion/backup-password — actualizar la contraseña
router.put('/backup-password', async (req, res) => {
  try {
    const { password } = req.body ?? {};
    if (!password || String(password).length < 12) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres' });
    }
    await pool.query(
      `UPDATE configuracion_global SET backup_password = $1 WHERE id = 1`,
      [String(password)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Estado del ultimo backup (para dashboard)
let ultimoBackup: { fecha: string; ok: boolean; filename?: string; size?: string; local?: boolean; icloud?: boolean; drive?: boolean; error?: string } | null = null;

// GET /api/configuracion/backup-status
router.get('/backup-status', async (_req, res) => {
  res.json(ultimoBackup);
});

// POST /api/configuracion/backup — ejecuta backup cifrado + sube a Drive
router.post('/backup', async (req, res) => {
  try {
    const { ejecutarBackup } = require('../services/backup.service');
    const result = await ejecutarBackup();
    ultimoBackup = { fecha: new Date().toISOString(), ok: true, filename: result.filename, size: result.size, local: result.local, icloud: result.icloud, drive: result.drive, error: result.driveError };
    // [H1.1 audit v3] Auditoría fail-soft: no bloquea la respuesta del backup.
    pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
       VALUES ($1, 'BACKUP_MANUAL', 'sistema', NULL, $2)`,
      [(req as any).user?.id ?? null, `Backup manual: ${result.filename} (${result.size}). Drive=${result.drive ? 'OK' : 'NO'}`]
    ).catch((e: unknown) => logger.warn('[auditoria BACKUP_MANUAL]', { err: e instanceof Error ? e.message : e }));
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error en backup';
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error(`[configuracion POST /backup] FALLÓ: ${msg}`, { stack });
    ultimoBackup = { fecha: new Date().toISOString(), ok: false, error: msg };
    res.status(500).json({ error: msg });
  }
});

// GET /api/configuracion/backups — lista backups disponibles
router.get('/backups', async (_req, res) => {
  try {
    const { listarBackups } = require('../services/backup.service');
    const backups = listarBackups();
    res.json(backups);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Error al listar backups.' });
  }
});

// POST /api/configuracion/restaurar — restaurar un backup (path traversal protected)
router.post('/restaurar', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Nombre del archivo es obligatorio.' });
    // Block path traversal: only allow filename, no slashes or dots
    if (/[/\\]/.test(filename) || filename.includes('..')) {
      return res.status(400).json({ error: 'Nombre de archivo invalido.' });
    }
    const pathMod = require('path');
    const backupDir = pathMod.resolve(process.cwd(), '..', 'backups');
    const backupPath = pathMod.join(backupDir, filename);
    // Verify resolved path is inside backup directory
    if (!pathMod.resolve(backupPath).startsWith(backupDir)) {
      return res.status(400).json({ error: 'Ruta invalida.' });
    }
    const { restaurarBackup } = require('../services/backup.service');
    const result = await restaurarBackup(backupPath);

    // [H1.1 audit v3] Auditoría OBLIGATORIA del restore (operación más
    // destructiva del sistema). Caso especial: usamos await + try/catch para
    // intentar registrar antes de responder al cliente, pero el catch es
    // SILENCIOSO — un fallo del INSERT NUNCA se devuelve al cliente, la
    // respuesta del restore va siempre. La forensia depende de logs si la
    // BD también está mal. Se registra OK o KO con detalle.
    try {
      await pool.query(
        `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, registro_id, motivo)
         VALUES ($1, 'RESTORE_BACKUP', 'sistema', NULL, $2)`,
        [(req as any).user?.id ?? null, `Restore ${filename} → ${result.ok ? 'OK' : 'FALLÓ'}. ${result.message ?? ''}${result.pre_restore_backup ? ` Pre-backup: ${result.pre_restore_backup}` : ''}`.slice(0, 500)]
      );
    } catch (e) {
      logger.warn('[auditoria RESTORE_BACKUP]', { err: e instanceof Error ? e.message : e });
    }

    if (!result.ok) return res.status(500).json({ error: result.message, pre_restore_backup: result.pre_restore_backup });
    return res.json(result);
  } catch (err: unknown) {
    return res.status(500).json({ error: 'Error al restaurar el backup.' });
  }
});

// PUT /api/configuracion
router.put('/', async (req, res) => {
  try {
    const { porcentaje_alerta, plantilla_email, email_remitente, smtp_user, smtp_pass_enc,
            empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono, empresa_web,
            nivel_bronce, nivel_plata, nivel_oro, datos_bancarios } = req.body;
    const { rows: [cfg] } = await pool.query(
      `UPDATE configuracion_global SET
         porcentaje_alerta = COALESCE($1::NUMERIC, porcentaje_alerta),
         plantilla_email   = COALESCE($2, plantilla_email),
         email_remitente   = COALESCE($3, email_remitente),
         smtp_user         = COALESCE($4, smtp_user),
         smtp_pass_enc     = CASE WHEN $5::TEXT IS NOT NULL AND $5 <> '' THEN $5 ELSE smtp_pass_enc END,
         empresa_nombre    = COALESCE($6, empresa_nombre),
         empresa_cif       = COALESCE($7, empresa_cif),
         empresa_direccion = COALESCE($8, empresa_direccion),
         empresa_telefono  = COALESCE($9, empresa_telefono),
         empresa_web       = COALESCE($10, empresa_web),
         nivel_bronce      = COALESCE($11::NUMERIC, nivel_bronce),
         nivel_plata       = COALESCE($12::NUMERIC, nivel_plata),
         nivel_oro         = COALESCE($13::NUMERIC, nivel_oro),
         datos_bancarios   = CASE WHEN $14::BOOLEAN THEN $15::TEXT ELSE datos_bancarios END
       WHERE id = 1
       RETURNING *`,
      [
        porcentaje_alerta != null ? Number(porcentaje_alerta) : null,
        plantilla_email   ?? null,
        email_remitente   ?? null,
        smtp_user         ?? null,
        smtp_pass_enc     ?? null,
        empresa_nombre    ?? null,
        empresa_cif       ?? null,
        empresa_direccion ?? null,
        empresa_telefono  ?? null,
        empresa_web       ?? null,
        nivel_bronce != null ? Number(nivel_bronce) : null,
        nivel_plata != null ? Number(nivel_plata) : null,
        nivel_oro != null ? Number(nivel_oro) : null,
        datos_bancarios !== undefined,
        datos_bancarios != null ? String(datos_bancarios) : null,
      ]
    );

    // Recalcular niveles de clientes con los nuevos umbrales
    await pool.query(`
      UPDATE clientes c SET
        consumo_total = COALESCE((SELECT SUM(pd.total::NUMERIC) FROM pedidos pd WHERE pd.cliente_id = c.id AND pd.estado = 'completado'), 0)
    `);
    await pool.query(`
      UPDATE clientes SET nivel = CASE
        WHEN consumo_total >= $1 THEN 'oro'
        WHEN consumo_total >= $2 THEN 'plata'
        WHEN consumo_total >= $3 THEN 'bronce'
        ELSE NULL
      END
    `, [cfg.nivel_oro, cfg.nivel_plata, cfg.nivel_bronce]);
    return res.json(cfg);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// GET /api/configuracion/auditoria
router.get('/auditoria', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, u.nombre AS usuario_nombre
      FROM auditoria a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      ORDER BY a.fecha DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── SUBCATEGORÍAS MP (catálogo editable: resina, agua, pigmento…) ──────────
router.get('/subcategorias-mp', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, orden, activo FROM subcategorias_mp
       WHERE activo = TRUE ORDER BY orden ASC, nombre ASC`
    );
    return res.json(rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/subcategorias-mp', async (req, res) => {
  try {
    const nombre = String(req.body?.nombre ?? '').trim().slice(0, 50);
    const orden = Number.isFinite(Number(req.body?.orden)) ? Number(req.body?.orden) : 0;
    if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
    const { rows: [row] } = await pool.query(
      `INSERT INTO subcategorias_mp (nombre, orden) VALUES ($1, $2) RETURNING id, nombre, orden, activo`,
      [nombre, orden]
    );
    return res.status(201).json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe una sub-categoría con ese nombre.' });
    }
    return res.status(500).json({ error: msg });
  }
});

router.put('/subcategorias-mp/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, orden, activo } = req.body ?? {};
    const nombreNorm = nombre != null ? String(nombre).trim().slice(0, 50) : null;
    if (nombreNorm !== null && !nombreNorm) return res.status(400).json({ error: 'Nombre no puede estar vacío' });
    // Si se renombra, propagar el cambio a productos.subcategoria_mp para
    // mantener consistencia (sub-categoría se almacena como texto).
    if (nombreNorm) {
      const { rows: [actual] } = await pool.query(`SELECT nombre FROM subcategorias_mp WHERE id = $1`, [id]);
      if (actual && actual.nombre !== nombreNorm) {
        await pool.query(
          `UPDATE productos SET subcategoria_mp = $1 WHERE subcategoria_mp = $2`,
          [nombreNorm, actual.nombre]
        );
      }
    }
    const { rows: [row] } = await pool.query(
      `UPDATE subcategorias_mp SET
         nombre = COALESCE($1, nombre),
         orden  = COALESCE($2::INT, orden),
         activo = COALESCE($3, activo)
       WHERE id = $4 RETURNING id, nombre, orden, activo`,
      [nombreNorm, orden != null ? Number(orden) : null, activo ?? null, id]
    );
    if (!row) return res.status(404).json({ error: 'Sub-categoría no encontrada' });
    return res.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe una sub-categoría con ese nombre.' });
    }
    return res.status(500).json({ error: msg });
  }
});

router.delete('/subcategorias-mp/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Soft delete (mantener integridad de productos con esta sub-categoría asignada)
    const { rows: [row] } = await pool.query(
      `UPDATE subcategorias_mp SET activo = FALSE WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Sub-categoría no encontrada' });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── SUBCATEGORÍAS ME (catálogo editable: Bote, Caja, Etiqueta, Tapón…) ──────
router.get('/subcategorias-me', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, orden, activo FROM subcategorias_me
       WHERE activo = TRUE ORDER BY orden ASC, nombre ASC`
    );
    return res.json(rows);
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

router.post('/subcategorias-me', async (req, res) => {
  try {
    const nombre = String(req.body?.nombre ?? '').trim().slice(0, 50);
    const orden = Number.isFinite(Number(req.body?.orden)) ? Number(req.body?.orden) : 0;
    if (!nombre) return res.status(400).json({ error: 'Nombre obligatorio' });
    const { rows: [row] } = await pool.query(
      `INSERT INTO subcategorias_me (nombre, orden) VALUES ($1, $2) RETURNING id, nombre, orden, activo`,
      [nombre, orden]
    );
    return res.status(201).json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe una sub-categoría con ese nombre.' });
    }
    return res.status(500).json({ error: msg });
  }
});

router.put('/subcategorias-me/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, orden, activo } = req.body ?? {};
    const nombreNorm = nombre != null ? String(nombre).trim().slice(0, 50) : null;
    if (nombreNorm !== null && !nombreNorm) return res.status(400).json({ error: 'Nombre no puede estar vacío' });
    // Propagar rename a productos.subcategoria_me (texto)
    if (nombreNorm) {
      const { rows: [actual] } = await pool.query(`SELECT nombre FROM subcategorias_me WHERE id = $1`, [id]);
      if (actual && actual.nombre !== nombreNorm) {
        await pool.query(
          `UPDATE productos SET subcategoria_me = $1 WHERE subcategoria_me = $2`,
          [nombreNorm, actual.nombre]
        );
      }
    }
    const { rows: [row] } = await pool.query(
      `UPDATE subcategorias_me SET
         nombre = COALESCE($1, nombre),
         orden  = COALESCE($2::INT, orden),
         activo = COALESCE($3, activo)
       WHERE id = $4 RETURNING id, nombre, orden, activo`,
      [nombreNorm, orden != null ? Number(orden) : null, activo ?? null, id]
    );
    if (!row) return res.status(404).json({ error: 'Sub-categoría no encontrada' });
    return res.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe una sub-categoría con ese nombre.' });
    }
    return res.status(500).json({ error: msg });
  }
});

router.delete('/subcategorias-me/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: [row] } = await pool.query(
      `UPDATE subcategorias_me SET activo = FALSE WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'Sub-categoría no encontrada' });
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Error' });
  }
});

// ── INTEGRACIÓN ALILO — endpoints admin (JWT) para configurar/auditar ──────
import { getAliloSharedSecret, regenerateAliloSecret } from './integracionAlilo.routes';

router.get('/integracion/alilo/status', async (req, res) => {
  const secret = await getAliloSharedSecret();
  const port = process.env.PORT ?? '3001';
  const host = (req.headers['host'] ?? '').toString().split(':')[0] || 'pc-loga.local';
  const url = `http://${host}:${port}/api/integracion/alilo/consumir`;

  const { rows: productosCompartidos } = await pool.query(
    `SELECT codigo, nombre, unidad_medida, stock_actual, codigo_alilo
     FROM productos
     WHERE compartido_alilo = TRUE AND activo = TRUE
     ORDER BY codigo`
  );

  const { rows: [cfg] } = await pool.query<{ alilo_webhook_url: string | null }>(
    `SELECT alilo_webhook_url FROM integracion_alilo_config WHERE id = 1`
  );

  return res.json({
    activo: !!secret,
    url,
    shared_secret: secret,
    alilo_webhook_url: cfg?.alilo_webhook_url ?? null,
    productos_compartidos: productosCompartidos,
    instrucciones: 'Copia este secret a la configuración de Alilo. Genera uno nuevo si sospechas que se filtró.',
  });
});

// POST /integracion/alilo/regenerar-secret — rota el HMAC compartido
router.post('/integracion/alilo/regenerar-secret', async (_req, res) => {
  const newSecret = await regenerateAliloSecret();
  return res.json({ ok: true, shared_secret: newSecret });
});

// PUT /integracion/alilo/webhook-url — configura URL del webhook de Alilo
router.put('/integracion/alilo/webhook-url', async (req, res) => {
  const { url } = req.body ?? {};
  const urlNorm = typeof url === 'string' && url.trim() ? url.trim().slice(0, 300) : null;
  await pool.query(
    `UPDATE integracion_alilo_config SET alilo_webhook_url = $1, updated_at = now() WHERE id = 1`,
    [urlNorm]
  );
  return res.json({ ok: true, alilo_webhook_url: urlNorm });
});

router.get('/integracion/alilo/log', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, endpoint, payload, status_code, respuesta, ip_origen, error, created_at
     FROM integracion_alilo_log
     ORDER BY created_at DESC
     LIMIT 100`
  );
  return res.json(rows);
});

export default router;
