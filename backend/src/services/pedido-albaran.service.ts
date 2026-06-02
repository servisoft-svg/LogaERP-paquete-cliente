/**
 * Servicio reusable para enviar albaranes por email.
 * Usado tanto por el endpoint /api/pedidos/:id/enviar-albaran como por
 * automatizaciones (auto-email-albaran tras completar pedido).
 */
import nodemailer from 'nodemailer';
import http from 'http';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';

interface ConfigEmail {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass_enc: string;
  email_remitente: string;
  email_copia_albaranes: string | null;
}

class PedidoAlbaranService {
  /**
   * Genera PDF + adjuntos y envía email al destinatario indicado.
   * Lanza error si no encuentra el pedido o falla el SMTP.
   */
  async enviarAlbaran(pedidoId: string, email: string): Promise<{ ok: true; enviado_a: string }> {
    if (!email) throw new Error('SIN_EMAIL_DESTINATARIO');

    const { rows: [pedido] } = await pool.query<{
      id: string; numero_pedido: string; producto_nombre: string | null;
      cantidad: string | null; unidad_medida: string | null; orden_produccion_id: string | null;
    }>(
      `SELECT pd.id, pd.numero_pedido, pd.producto_nombre, pd.cantidad, pd.unidad_medida,
              pd.orden_produccion_id
       FROM pedidos pd WHERE pd.id = $1`,
      [pedidoId]
    );
    if (!pedido) throw new Error('PEDIDO_NO_ENCONTRADO');

    const { rows: lineas } = await pool.query<{
      producto_nombre: string | null; producto_nombre_rel: string | null;
      cantidad: string | null; unidad_medida: string | null;
    }>(
      `SELECT lp.producto_nombre, p.nombre AS producto_nombre_rel, lp.cantidad, lp.unidad_medida
       FROM lineas_pedido lp LEFT JOIN productos p ON p.id = lp.producto_id
       WHERE lp.pedido_id = $1`,
      [pedidoId]
    );

    // PDF albarán
    const pdfBuffer = await this.fetchPdfInterno(`/api/pedidos/${pedidoId}/albaran.pdf`);
    const attachments: { filename: string; content?: Buffer; path?: string; contentType?: string }[] = [
      { filename: `albaran-${pedido.numero_pedido}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
    ];

    // Trazabilidad y fotos si hay producción asociada
    if (pedido.orden_produccion_id) {
      try {
        const traz = await this.fetchPdfInterno(`/api/produccion/${pedido.orden_produccion_id}/trazabilidad.pdf`);
        attachments.push({ filename: `trazabilidad-${pedido.numero_pedido}.pdf`, content: traz, contentType: 'application/pdf' });
      } catch { /* sin trazabilidad → ignora */ }

      const { rows: [orden] } = await pool.query<{ foto_urls: string[] | null; archivos: { url: string; nombre: string }[] | null }>(
        `SELECT foto_urls, archivos FROM ordenes_produccion WHERE id = $1`,
        [pedido.orden_produccion_id]
      );
      if (orden) {
        for (const url of orden.foto_urls ?? []) {
          const p = path.join(process.cwd(), url.replace(/^\//, ''));
          if (fs.existsSync(p)) attachments.push({ filename: `foto${path.extname(p)}`, path: p });
        }
        for (const a of orden.archivos ?? []) {
          const p = path.join(process.cwd(), a.url.replace(/^\//, ''));
          if (fs.existsSync(p)) attachments.push({ filename: a.nombre, path: p });
        }
      }
    }

    // SMTP
    const { rows: [cfg] } = await pool.query<ConfigEmail>(`SELECT * FROM configuracion_global WHERE id = 1`);
    const transporter = nodemailer.createTransport({
      host: cfg?.smtp_host || process.env.SMTP_HOST,
      port: cfg?.smtp_port || Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: cfg?.smtp_user || process.env.SMTP_USER, pass: cfg?.smtp_pass_enc || process.env.SMTP_PASS },
    });

    const items = lineas.length > 0 ? lineas : [{ producto_nombre_rel: pedido.producto_nombre, cantidad: pedido.cantidad, unidad_medida: pedido.unidad_medida }];
    const itemsText = items.map(l => `  - ${l.producto_nombre_rel ?? ''}: ${l.cantidad ? parseFloat(l.cantidad).toLocaleString('es-ES') : ''} ${l.unidad_medida ?? 'kg'}`).join('\n');

    const copiaBcc = cfg?.email_copia_albaranes?.trim();
    await transporter.sendMail({
      from: cfg?.email_remitente || process.env.EMAIL_FROM || 'Colas Loga <erp@loga.es>',
      to: email,
      ...(copiaBcc && copiaBcc !== email ? { bcc: copiaBcc } : {}),
      subject: `Albaran ${pedido.numero_pedido} - Colas Loga`,
      text: `Estimado cliente,\n\nAdjuntamos albaran de entrega ${pedido.numero_pedido}.\n\nProductos:\n${itemsText}\n\nColas Loga\nAdhesivos Vinilicos de Alta Resistencia`,
      attachments,
    });

    // Marcar pedido como ya archivado (copia interna) si había email configurado
    if (copiaBcc) {
      await pool.query(
        `UPDATE pedidos SET albaran_copia_archivada_at = COALESCE(albaran_copia_archivada_at, NOW()) WHERE id = $1`,
        [pedidoId]
      );
    }

    return { ok: true, enviado_a: email };
  }

  /**
   * Envía únicamente la copia de archivo del albarán al email configurado en
   * `configuracion_global.email_copia_albaranes`. Se usa cuando el albarán se
   * descarga manualmente (GET /albaran.pdf) y aún no se había archivado por
   * email. Idempotente: si el pedido ya tiene `albaran_copia_archivada_at`,
   * no se reenvía. NO falla la operación principal si el email peta.
   */
  async enviarCopiaArchivoSiProcede(pedidoId: string): Promise<{ enviado: boolean; motivo?: string }> {
    try {
      const { rows: [cfg] } = await pool.query<ConfigEmail>(`SELECT * FROM configuracion_global WHERE id = 1`);
      const copia = cfg?.email_copia_albaranes?.trim();
      if (!copia) return { enviado: false, motivo: 'sin_email_copia' };

      const { rows: [pedido] } = await pool.query<{
        id: string; numero_pedido: string; albaran_copia_archivada_at: string | null;
      }>(
        `SELECT id, numero_pedido, albaran_copia_archivada_at FROM pedidos WHERE id = $1`,
        [pedidoId]
      );
      if (!pedido) return { enviado: false, motivo: 'pedido_no_encontrado' };
      if (pedido.albaran_copia_archivada_at) return { enviado: false, motivo: 'ya_archivado' };

      const pdfBuffer = await this.fetchPdfInterno(`/api/pedidos/${pedidoId}/albaran.pdf`);
      const transporter = nodemailer.createTransport({
        host: cfg?.smtp_host || process.env.SMTP_HOST,
        port: cfg?.smtp_port || Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: { user: cfg?.smtp_user || process.env.SMTP_USER, pass: cfg?.smtp_pass_enc || process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: cfg?.email_remitente || process.env.EMAIL_FROM || 'Colas Loga <erp@loga.es>',
        to: copia,
        subject: `[Archivo] Albaran ${pedido.numero_pedido}`,
        text: `Copia de archivo del albarán ${pedido.numero_pedido}.\n\nGenerado automáticamente desde el ERP al descargar/generar el albarán.`,
        attachments: [
          { filename: `albaran-${pedido.numero_pedido}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
        ],
      });

