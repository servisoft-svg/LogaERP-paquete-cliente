import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import path from 'node:path';

/**
 * Genera PDF de la etiqueta de Cola Blanca L-800 (formato 150×100 mm, igual
 * que la etiqueta GoDEX original). Lote, cantidad y aniversario se sustituyen
 * dinámicamente; logo Loga embebido desde assets.
 *
 * Layout reconstruido del .ezpx original (300 dpi → 72 pt):
 *   - Logo droplet (top-left)
 *   - "COLA BLANCA" (header)
 *   - "LOGA 800" (título grande)
 *   - Marco rounded-rect con "LOTE: {lote}"
 *   - "Contenido:  {cantidad}  Kg" (bottom-left)
 *   - Barcode EAN13 (bottom-right)
 *   - "Contenedor nº: N" (bottom-center)
 *   - Sello aniversario circular dinámico (top-right)
 */

export interface EtiquetaL800Datos {
  lote: string;            // ej. "26E269"
  cantidad: number;        // contenido por unidad (ej. 200 para 200 ml, 1 para 1 kg)
  unidad?: string;         // unidad mostrada junto a cantidad: "Kg", "g", "mL", "cL", "L". Default "Kg"
  contenedorText?: string; // texto libre debajo del lote (default "Contenedor nº: 1")
  qrUrl?: string;          // URL al detalle de la orden. Si está → se imprime QR
  añoActual?: number;      // default: año actual
  añoFundacion?: number;   // default: 1958
  /** Título grande (línea principal). Vacío → no se imprime. */
  titulo?: string;
  /** Subtítulo (línea pequeña encima del título). Vacío → no se imprime. */
  subtitulo?: string;
}

const ANCHO_MM = 150;
const ALTO_MM  = 100;
const MM_TO_PT = 72 / 25.4;
const W = ANCHO_MM * MM_TO_PT;  // ~425.2
const H = ALTO_MM  * MM_TO_PT;  // ~283.5

// Genera QR PNG escaneable con bwip-js. Error correction level H (30%)
// permite tapar ~25% del QR con un logo sin que pierda escaneabilidad.
async function generarQrPng(text: string): Promise<Buffer> {
  // `eclevel` no está en los tipos públicos pero es opción válida en runtime.
  const opts = {
    bcid: 'qrcode',
    text,
    scale: 5,
    eclevel: 'H',
    padding: 0,
    backgroundcolor: 'FFFFFF',
  } as Parameters<typeof bwipjs.toBuffer>[0];
  return bwipjs.toBuffer(opts) as unknown as Promise<Buffer>;
}

function dibujarSelloAniversario(
  doc: PDFKit.PDFDocument,
  cx: number, cy: number, r: number,
  añoFundacion: number, añoActual: number,
  logoPath: string,
): void {
  const años = añoActual - añoFundacion;
  doc.save();
  doc.strokeColor('#000').fillColor('#000');

  // Anillo grueso exterior + fino interior (como el original)
  doc.lineWidth(2.8);
  doc.circle(cx, cy, r).stroke();
  doc.lineWidth(0.6);
  doc.circle(cx, cy, r - 3.5).stroke();

  // Texto "1958 - YYYY" arriba — ajustado hacia abajo para mejor balance visual
  doc.fontSize(r * 0.20).font('Helvetica-Bold');
  const topTxt = `${añoFundacion} - ${añoActual}`;
  const topW = doc.widthOfString(topTxt);
  doc.text(topTxt, cx - topW / 2, cy - r * 0.62, { lineBreak: false });

  // Número grande de años — centrado en el círculo (visual center = cy)
  // Helvetica cap-height ≈ 70% size → top-offset = fontSize*0.35
  const numFont = r * 0.80;
  doc.fontSize(numFont).font('Helvetica-Bold');
  const numStr = String(años);
  const numW = doc.widthOfString(numStr);
  doc.text(numStr, cx - numW / 2, cy - numFont * 0.42, { lineBreak: false });

  // "AÑOS" debajo del número — más espaciado
  doc.fontSize(r * 0.23).font('Helvetica-Bold');
  const lblW = doc.widthOfString('AÑOS');
  doc.text('AÑOS', cx - lblW / 2, cy + r * 0.36, { lineBreak: false });

  // Mini logo droplet en el arco inferior
  try {
    const logoSize = r * 0.30;
    doc.image(logoPath, cx - logoSize / 2, cy + r * 0.58, { width: logoSize, height: logoSize });
  } catch { /* sin logo si falla */ }
  doc.restore();
}

