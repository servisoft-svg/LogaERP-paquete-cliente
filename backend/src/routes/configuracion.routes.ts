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
              empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono, empresa_web
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

// Estado del ultimo backup (para dashboard)
let ultimoBackup: { fecha: string; ok: boolean; filename?: string; size?: string; local?: boolean; icloud?: boolean; drive?: boolean; error?: string } | null = null;

// GET /api/configuracion/backup-status
router.get('/backup-status', async (_req, res) => {
  res.json(ultimoBackup);
});

// POST /api/configuracion/backup — ejecuta backup cifrado + sube a Drive
router.post('/backup', async (_req, res) => {
  try {
    const { ejecutarBackup } = require('../services/backup.service');
    const result = await ejecutarBackup();
    ultimoBackup = { fecha: new Date().toISOString(), ok: true, filename: result.filename, size: result.size, local: result.local, icloud: result.icloud, drive: result.drive, error: result.driveError };
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error en backup';
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

    if (!result.ok) return res.status(500).json({ error: result.message });
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
            nivel_bronce, nivel_plata, nivel_oro } = req.body;
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
         nivel_oro         = COALESCE($13::NUMERIC, nivel_oro)
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

export default router;
