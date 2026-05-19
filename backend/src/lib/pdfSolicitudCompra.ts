// PDF estilo factura para solicitud de compra a proveedor.
// Genera en memoria (Buffer) para poder adjuntarlo al email o servir HTTP.
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { pool } from '../db/pool';

const LOGO_PATH = path.join(process.cwd(), 'assets', 'logo-real.png');

export interface SolicitudCompraData {
  numero_solicitud: string;
  producto_codigo: string;
  producto_nombre: string;
  unidad_medida: string;
  cantidad: number;
  precio_unitario: number | null;
  importe_total: number | null;
  proveedor_nombre: string;
  destinatario: string;
  notas: string | null;
  fecha: Date;
  empresa_nombre: string;
  empresa_cif?: string | null;
  empresa_direccion?: string | null;
  empresa_telefono?: string | null;
  solicitante_nombre?: string | null;
}

export async function cargarDatosEmpresa(): Promise<{ nombre: string; cif?: string; direccion?: string; telefono?: string }> {
  const { rows: [c] } = await pool.query(
    `SELECT empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono FROM configuracion_global WHERE id = 1`
  );
  return {
    nombre: c?.empresa_nombre ?? 'Colas Loga',
    cif: c?.empresa_cif ?? '',
    direccion: c?.empresa_direccion ?? '',
    telefono: c?.empresa_telefono ?? '',
  };
}