      await pool.query(
        `UPDATE pedidos SET albaran_copia_archivada_at = NOW() WHERE id = $1`,
        [pedidoId]
      );
      return { enviado: true };
    } catch (err) {
      // No bloquear la respuesta del PDF si falla el archivo
      return { enviado: false, motivo: err instanceof Error ? err.message : 'error' };
    }
  }

  /**
   * Envío al cliente cuando el pedido pasa a 'fabricado'.
   * Solo adjunta la trazabilidad SIN información económica + mensaje breve.
   */
  async enviarTrazabilidadFabricado(pedidoId: string, email: string): Promise<{ ok: true; enviado_a: string }> {
    if (!email) throw new Error('SIN_EMAIL_DESTINATARIO');

    const { rows: [pedido] } = await pool.query<{
      id: string; numero_pedido: string; orden_produccion_id: string | null;
      cliente_nombre: string | null;
    }>(
      `SELECT pd.id, pd.numero_pedido, pd.orden_produccion_id,
              COALESCE(pd.cliente_nombre, c.nombre) AS cliente_nombre
       FROM pedidos pd LEFT JOIN clientes c ON c.id = pd.cliente_id
       WHERE pd.id = $1`,
      [pedidoId]
    );
    if (!pedido) throw new Error('PEDIDO_NO_ENCONTRADO');
    if (!pedido.orden_produccion_id) throw new Error('PEDIDO_SIN_ORDEN_PRODUCCION');

    // PDF trazabilidad sin datos económicos
    const trazBuffer = await this.fetchPdfInterno(`/api/produccion/${pedido.orden_produccion_id}/trazabilidad.pdf?sin_costes=1`);

    const attachments = [
      { filename: `trazabilidad-${pedido.numero_pedido}.pdf`, content: trazBuffer, contentType: 'application/pdf' },
    ];

    const { rows: [cfg] } = await pool.query<ConfigEmail>(`SELECT * FROM configuracion_global WHERE id = 1`);
    const transporter = nodemailer.createTransport({
      host: cfg?.smtp_host || process.env.SMTP_HOST,
      port: cfg?.smtp_port || Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: cfg?.smtp_user || process.env.SMTP_USER, pass: cfg?.smtp_pass_enc || process.env.SMTP_PASS },
    });

    const saludo = pedido.cliente_nombre ? `Estimado/a ${pedido.cliente_nombre}` : 'Estimado cliente';
    const text = [
      `${saludo},`,
      '',
      `Le informamos de que su pedido ${pedido.numero_pedido} ya ha sido fabricado. En breve será enviado a la dirección de entrega indicada.`,
      '',
      'Adjuntamos la trazabilidad de la producción con el detalle de las materias primas y lotes utilizados, conforme a nuestros estándares de calidad.',
      '',
      'Cualquier consulta, no dude en contactarnos.',
      '',
      'Un saludo,',
      'Colas Loga',
      'Adhesivos Vinílicos de Alta Resistencia',
    ].join('\n');

    const copiaBcc = cfg?.email_copia_albaranes?.trim();
    await transporter.sendMail({
      from: cfg?.email_remitente || process.env.EMAIL_FROM || 'Colas Loga <erp@loga.es>',
      to: email,
      ...(copiaBcc && copiaBcc !== email ? { bcc: copiaBcc } : {}),
      subject: `Su pedido ${pedido.numero_pedido} ha sido fabricado`,
      text,
      attachments,
    });

    return { ok: true, enviado_a: email };
  }

  private async resolveAdminId(): Promise<string | null> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM usuarios WHERE rol = 'admin' AND activo = TRUE ORDER BY created_at ASC LIMIT 1`
    );
    return rows[0]?.id ?? null;
  }

  private async fetchPdfInterno(pathUrl: string): Promise<Buffer> {
    // Whitelist estricta de paths internos permitidos (anti-SSRF). Cualquier
    // ruta fuera del patrón se rechaza antes de abrir el socket. Si en el
    // futuro se añaden nuevos PDFs internos, ampliar la lista aquí.
    const ALLOWED_PDF = /^\/api\/(pedidos|produccion)\/[A-Za-z0-9-]+\/(albaran|trazabilidad)\.pdf(\?.*)?$/;
    if (!ALLOWED_PDF.test(pathUrl)) {
      throw new Error(`PDF_PATH_NO_PERMITIDO:${pathUrl.slice(0, 80)}`);
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET_MISSING');
    const adminId = (await this.resolveAdminId()) ?? '00000000-0000-0000-0000-000000000000';
    // Token de sistema con TTL muy corto (60s) firmado con el mismo JWT_SECRET
    // y algoritmo pinneado a HS256 (anti-downgrade alg=none).
    const token = jwt.sign({ id: adminId, rol: 'admin', sistema: true }, secret, { expiresIn: '60s', algorithm: 'HS256' });
    const port = process.env.PORT ?? 3001;
    return new Promise<Buffer>((resolve, reject) => {
      const req = http.get({
        host: 'localhost', port: Number(port), path: pathUrl,
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10_000,
      }, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          req.destroy();
          return reject(new Error(`PDF_FAIL_${res.statusCode}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('timeout', () => {
        req.destroy(new Error('PDF_TIMEOUT'));
      });
      req.on('error', reject);
    });
  }
}

export const pedidoAlbaranService = new PedidoAlbaranService();
