// PDF estilo factura para solicitud de compra a proveedor.
// Genera en memoria (Buffer) para poder adjuntarlo al email o servir HTTP.
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { pool } from '../db/pool';

const LOGO_PATH      = path.join(process.cwd(), 'assets', 'logo-real.png');
const LOGO_GRAY_PATH = path.join(process.cwd(), 'assets', 'logo-real-gray.png');

// Genera el logo en escala de grises (una sola vez) si no existe todavía.
// Se hace lazy en el primer uso para no bloquear arranque.
async function asegurarLogoGris(): Promise<string | null> {
  try {
    if (!fs.existsSync(LOGO_PATH)) return null;
    if (!fs.existsSync(LOGO_GRAY_PATH)) {
      await sharp(LOGO_PATH).grayscale().toFile(LOGO_GRAY_PATH);
    }
    return LOGO_GRAY_PATH;
  } catch { return null; }
}

export interface SolicitudCompraData {
  numero_solicitud: string;
  producto_codigo: string;
  producto_nombre: string;
  unidad_medida: string;
  cantidad: number;
  precio_unitario: number | null;
  importe_total: number | null;
  proveedor_nombre: string;
  proveedor_direccion?: string | null;
  proveedor_telefono?: string | null;
  destinatario: string;
  notas: string | null;
  fecha: Date;
  porte_a?: 'proveedor' | 'cliente' | null;
  empresa_nombre: string;
  empresa_cif?: string | null;
  empresa_direccion?: string | null;
  empresa_telefono?: string | null;
  datos_bancarios?: string | null;
  solicitante_nombre?: string | null;
}

export async function cargarDatosEmpresa(): Promise<{ nombre: string; cif?: string; direccion?: string; telefono?: string; datos_bancarios?: string }> {
  const { rows: [c] } = await pool.query(
    `SELECT empresa_nombre, empresa_cif, empresa_direccion, empresa_telefono, datos_bancarios FROM configuracion_global WHERE id = 1`
  );
  return {
    nombre: c?.empresa_nombre ?? 'Colas Loga',
    cif: c?.empresa_cif ?? '',
    direccion: c?.empresa_direccion ?? '',
    telefono: c?.empresa_telefono ?? '',
    datos_bancarios: c?.datos_bancarios ?? '',
  };
}