export async function buildEtiquetaL800Pdf(datos: EtiquetaL800Datos): Promise<PDFKit.PDFDocument> {
  const año = datos.añoActual ?? new Date().getFullYear();
  const añoFund = datos.añoFundacion ?? 1958;
  const qrText = datos.qrUrl ?? '';
  const titulo = (datos.titulo ?? '').trim();
  const subtitulo = (datos.subtitulo ?? '').trim();
  const contenedorText = (datos.contenedorText ?? 'Contenedor nº: 1').trim();

  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    info: { Title: `Etiqueta L-800 ${datos.lote}`, Author: 'Loga ERP' },
  });

  const logoPath = path.join(__dirname, '..', 'assets', 'logo_loga.png');

  // ── Borde fino del label (look "sticker")
  doc.lineWidth(0.8).strokeColor('#000');
  doc.rect(2, 2, W - 4, H - 4).stroke();

  // ── 1. Logo droplet top-left
  try {
    doc.image(logoPath, 16, 12, { width: 54, height: 54 });
  } catch { /* logo opcional */ }

  // ── 2. Subtítulo (header pequeño) — centrado entre logo y sello aniversario
  if (subtitulo) {
    // Auto-shrink: si no cabe, reducir font hasta 20pt
    let subFont = 28;
    doc.font('Helvetica-Bold');
    while (subFont > 14) {
      doc.fontSize(subFont);
      if (doc.widthOfString(subtitulo) <= 250) break;
      subFont -= 1;
    }
    doc.fontSize(subFont).fillColor('#000');
    doc.text(subtitulo, 80, 30, { width: 250, align: 'center', lineBreak: false });
  }

  // ── 3. Sello aniversario top-right (más grande, claro)
  dibujarSelloAniversario(doc, W - 42, 42, 32, añoFund, año, logoPath);

  // ── 4. Título principal central — auto-shrink para que SIEMPRE quepa
  if (titulo) {
    let titFont = 72;
    doc.font('Helvetica-Bold');
    while (titFont > 30) {
      doc.fontSize(titFont);
      if (doc.widthOfString(titulo) <= W - 40) break;
      titFont -= 2;
    }
    doc.fontSize(titFont).fillColor('#000');
    // Ajuste vertical: si el título es menos alto, sube ligeramente
    const tituloY = 80 + (72 - titFont) * 0.5;
    doc.text(titulo, 0, tituloY, { width: W, align: 'center', lineBreak: false });
  }

  // ── 5. Caja LOTE — subida (gap más generoso debajo para QR+info)
  const boxX = 30;
  const boxY = 152;          // antes 168 — sube 16pt
  const boxW = W - 60;
  const boxH = 56;            // misma altura que antes
  doc.lineWidth(3).roundedRect(boxX, boxY, boxW, boxH, 12).stroke('#000');
  doc.font('Helvetica-Bold').fontSize(36).fillColor('#000');
  doc.text(`LOTE: ${datos.lote}`, boxX, boxY + 12, { width: boxW, align: 'center', lineBreak: false });

  // ── 6. Zona inferior — debajo del LOTE box (que termina en y=208).
  // Layout en 3 columnas:
  //   [Contenido: 650 Kg]   [Contenedor nº: 1]    [QR cuadrado]
  //   ←──── izq ────→       ←─── centro ───→     ←──── der ────→
  const qrSize = 56;
  const qrY = 216;                           // 152(boxY) + 56(boxH) + 8(gap) = 216
  const qrRightMargin = 30;                  // margen visible del QR al borde derecho
  const qrX = W - qrRightMargin - qrSize;    // ~339

  // Línea vertical de la fila (centro del QR)
  const rowCenterY = qrY + qrSize / 2;       // ~244

  // ── Izquierda: Contenido: 650 Kg (o ml, L… según `unidad`)
  doc.font('Helvetica').fontSize(11).fillColor('#000');
  doc.text('Contenido:', 18, rowCenterY - 5, { lineBreak: false });
  const cantStr = String(datos.cantidad).replace(/\.0+$/, '');
  doc.font('Helvetica-Bold').fontSize(30);
  doc.text(cantStr, 75, rowCenterY - 14, { lineBreak: false });
  const cantW = doc.widthOfString(cantStr);
  doc.font('Helvetica-Bold').fontSize(16);
  doc.text(datos.unidad ?? 'Kg', 75 + cantW + 6, rowCenterY - 6, { lineBreak: false });

  // ── Centro: texto libre del contenedor (centrado en columna entre "Kg" y QR)
  const centroX = 180;
  const centroW = qrX - centroX - 8;          // hueco real entre cantidad y QR
  doc.font('Helvetica').fontSize(11).fillColor('#000');
  doc.text(contenedorText, centroX, rowCenterY - 4, { width: centroW, align: 'center', lineBreak: false });
  try {
    const qrPng = await generarQrPng(qrText || 'about:blank');
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

    // Logo Loga centrado encima del QR (ECC H aguanta ~25-30% obstrucción).
    // Tapamos un cuadrado blanco pequeño para que el logo no compita con módulos negros,
    // luego pintamos el logo encima.
    const logoBox = qrSize * 0.30;           // ~17pt → ~29% del QR
    const logoCx = qrX + qrSize / 2;
    const logoCy = qrY + qrSize / 2;
    // Fondo blanco con esquinas suaves
    doc.save();
    doc.fillColor('#fff');
    doc.roundedRect(logoCx - logoBox / 2 - 1, logoCy - logoBox / 2 - 1, logoBox + 2, logoBox + 2, 2).fill();
    // Logo droplet
    doc.image(logoPath, logoCx - logoBox / 2, logoCy - logoBox / 2, { width: logoBox, height: logoBox });
    doc.restore();
  } catch {
    // Fallback texto si bwip-js falla
    doc.font('Helvetica').fontSize(7).fillColor('#999');
    doc.text(qrText.slice(0, 40), qrX, qrY + qrSize / 2, { width: qrSize, align: 'center', lineBreak: false });
  }

  return doc;
}