export function renderSolicitudCompraPDF(data: SolicitudCompraData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const RED    = '#FF0000';
    const TXT    = '#111827';
    const GRAY   = '#6B7280';
    const SOFT   = '#9CA3AF';
    const BORDER = '#E5E7EB';

    const ML = 50;
    const MR = 545;

    const fmtEur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const hasLogo = fs.existsSync(LOGO_PATH);

    // ── CABECERA MINIMALISTA ──────────────────────────────────────
    // Logo + nombre empresa a la izquierda (pequeño, discreto)
    if (hasLogo) {
      try { doc.image(LOGO_PATH, ML, 48, { fit: [38, 38] }); } catch { /* skip */ }
    }
    const empresaX = hasLogo ? ML + 48 : ML;
    doc.fillColor(TXT).font('Helvetica-Bold').fontSize(13).text(data.empresa_nombre, empresaX, 52);
    doc.font('Helvetica').fontSize(8.5).fillColor(SOFT);
    let yE = 70;
    if (data.empresa_cif)       { doc.text(`CIF: ${data.empresa_cif}`, empresaX, yE); yE += 10; }
    if (data.empresa_direccion) { doc.text(data.empresa_direccion, empresaX, yE, { width: 230 }); }

    // Título derecha (estable, sin solapar)
    doc.fillColor(TXT).font('Helvetica-Bold').fontSize(11)
      .text('SOLICITUD DE COMPRA', 350, 52, { width: 195, align: 'right', characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(RED)
      .text(`Nº ${data.numero_solicitud}`, 350, 68, { width: 195, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(data.fecha.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }),
        350, 90, { width: 195, align: 'right' });

    // Línea horizontal fina
    let y = 120;
    doc.moveTo(ML, y).lineTo(MR, y).strokeColor(BORDER).lineWidth(0.7).stroke();
    y += 18;

    // ── PARA (destinatario) ───────────────────────────────────────
    doc.font('Helvetica').fontSize(8).fillColor(SOFT).text('PARA', ML, y);
    y += 12;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TXT)
      .text(data.proveedor_nombre, ML, y, { width: 495 });
    y = doc.y + 2;
    doc.font('Helvetica').fontSize(9).fillColor(GRAY)
      .text(data.destinatario, ML, y, { width: 495 });
    y = doc.y + 22;

    // ── TABLA LÍNEAS (limpia, solo bordes finos) ──────────────────
    // Header con línea inferior solamente
    const colCod = ML;
    const colDesc = ML + 70;
    const colCant = 360;
    const colPrec = 430;
    const colTot  = MR;

    doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(8)
      .text('CÓDIGO',      colCod,  y, { width: 65 })
      .text('DESCRIPCIÓN', colDesc, y, { width: 230 })
      .text('CANTIDAD',    colCant - 60, y, { width: 60, align: 'right' })
      .text('PRECIO',      colPrec - 60, y, { width: 60, align: 'right' })
      .text('TOTAL',       colTot - 70, y, { width: 70, align: 'right' });
    y += 12;
    doc.moveTo(ML, y).lineTo(MR, y).strokeColor(TXT).lineWidth(0.5).stroke();
    y += 10;

    // Fila producto
    doc.fillColor(TXT).font('Helvetica-Bold').fontSize(10)
      .text(data.producto_codigo, colCod, y, { width: 65 });
    doc.font('Helvetica').fontSize(10)
      .text(data.producto_nombre, colDesc, y, { width: 220 });
    doc.font('Helvetica').fontSize(10).fillColor(TXT)
      .text(`${data.cantidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${data.unidad_medida}`,
        colCant - 60, y, { width: 60, align: 'right' });
    if (data.precio_unitario != null) {
      doc.text(`${fmtEur(data.precio_unitario)} €`, colPrec - 60, y, { width: 60, align: 'right' });
      doc.font('Helvetica-Bold').text(`${fmtEur(data.importe_total ?? 0)} €`, colTot - 70, y, { width: 70, align: 'right' });
    } else {
      doc.font('Helvetica-Oblique').fillColor(SOFT).fontSize(9)
        .text('a confirmar', colPrec - 60, y + 1, { width: 130, align: 'right' });
    }
    y += 18;
    doc.moveTo(ML, y).lineTo(MR, y).strokeColor(BORDER).lineWidth(0.4).stroke();
    y += 16;

    // ── TOTAL (a la derecha, sin caja roja) ───────────────────────
    if (data.importe_total != null) {
      doc.fillColor(GRAY).font('Helvetica').fontSize(9)
        .text('Subtotal', 360, y, { width: 110, align: 'right' });
      doc.fillColor(TXT).font('Helvetica').fontSize(9)
        .text(`${fmtEur(data.importe_total)} €`, 475, y, { width: 70, align: 'right' });
      y += 14;
      doc.moveTo(360, y).lineTo(MR, y).strokeColor(TXT).lineWidth(0.5).stroke();
      y += 6;
      doc.fillColor(TXT).font('Helvetica-Bold').fontSize(12)
        .text('TOTAL', 360, y, { width: 110, align: 'right' });
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(13)
        .text(`${fmtEur(data.importe_total)} €`, 475, y - 1, { width: 70, align: 'right' });
      y += 26;
    } else {
      y += 4;
    }

    // ── OBSERVACIONES (minimalista, sin colores) ──────────────────
    if (data.notas && data.notas.trim()) {
      doc.fillColor(SOFT).font('Helvetica-Bold').fontSize(8).text('OBSERVACIONES', ML, y);
      y += 12;
      // Línea izquierda fina como acento
      const textH = doc.heightOfString(data.notas, { width: 480 });
      doc.rect(ML, y - 2, 2, textH + 8).fill(RED);
      doc.fillColor(TXT).font('Helvetica').fontSize(10)
        .text(data.notas, ML + 12, y, { width: 480 });
      y = doc.y + 22;
    }

    // ── FIRMA ─────────────────────────────────────────────────────
    if (y > 700) y = 700;
    const firmante = data.solicitante_nombre || data.empresa_nombre;
    doc.fillColor(SOFT).font('Helvetica').fontSize(8)
      .text('Solicita', MR - 200, y, { width: 200, align: 'right' });
    y += 32;
    doc.moveTo(MR - 180, y).lineTo(MR, y).strokeColor(TXT).lineWidth(0.5).stroke();
    doc.fillColor(TXT).font('Helvetica-Bold').fontSize(10)
      .text(firmante, MR - 200, y + 4, { width: 200, align: 'right' });
    doc.fillColor(GRAY).font('Helvetica').fontSize(8)
      .text(data.empresa_nombre, MR - 200, y + 18, { width: 200, align: 'right' })
      .text(data.fecha.toLocaleDateString('es-ES'), MR - 200, y + 30, { width: 200, align: 'right' });

    // ── FOOTER mínimo ─────────────────────────────────────────────
    doc.fillColor(SOFT).font('Helvetica').fontSize(7)
      .text(`Conserve este número en las comunicaciones de seguimiento  ·  ${data.numero_solicitud}`,
        ML, 800, { width: 495, align: 'center' });

    doc.end();
  });
}