export async function renderSolicitudCompraPDF(data: SolicitudCompraData): Promise<Buffer> {
  const logoGrayPath = await asegurarLogoGris();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const RED  = '#C00000';
    const TXT  = '#000000';
    const GRAY = '#6B7280';

    const ML = 36;
    const MR = 559;
    const W  = MR - ML;

    const fmtEur = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtCant = (n: number) => n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    const fmtFecha = (d: Date) => d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const hasLogo = fs.existsSync(LOGO_PATH);

    // ── CABECERA ──
    let y = 40;
    const LOGO_W = 110;
    const LOGO_H = 90;
    if (hasLogo) {
      try { doc.image(LOGO_PATH, ML, y, { fit: [LOGO_W, LOGO_H] }); } catch { /* skip */ }
    }
    const txtX = ML + LOGO_W + 16;
    const txtW = MR - txtX;
    doc.fillColor(TXT).font('Helvetica-Bold').fontSize(20)
      .text('PEDIDO A PROVEEDORES', txtX, y + 12, { width: txtW, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TXT)
      .text(`NÚMERO DE PEDIDO: ${data.numero_solicitud}`, txtX, y + 42, { width: txtW, align: 'center' });
    doc.font('Helvetica').fontSize(11).fillColor(GRAY)
      .text(`Fecha: ${fmtFecha(data.fecha)}`, txtX, y + 62, { width: txtW, align: 'center' });
    y += 100;

    doc.moveTo(ML, y).lineTo(MR, y).strokeColor(RED).lineWidth(1.5).stroke();
    y += 12;

    // ── Datos del cliente (yo, la empresa) | Datos del proveedor ──
    // Dos columnas lado a lado.
    const colGap = 14;
    const colBoxW = (W - colGap) / 2;
    const colClienteX = ML;
    const colProvX = ML + colBoxW + colGap;
    const topBlocks = y;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text('DATOS DEL CLIENTE', colClienteX, y);
    doc.text('DATOS DEL PROVEEDOR', colProvX, y);
    y += 14;

    // Cliente (mis datos)
    let yL = y;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TXT)
      .text(data.empresa_nombre, colClienteX + 10, yL, { width: colBoxW - 16 });
    yL = doc.y + 4;
    doc.font('Helvetica').fontSize(9.5).fillColor(TXT);
    if (data.empresa_cif) {
      doc.text(`CIF: ${data.empresa_cif}`, colClienteX + 10, yL, { width: colBoxW - 16 });
      yL = doc.y + 2;
    }
    if (data.empresa_direccion) {
      doc.text(data.empresa_direccion, colClienteX + 10, yL, { width: colBoxW - 16 });
      yL = doc.y + 2;
    }
    if (data.empresa_telefono) {
      doc.text(`Tel.: ${data.empresa_telefono}`, colClienteX + 10, yL, { width: colBoxW - 16 });
      yL = doc.y + 2;
    }
    yL = doc.y + 6;

    // Proveedor (al lado)
    let yR = y;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TXT)
      .text(data.proveedor_nombre, colProvX + 10, yR, { width: colBoxW - 16 });
    yR = doc.y + 4;
    doc.font('Helvetica').fontSize(9.5).fillColor(TXT);
    if (data.proveedor_direccion && data.proveedor_direccion.trim()) {
      doc.text(data.proveedor_direccion, colProvX + 10, yR, { width: colBoxW - 16 });
      yR = doc.y + 2;
    }
    if (data.proveedor_telefono && data.proveedor_telefono.trim()) {
      doc.text(`Tel.: ${data.proveedor_telefono}`, colProvX + 10, yR, { width: colBoxW - 16 });
      yR = doc.y + 2;
    }
    doc.fillColor(GRAY).text(`Email: ${data.destinatario}`, colProvX + 10, yR, { width: colBoxW - 16 });
    yR = doc.y + 6;

    // Bordes laterales rojos en ambas cajas
    const blockBottom = Math.max(yL, yR);
    doc.rect(colClienteX, topBlocks + 14 - 4, 3, blockBottom - (topBlocks + 14) + 4).fill(RED);
    doc.rect(colProvX,    topBlocks + 14 - 4, 3, blockBottom - (topBlocks + 14) + 4).fill(RED);
    y = blockBottom + 16;

    // ── TABLA ARTÍCULOS ──
    // Cols: Envases | Descripción | Cantidad | Precio unidad | Importe
    const cEnv  = ML;
    const cDesc = ML + 60;
    const cCant = ML + 300;
    const cPrec = ML + 380;
    const cImp  = ML + 470;
    const wEnv  = cDesc - cEnv;
    const wDesc = cCant - cDesc;
    const wCant = cPrec - cCant;
    const wPrec = cImp  - cPrec;
    const wImp  = MR    - cImp;

    // Cabecera tabla
    doc.rect(ML, y, W, 18).strokeColor(TXT).lineWidth(0.5).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TXT)
      .text('Envases',                cEnv  + 4, y + 5, { width: wEnv  - 8 })
      .text('Descripción del artículo', cDesc + 4, y + 5, { width: wDesc - 8 })
      .text('Cantidad',                cCant + 4, y + 5, { width: wCant - 8, align: 'right' })
      .text('Precio unidad',           cPrec + 4, y + 5, { width: wPrec - 8, align: 'right' })
      .text('Importe',                 cImp  + 4, y + 5, { width: wImp  - 8, align: 'right' });
    y += 18;

    // Fila producto (única línea por ahora)
    const filaH = 28;
    doc.rect(ML, y, W, filaH).strokeColor(TXT).lineWidth(0.3).stroke();
    doc.font('Helvetica').fontSize(10).fillColor(TXT)
      .text('1', cEnv + 4, y + 10, { width: wEnv - 8 });
    doc.font('Helvetica').fontSize(10).fillColor(TXT)
      .text(data.producto_nombre, cDesc + 4, y + 6, { width: wDesc - 8 });
    doc.text(`${fmtCant(data.cantidad)} ${data.unidad_medida}`, cCant + 4, y + 10, { width: wCant - 8, align: 'right' });
    if (data.precio_unitario != null) {
      doc.text(fmtEur(data.precio_unitario), cPrec + 4, y + 10, { width: wPrec - 8, align: 'right' });
      doc.font('Helvetica-Bold').text(fmtEur(data.importe_total ?? 0), cImp + 4, y + 10, { width: wImp - 8, align: 'right' });
    } else {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAY)
        .text('a confirmar', cPrec + 4, y + 10, { width: wPrec + wImp - 8, align: 'right' });
    }
    y += filaH;

    // ── TOTALES (Base | Dto | IVA | TOTAL) ──
    const base    = data.importe_total ?? 0;
    const ivaPct  = 21;
    const importeIva = +(base * ivaPct / 100).toFixed(2);
    const total   = base + importeIva;

    y += 18;
    const totH = 38;
    doc.rect(ML, y, W, totH).strokeColor(TXT).lineWidth(0.5).stroke();
    const totCols = [
      { label: 'Base Imponible', value: data.precio_unitario != null ? `${fmtEur(base)} €` : '—' },
      { label: 'Dto Comercial %', value: '0%' },
      { label: 'Dto Comercial €', value: data.precio_unitario != null ? `${fmtEur(base)} €` : '—' },
      { label: 'IVA %', value: `${ivaPct}%` },
      { label: 'Importe IVA', value: data.precio_unitario != null ? `${fmtEur(importeIva)} €` : '—' },
      { label: 'Suma Total', value: data.precio_unitario != null ? `${fmtEur(total)} €` : '—' },
    ];
    const colW = W / totCols.length;
    totCols.forEach((c, i) => {
      const cx = ML + i * colW;
      doc.font('Helvetica').fontSize(8).fillColor(GRAY)
        .text(c.label, cx + 4, y + 6, { width: colW - 8, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(11).fillColor(i === totCols.length - 1 ? RED : TXT)
        .text(c.value, cx + 4, y + 20, { width: colW - 8, align: 'center' });
      if (i < totCols.length - 1) {
        doc.moveTo(cx + colW, y).lineTo(cx + colW, y + totH).strokeColor(TXT).lineWidth(0.3).stroke();
      }
    });
    y += totH + 26;

    // ── BLOQUES INFO (porte / banco) — compacto, etiqueta + valor en misma línea ──
    const porteValor =
      data.porte_a === 'cliente'   ? 'Debido' :
      data.porte_a === 'proveedor' ? 'Pagado' :
      '—';
    const bancarios = (data.datos_bancarios ?? '').trim() || '—';
    const lineas: { label: string; value: string }[] = [
      { label: 'Porte:',           value: porteValor },
      { label: 'Datos bancarios:', value: bancarios },
    ];
    for (const b of lineas) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(TXT);
      const labelW = doc.widthOfString(b.label) + 6;
      doc.text(b.label, ML, y, { continued: false });
      doc.font('Helvetica').fontSize(11).fillColor(TXT)
        .text(b.value, ML + labelW, y, { width: W - labelW });
      y = doc.y + 6;
    }
    y += 6;

    // ── OBSERVACIONES (escritas por el operario) ──
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TXT).text('Observaciones:', ML, y);
    y += 18;
    if (data.notas && data.notas.trim()) {
      doc.font('Helvetica').fontSize(11).fillColor(TXT).text(data.notas, ML, y, { width: W, lineGap: 2 });
      y = doc.y + 14;
    } else {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(GRAY)
        .text('—', ML, y, { width: W });
      y += 20;
    }

    // ── MUY IMPORTANTE — NORMAS ──
    if (y > 620) { doc.addPage(); y = 40; }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(RED).text('MUY IMPORTANTE', ML, y, { width: W, align: 'center' });
    y += 20;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TXT)
      .text('NORMAS PARA LA EXPEDICIÓN, FACTURACIÓN Y COBRO DE MERCANCÍAS', ML, y, { width: W, align: 'center' });
    y += 24;
    doc.font('Helvetica').fontSize(10).fillColor(TXT);
    const normas = [
      '1º.- El envío de la mercancía presupone la aceptación de las condiciones de este pedido.',
      '2º.- Con cada envío se acompañará albarán dónde constará nuestro número de pedido.',
      '3º.- El horario de descarga es de LUNES a VIERNES de 9 a 16:30 horas.',
      '4º.- El día de pago es el 20 de cada mes, excepto Agosto.',
    ];
    for (const n of normas) {
      doc.text(n, ML, y, { width: W, lineGap: 1 });
      y = doc.y + 6;
    }
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(RED)
      .text(
        'EL INCUMPLIMIENTO DE ESTAS NORMAS DARÁ LUGAR, SEGÚN SU CASO, A LA DEVOLUCIÓN DE LA MERCANCÍA, GIRO O RECIBO.',
        ML, y, { width: W, align: 'center' }
      );
    y = doc.y + 32;

    // ── FIRMA ──
    if (y > 720) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TXT).text('FIRMA (Dpto de Compras):', ML, y);
    y += 40;
    doc.moveTo(ML, y).lineTo(ML + 260, y).strokeColor(TXT).lineWidth(0.5).stroke();
    const firmante = data.solicitante_nombre || data.empresa_nombre;
    doc.font('Helvetica').fontSize(11).fillColor(TXT).text(`Fdo. ${firmante}`, ML, y + 6);

    // ── SELLO: logo en escala de grises (versión preprocesada con sharp) ──
    const sealLogo = logoGrayPath ?? (hasLogo ? LOGO_PATH : null);
    if (sealLogo) {
      const sealCx = ML + 360;
      const sealCy = y - 8;
      const sz = 110;
      doc.save();
      doc.translate(sealCx, sealCy).rotate(-7);
      doc.opacity(0.75);
      try {
        doc.image(sealLogo, -sz / 2, -sz / 2, { fit: [sz, sz] });
      } catch { /* skip */ }
      doc.opacity(1);
      doc.restore();
    }

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
  porte_a?: 'proveedor' | 'cliente';
}): Promise<{ id: string; numero: string; pdf: Buffer; importe_total: number | null }> {
  const año = new Date().getFullYear();
  const { rows: [seq] } = await pool.query(`SELECT nextval('seq_solicitud_compra') AS n`);
  // Formato corto tipo AC01/2026 (sec por año, padded a 2 dígitos)
  const numero = `AC${String(seq.n).padStart(2, '0')}/${año}`;

  const importe = input.precio_unitario != null && !isNaN(Number(input.precio_unitario))
    ? Number(input.precio_unitario) * input.cantidad
    : null;

  const { rows: [prod] } = await pool.query(
    `SELECT p.codigo, p.nombre, p.unidad_medida, p.proveedor_id,
            pv.nombre AS proveedor_nombre,
            pv.direccion AS proveedor_direccion,
            pv.telefono  AS proveedor_telefono
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
    proveedor_direccion: prod.proveedor_direccion ?? null,
    proveedor_telefono: prod.proveedor_telefono ?? null,
    destinatario: input.destinatario,
    notas: input.notas ?? null,
    fecha: new Date(),
    porte_a: input.porte_a ?? 'proveedor',
    empresa_nombre: empresa.nombre,
    empresa_cif: empresa.cif,
    empresa_direccion: empresa.direccion,
    empresa_telefono: empresa.telefono,
    datos_bancarios: empresa.datos_bancarios,
    solicitante_nombre: solicitante,
  });

  return { id: registro.id, numero, pdf, importe_total: importe };
}
