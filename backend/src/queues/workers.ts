/**
 * Workers — procesadores de cola
 * Se inician al arrancar el servidor (importar desde index.ts)
 */
import { createWorker } from './index';

// ── PDF Worker ───────────────────────────────────────────────────
// Procesa generación de PDFs en background (no bloquea requests)
export const pdfWorker = createWorker('pdf', async (job) => {
  const { type, params } = job.data as { type: string; params: Record<string, unknown> };
  console.log(`[PDF Worker] Generando ${type} ...`);

  // Aquí irá la lógica de generación de PDF cuando se migre
  // Por ahora es placeholder — los PDFs se siguen generando inline
  switch (type) {
    case 'albaran':
      // TODO: mover lógica de pedidos.routes.ts albaran.pdf aquí
      break;
    case 'trazabilidad':
      // TODO: mover lógica de produccion.controller.ts trazabilidadPdf aquí
      break;
    default:
      throw new Error(`Tipo PDF desconocido: ${type}`);
  }
}, 2);

// ── Email Worker ─────────────────────────────────────────────────
// Envía emails con reintentos automáticos (SMTP puede fallar)
export const emailWorker = createWorker('email', async (job) => {
  const { to, subject, html, attachments } = job.data as {
    to: string; subject: string; html: string;
    attachments?: { filename: string; content: string; encoding: string }[];
  };
  console.log(`[Email Worker] Enviando a ${to}: ${subject}`);

  // Importar nodemailer dinámicamente para no cargar si no hay jobs
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'ERP Loga <noreply@colasloga.es>',
    to,
    subject,
    html,
    attachments: attachments?.map(a => ({
      filename: a.filename,
      content: Buffer.from(a.content, a.encoding as BufferEncoding),
    })),
  });
}, 1); // concurrency 1: no saturar SMTP

// ── Heavy Worker ─────────────────────────────────────────────────
// Backups, recálculos masivos, etc.
export const heavyWorker = createWorker('heavy', async (job) => {
  const { type } = job.data as { type: string };
  console.log(`[Heavy Worker] Procesando ${type} ...`);

  switch (type) {
    case 'backup': {
      const { ejecutarBackup } = await import('../services/backup.service');
      const result = await ejecutarBackup();
      console.log(`[Heavy Worker] Backup: ${result.filename} (${result.size})`);
      break;
    }
    case 'sync-stock': {
      // Recalcular stock de todos los productos desde lotes
      const { pool } = await import('../db/pool');
      await pool.query(`
        UPDATE productos p SET stock_actual = (
          SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l
          WHERE l.producto_id = p.id AND l.estado = 'aprobado' AND l.cantidad_actual > 0
        )
      `);
      console.log('[Heavy Worker] Stock sincronizado');
      break;
    }
    default:
      throw new Error(`Tipo heavy desconocido: ${type}`);
  }
}, 1); // concurrency 1: tareas pesadas de una en una

export function startWorkers() {
  console.log('🔧 Workers BullMQ iniciados: pdf, email, heavy');
}