/**
 * Inserta el registro en pedidos_proveedor + genera número + devuelve el PDF buffer
 * en una sola llamada, listo para adjuntar al email y guardar referencia.
 */
export async function crearSolicitudYRenderPDF(input: {
  producto_id: string;
  destinatario: string;
  cantidad: number;
  precio_unitario?: number | null;
  notas?: string | null;
  usuario_id?: string | null;
}): Promise<{ id: string; numero: string; pdf: Buffer; importe_total: number | null }> {
  const año = new Date().getFullYear();
  const { rows: [seq] } = await pool.query(`SELECT nextval('seq_solicitud_compra') AS n`);
  const numero = `SP-${año}-${String(seq.n).padStart(5, '0')}`;

  const importe = input.precio_unitario != null && !isNaN(Number(input.precio_unitario))
    ? Number(input.precio_unitario) * input.cantidad
    : null;

  const { rows: [prod] } = await pool.query(
    `SELECT p.codigo, p.nombre, p.unidad_medida, p.proveedor_id, pv.nombre AS proveedor_nombre
     FROM productos p LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
     WHERE p.id = $1`,
    [input.producto_id]
  );
  if (!prod) throw new Error('PRODUCTO_NO_ENCONTRADO');

  const { rows: [registro] } = await pool.query(
    `INSERT INTO pedidos_proveedor
       (producto_id, proveedor_id, cantidad_solicitada, destinatario_email, notas,
        usuario_solicitud_id, numero_solicitud, precio_unitario, importe_total, estado)
     VALUES ($1, $2, $3::NUMERIC, $4, $5, $6, $7, $8::NUMERIC, $9::NUMERIC, 'enviado')
     RETURNING id`,
    [
      input.producto_id, prod.proveedor_id, input.cantidad.toFixed(6),
      input.destinatario, input.notas ?? null, input.usuario_id ?? null,
      numero,
      input.precio_unitario ?? null,
      importe ?? null,
    ]
  );

  const empresa = await cargarDatosEmpresa();
  // Nombre del solicitante para firmar el PDF
  let solicitante: string | null = null;
  if (input.usuario_id) {
    const { rows: [u] } = await pool.query(`SELECT nombre FROM usuarios WHERE id = $1`, [input.usuario_id]);
    solicitante = u?.nombre ?? null;
  }
  const pdf = await renderSolicitudCompraPDF({
    numero_solicitud: numero,
    producto_codigo: prod.codigo,
    producto_nombre: prod.nombre,
    unidad_medida: prod.unidad_medida,
    cantidad: input.cantidad,
    precio_unitario: input.precio_unitario ?? null,
    importe_total: importe ?? null,
    proveedor_nombre: prod.proveedor_nombre ?? 'Proveedor',
    destinatario: input.destinatario,
    notas: input.notas ?? null,
    fecha: new Date(),
    empresa_nombre: empresa.nombre,
    empresa_cif: empresa.cif,
    empresa_direccion: empresa.direccion,
    empresa_telefono: empresa.telefono,
    solicitante_nombre: solicitante,
  });

  return { id: registro.id, numero, pdf, importe_total: importe };
}
