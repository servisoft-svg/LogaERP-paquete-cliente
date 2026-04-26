import nodemailer from 'nodemailer';
import { pool } from '../db/pool';

interface EmailPedidoPayload {
  destinatario:  string;
  producto_id:   string;
  cantidad_sugerida: number;
  notas_adicionales?: string;
  cuerpo_personalizado?: string;
  usuario_id?:   string;
}

interface ConfigEmail {
  smtp_host:    string;
  smtp_port:    number;
  smtp_user:    string;
  smtp_pass_enc: string;
  plantilla_email: string;
  email_remitente: string;
}

class EmailService {
  private buildTransport(cfg: ConfigEmail) {
    return nodemailer.createTransport({
      host:   cfg.smtp_host   || process.env.SMTP_HOST,
      port:   cfg.smtp_port   || Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: cfg.smtp_user   || process.env.SMTP_USER,
        pass: cfg.smtp_pass_enc || process.env.SMTP_PASS,
      },
    });
  }

  async enviarPedidoStock(payload: EmailPedidoPayload): Promise<void> {
    // Cargar configuración y datos del producto/proveedor en paralelo
    const [cfgRes, prodRes] = await Promise.all([
      pool.query<ConfigEmail>(`SELECT * FROM configuracion_global WHERE id = 1`),
      pool.query<{
        nombre: string; codigo: string; unidad_medida: string;
        proveedor_nombre: string; proveedor_email: string;
      }>(
        `SELECT p.nombre, p.codigo, p.unidad_medida,
                pv.nombre AS proveedor_nombre, pv.email AS proveedor_email
         FROM productos p
         LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
         WHERE p.id = $1`,
        [payload.producto_id]
      ),
    ]);

    const cfg     = cfgRes.rows[0];
    const prod    = prodRes.rows[0];

    if (!prod) throw new Error('PRODUCTO_NO_ENCONTRADO');

    // Sustituir variables en plantilla
    const cantidadFormateada = payload.cantidad_sugerida.toLocaleString('es-ES', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });

    const cuerpoBase = cfg.plantilla_email
      .replace(/\{\{producto\}\}/g,  prod.nombre)
      .replace(/\{\{cantidad\}\}/g,  cantidadFormateada)
      .replace(/\{\{unidad\}\}/g,    prod.unidad_medida)
      .replace(/\{\{proveedor\}\}/g, prod.proveedor_nombre ?? 'Proveedor')
      + (payload.notas_adicionales ? `\n\nNotas adicionales: ${payload.notas_adicionales}` : '');

    const cuerpo = payload.cuerpo_personalizado ?? cuerpoBase;

    const destinatario = payload.destinatario || prod.proveedor_email;
    if (!destinatario) throw new Error('SIN_EMAIL_DESTINATARIO');

    const transporter = this.buildTransport(cfg);

    await transporter.sendMail({
      from:    cfg.email_remitente || process.env.EMAIL_FROM || 'ERP Loga <erp@loga.es>',
      to:      destinatario,
      subject: `Pedido ${prod.nombre} — Fábrica Loga`,
      text:    cuerpo,
    });

    // Marcar notificación como email_enviado
    await pool.query(
      `UPDATE notificaciones SET email_enviado = TRUE
       WHERE producto_id = $1 AND email_enviado = FALSE`,
      [payload.producto_id]
    );

    // Auditoría
    await pool.query(
      `INSERT INTO auditoria (usuario_id, accion, tabla_afectada, motivo)
       VALUES ($1, 'ENVIO_EMAIL_PEDIDO', 'productos', $2)`,
      [payload.usuario_id ?? null, `Email pedido enviado a ${destinatario} para ${prod.codigo}`]
    );
  }
}

export const emailService = new EmailService();
