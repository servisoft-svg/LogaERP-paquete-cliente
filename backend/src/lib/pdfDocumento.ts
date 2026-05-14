/**
 * Generador PDF unificado para Albarán y Factura.
 * Diseño: minimalista. Logo como acento, tipografía Helvetica con jerarquía,
 * paleta sobria (negro/gris/rojo sutil), mucho espacio en blanco.
 *
 * Sin trazabilidad, sin fotos, sin secciones "extra" — un documento mercantil
 * limpio y profesional. Las firmas se incluyen solo en albaranes.
 */

import fs from 'fs';
import path from 'path';

export type TipoDocumento = 'albaran' | 'factura';

export interface PdfDocumentoDatos {
  empresa: {
    nombre: string;
    cif: string;
    direccion: string;
    telefono: string;
    web: string;
    email: string;
  };
  pedido: {
    numero_pedido: string;
    fecha_entrega: string | null;
    fecha_emision?: string | null;
    cliente_nombre_rel: string | null;
    cliente_nombre: string | null;
    cliente_nif: string | null;
    cliente_direccion: string | null;
    cliente_telefono?: string | null;
    cliente_email_rel?: string | null;
    subtotal: string | number | null;
    portes: string | number | null;
    iva_porcentaje: string | number | null;
    total: string | number | null;
    notas: string | null;
  };
  lineas: Array<{
    producto_nombre_rel: string | null;
    producto_nombre: string | null;
    producto_codigo: string | null;
    cantidad: string | number | null;
    unidad_medida: string | null;
    precio_unitario: string | number | null;
    subtotal: string | number | null;
  }>;
}

const COLOR = {
  black:  '#0A0A0A',
  text:   '#1F2937',
  muted:  '#6B7280',
  border: '#E5E7EB',
  bg:     '#FAFAFA',
  accent: '#E8001C', // rojo Loga — solo en detalles
  white:  '#FFFFFF',
};

const PAGE_W = 595;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2; // 495

const fmtNum = (n: string | number | null): string => {
  if (n === null || n === undefined || n === '') return '';
  return parseFloat(String(n)).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d: string | null): string => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtDateLong = (d: Date): string =>
  d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });

export function renderDocumentoPDF(doc: PDFKit.PDFDocument, tipo: TipoDocumento, data: PdfDocumentoDatos): void {
  const { empresa: EMP, pedido, lineas } = data;
  const titulo = tipo === 'albaran' ? 'ALBARÁN' : 'FACTURA';
  const numeroDoc = tipo === 'factura' ? `F-${pedido.numero_pedido}` : pedido.numero_pedido;
  const fechaEmision = pedido.fecha_emision ? new Date(pedido.fecha_emision) : new Date();

  const LOGO = path.join(process.cwd(), 'assets', 'logo-real.png');
  const hasLogo = fs.existsSync(LOGO);

  // ── CABECERA ─────────────────────────────────────────────────
  // Logo izquierda, título y número derecha. Sin bandas de color.
  let y = MARGIN;

  if (hasLogo) {
    try {
      doc.image(LOGO, MARGIN, y, { fit: [70, 70] });
    } catch { /* ignore */ }
  }

  // Título doc (a la derecha)
  doc.fillColor(COLOR.black)
    .font('Helvetica-Bold').fontSize(26)
    .text(titulo, MARGIN, y + 8, { width: CONTENT_W, align: 'right' });

  doc.fillColor(COLOR.muted)
    .font('Helvetica').fontSize(9)
    .text(`Nº ${numeroDoc}`, MARGIN, y + 40, { width: CONTENT_W, align: 'right' });
  doc.text(fmtDateLong(fechaEmision), MARGIN, y + 52, { width: CONTENT_W, align: 'right' });

  y += 90;

  // Línea separadora fina roja a todo el ancho
  doc.strokeColor(COLOR.accent).lineWidth(0.8);
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).stroke();

  y += 24;

  // ── EMISOR + DESTINATARIO ────────────────────────────────────
  const colW = (CONTENT_W - 30) / 2;

  // Emisor
  doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(8).text('EMISOR', MARGIN, y);
  doc.fillColor(COLOR.black).font('Helvetica-Bold').fontSize(11).text(EMP.nombre, MARGIN, y + 14);
  doc.fillColor(COLOR.text).font('Helvetica').fontSize(9);
  let ey = y + 30;
  if (EMP.cif) { doc.text(`CIF · ${EMP.cif}`, MARGIN, ey); ey += 12; }
  if (EMP.direccion) { doc.text(EMP.direccion, MARGIN, ey, { width: colW }); ey += 12; }
  if (EMP.telefono) { doc.text(`Tel · ${EMP.telefono}`, MARGIN, ey); ey += 12; }
  if (EMP.email) { doc.text(EMP.email, MARGIN, ey); ey += 12; }

  // Destinatario
  const dx = MARGIN + colW + 30;
  doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(8).text('DESTINATARIO', dx, y);
  const clienteNombre = pedido.cliente_nombre_rel ?? pedido.cliente_nombre ?? '—';
  doc.fillColor(COLOR.black).font('Helvetica-Bold').fontSize(11).text(clienteNombre, dx, y + 14, { width: colW });
  doc.fillColor(COLOR.text).font('Helvetica').fontSize(9);
  let dy = y + 30;
  if (pedido.cliente_nif) { doc.text(`NIF/CIF · ${pedido.cliente_nif}`, dx, dy); dy += 12; }
  if (pedido.cliente_direccion) { doc.text(pedido.cliente_direccion, dx, dy, { width: colW }); dy += 12; }
  if (pedido.cliente_telefono) { doc.text(`Tel · ${pedido.cliente_telefono}`, dx, dy); dy += 12; }

  y = Math.max(ey, dy) + 20;

  // ── DETALLE ──────────────────────────────────────────────────
  // Tabla minimalista: header con fondo gris muy claro, líneas finas.
  const cols = { num: 24, desc: 235, cant: 60, ud: 38, precio: 65, total: 73 };
  const colX = {
    num: MARGIN,
    desc: MARGIN + cols.num,
    cant: MARGIN + cols.num + cols.desc,
    ud: MARGIN + cols.num + cols.desc + cols.cant,
    precio: MARGIN + cols.num + cols.desc + cols.cant + cols.ud,
    total: MARGIN + cols.num + cols.desc + cols.cant + cols.ud + cols.precio,
  };

  // Header tabla
  doc.fillColor(COLOR.bg).rect(MARGIN, y, CONTENT_W, 24).fill();
  doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(8);
  doc.text('#',           colX.num,    y + 9, { width: cols.num - 4 });
  doc.text('DESCRIPCIÓN', colX.desc,   y + 9, { width: cols.desc - 4 });
  doc.text('CANTIDAD',    colX.cant,   y + 9, { width: cols.cant - 4, align: 'right' });
  doc.text('UD.',         colX.ud,     y + 9, { width: cols.ud - 4, align: 'right' });
  doc.text('PRECIO',      colX.precio, y + 9, { width: cols.precio - 4, align: 'right' });
  doc.text('IMPORTE',     colX.total,  y + 9, { width: cols.total - 4, align: 'right' });
  y += 24;

  // Línea bajo header
  doc.strokeColor(COLOR.border).lineWidth(0.5);
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).stroke();

  // Filas
  const items = lineas.length > 0 ? lineas : [];
  items.forEach((l, i) => {
    if (y > 720) { doc.addPage(); y = MARGIN; }
    const rowH = 28;
    const nombre = (l.producto_nombre_rel ?? l.producto_nombre ?? '—');
    const codigo = l.producto_codigo ? l.producto_codigo : '';

    doc.fillColor(COLOR.muted).font('Helvetica').fontSize(9).text(String(i + 1), colX.num, y + 9, { width: cols.num - 4 });
    doc.fillColor(COLOR.black).font('Helvetica-Bold').fontSize(9.5).text(nombre, colX.desc, y + 6, { width: cols.desc - 4 });
    if (codigo) doc.fillColor(COLOR.muted).font('Helvetica').fontSize(8).text(codigo, colX.desc, y + 17, { width: cols.desc - 4 });

    doc.fillColor(COLOR.text).font('Helvetica').fontSize(9.5);
    doc.text(l.cantidad ? fmtNum(l.cantidad) : '', colX.cant, y + 9, { width: cols.cant - 4, align: 'right' });
    doc.text(l.unidad_medida ?? 'kg', colX.ud, y + 9, { width: cols.ud - 4, align: 'right' });
    doc.text(l.precio_unitario ? fmtNum(l.precio_unitario) : '', colX.precio, y + 9, { width: cols.precio - 4, align: 'right' });
    doc.fillColor(COLOR.black).font('Helvetica-Bold').text(l.subtotal ? fmtNum(l.subtotal) : '', colX.total, y + 9, { width: cols.total - 4, align: 'right' });

    y += rowH;
    doc.strokeColor(COLOR.border).lineWidth(0.5);
    doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).stroke();
  });

  y += 12;

  // ── TOTALES ──────────────────────────────────────────────────
  const subtotal = pedido.subtotal ? parseFloat(String(pedido.subtotal)) : 0;
  if (subtotal > 0) {
    const totalsX = MARGIN + CONTENT_W - 220;
    const totalsW = 220;
    const labelW = 110;
    const valueW = 100;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.fillColor(COLOR.muted).font('Helvetica').fontSize(9).text(label, totalsX, y, { width: labelW });
      doc.fillColor(bold ? COLOR.black : COLOR.text).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5)
        .text(value, totalsX + labelW + 10, y - (bold ? 1 : 0), { width: valueW, align: 'right' });
      y += bold ? 18 : 16;
    };

    totalRow('Base imponible', `${fmtNum(subtotal)} €`);
    const portes = pedido.portes ? parseFloat(String(pedido.portes)) : 0;
    if (portes > 0) totalRow('Portes', `${fmtNum(portes)} €`);
    const ivaPct = pedido.iva_porcentaje ? parseFloat(String(pedido.iva_porcentaje)) : 21;
    const base = subtotal + portes;
    const ivaAmt = base * ivaPct / 100;
    totalRow(`IVA ${ivaPct}%`, `${fmtNum(ivaAmt)} €`);

    // Línea separadora antes del TOTAL
    doc.strokeColor(COLOR.black).lineWidth(0.8);
    doc.moveTo(totalsX, y + 2).lineTo(totalsX + totalsW, y + 2).stroke();
    y += 8;

    totalRow('TOTAL', `${fmtNum(pedido.total)} €`, true);
    y += 8;
  }

  // ── OBSERVACIONES ────────────────────────────────────────────
  if (pedido.notas) {
    if (y > 700) { doc.addPage(); y = MARGIN; }
    y += 14;
    doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(8).text('OBSERVACIONES', MARGIN, y);
    y += 12;
    doc.fillColor(COLOR.text).font('Helvetica').fontSize(9).text(pedido.notas, MARGIN, y, { width: CONTENT_W });
    y += 30;
  }

  // ── FIRMAS (solo albarán) ────────────────────────────────────
  if (tipo === 'albaran') {
    const signY = Math.max(y + 20, 670);
    if (signY < 760) {
      const signW = (CONTENT_W - 30) / 2;
      doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(8);
      doc.text('ENTREGADO POR', MARGIN, signY);
      doc.text('RECIBIDO POR · sello y firma', MARGIN + signW + 30, signY);

      // Cuadros más altos (68pt) y labels Nombre/Fecha posicionadas claramente dentro
      doc.strokeColor(COLOR.border).lineWidth(0.5);
      doc.rect(MARGIN, signY + 12, signW, 68).stroke();
      doc.rect(MARGIN + signW + 30, signY + 12, signW, 68).stroke();

      doc.fillColor(COLOR.muted).font('Helvetica').fontSize(7);
      doc.text('Nombre',  MARGIN + 6,             signY + 50);
      doc.text('Fecha',   MARGIN + 6,             signY + 64);
      doc.text('Nombre',  MARGIN + signW + 36,    signY + 50);
      doc.text('Fecha',   MARGIN + signW + 36,    signY + 64);
    }
  }

  // ── PIE ──────────────────────────────────────────────────────
  doc.strokeColor(COLOR.accent).lineWidth(0.8);
  doc.moveTo(MARGIN, 808).lineTo(PAGE_W - MARGIN, 808).stroke();

  const piePartes = [
    EMP.nombre,
    EMP.cif ? `CIF ${EMP.cif}` : '',
    EMP.direccion,
    EMP.email,
    EMP.web,
  ].filter(Boolean);

  doc.fillColor(COLOR.muted).font('Helvetica').fontSize(7)
    .text(piePartes.join(' · '), MARGIN, 815, { width: CONTENT_W, align: 'center' });

  if (tipo === 'factura') {
    doc.fillColor(COLOR.muted).font('Helvetica-Oblique').fontSize(6.5)
      .text('Factura conforme al RD 1619/2012 sobre obligaciones de facturación.', MARGIN, 826, { width: CONTENT_W, align: 'center' });
  }
}
