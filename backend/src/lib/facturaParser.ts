/**
 * Parser de facturas / albaranes — extrae datos relevantes para Añadir Stock en Loga.
 *
 * Flujo:
 *   1. PDF digital → pdf-parse (texto perfecto, instantáneo).
 *   2. PDF escaneado / imagen → Tesseract.js (OCR español, lento ~5-15s).
 *   3. Texto crudo → regex heurísticas en español.
 *
 * Sin API key, 100% local.
 */

import { readFile } from 'fs/promises';
import pdfParseDefault from 'pdf-parse';
// Tesseract y pdfjs-dist se cargan perezosos (pesan en runtime).

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────
export type Confianza = 'alta' | 'media' | 'baja' | 'calculada';

export interface CampoExtraido<T = string | number> {
  valor: T | null;
  confianza: Confianza;
  fuente?: string; // qué patrón/regex acertó (debug)
}

export interface FacturaExtraida {
  // Identificación
  factura_num:    CampoExtraido<string>;
  albaran_ref:    CampoExtraido<string>;
  fecha:          CampoExtraido<string>; // YYYY-MM-DD

  // Proveedor
  proveedor_nombre: CampoExtraido<string>;
  proveedor_cif:    CampoExtraido<string>;

  // Líneas / cantidad
  cantidad:       CampoExtraido<number>;
  unidad:         CampoExtraido<string>; // kg, L, ud...
  precio_unitario:CampoExtraido<number>;
  divisa:         CampoExtraido<string>; // EUR, USD, CNY...
  unidad_precio:  CampoExtraido<string>; // kg, L, ud (precio por X)

  // Totales
  total_sin_iva:  CampoExtraido<number>;
  iva_pct:        CampoExtraido<number>;
  total_con_iva:  CampoExtraido<number>;
  porte:          CampoExtraido<number>;

  // Meta
  texto_crudo:    string; // texto completo para debug / regex en frontend
  metodo:         'pdf-text' | 'ocr';
}

// ──────────────────────────────────────────────────────────────────────────
// Utilidades numéricas
// ──────────────────────────────────────────────────────────────────────────
function parseNum(s: string | undefined | null): number | null {
  if (!s) return null;
  // "1.234,56" → "1234.56"  /  "1,234.56" → "1234.56"  /  "12,5" → "12.5"
  let t = s.trim().replace(/[^\d,.\-]/g, '');
  if (t === '') return null;
  const hasComma = t.includes(',');
  const hasDot = t.includes('.');
  if (hasComma && hasDot) {
    // El que aparece más a la derecha es el decimal
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) {
      t = t.replace(/\./g, '').replace(',', '.');
    } else {
      t = t.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Si hay varias comas → miles. Si solo una y con 1-2 decimales → decimal.
    const parts = t.split(',');
    if (parts.length === 2 && parts[1].length <= 2) t = parts[0] + '.' + parts[1];
    else t = t.replace(/,/g, '');
  }
  const n = Number(t);
  return isNaN(n) ? null : n;
}

function detectarDivisa(texto: string): string {
  if (/\bEUR\b|€/.test(texto)) return 'EUR';
  if (/\bUSD\b|\$\s*\d/.test(texto)) return 'USD';
  if (/\bCNY\b|RMB|￥/.test(texto)) return 'CNY';
  if (/\bGBP\b|£/.test(texto)) return 'GBP';
  if (/\bJPY\b/.test(texto)) return 'JPY';
  if (/\bCHF\b/.test(texto)) return 'CHF';
  return 'EUR'; // default España
}

// ──────────────────────────────────────────────────────────────────────────
// Regex helpers — buscan después de una "etiqueta" típica
// ──────────────────────────────────────────────────────────────────────────
function buscarEtiqueta(texto: string, etiquetas: RegExp[], patronValor: RegExp): RegExpMatchArray | null {
  // Permite hasta 30 chars entre etiqueta y valor (espacios, ":", "-", "Nº", "número", etc.)
  // ej: "Albarán Nº: ABC" / "Factura número - 123" / "Total IVA incluido: 100,00"
  const sep = '[\\s:\\-]*(?:n[\\u00ba\\u00b0o]?\\.?|num\\.?|number)?[\\s:\\-]*';
  for (const et of etiquetas) {
    const m = texto.match(new RegExp(et.source + sep + patronValor.source, 'i'));
    if (m) return m;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Extracción de texto del PDF (digital primero, OCR fallback)
// ──────────────────────────────────────────────────────────────────────────
async function extraerTextoConPdfJs(buffer: Buffer): Promise<string> {
  // pdfjs-dist v4 es ESM puro y necesita el legacy build para Node.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ');
    out += pageText + '\n';
  }
  return out.trim();
}

async function extraerTextoPDF(buffer: Buffer): Promise<{ texto: string; metodo: 'pdf-text' | 'ocr' }> {
  // 1) Intentar pdf-parse (rápido, simple)
  try {
    const data = await pdfParseDefault(buffer);
    const texto = (data.text ?? '').trim();
    if (texto.length >= 40) return { texto, metodo: 'pdf-text' };
  } catch { /* fallthrough */ }

  // 2) Intentar pdfjs-dist (más robusto con PDFs no-estándar)
  try {
    const texto = await extraerTextoConPdfJs(buffer);
    if (texto.length >= 40) return { texto, metodo: 'pdf-text' };
  } catch { /* fallthrough → OCR */ }

  // 3) Fallback OCR — Tesseract con imagen renderizada del PDF
  // Tesseract NO lee PDF directo. Solo viable si el "PDF" fuese una imagen
  // dentro de PDF. Para PDFs escaneados reales, devolvemos texto vacío y el
  // usuario debe meter datos a mano (la mayoría de facturas digitales B2B
  // funcionan con pdf-parse o pdfjs).
  return { texto: '', metodo: 'ocr' };
}

async function extraerTextoImagen(buffer: Buffer): Promise<{ texto: string; metodo: 'ocr' }> {
  const Tesseract = (await import('tesseract.js')).default;
  const { data: { text } } = await Tesseract.recognize(buffer, 'spa');
  return { texto: text ?? '', metodo: 'ocr' };
}

// ──────────────────────────────────────────────────────────────────────────
// Parser principal — aplica todas las regex sobre texto
// ──────────────────────────────────────────────────────────────────────────
export function parsearTextoFactura(texto: string): Omit<FacturaExtraida, 'texto_crudo' | 'metodo'> {
  const t = texto;
  // Versión aplanada (newlines → espacios) para PDFs con layout columnar.
  // Muchas facturas españolas ponen etiquetas en una columna y valores en otra:
  //   "Factura:\n2021-018"  o  "1\nunidad\n1.000,00\n21%\n1.000,00"
  // Tras aplanar quedan en línea ampliable por regex.
  const tFlat = texto.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ');

  // ── Factura nº
  // Busca tras "factura/fra/invoice" un código que parezca número de factura.
  // Formatos típicos: "2021-018", "F-2025-1234", "INV-001", "FAC2024001".
  // Permite hasta 80 chars de texto intermedio (otras etiquetas en columna).
  let factura_num_valor: string | null = null;
  const facturaRe = /(?:factura|fra\.?|invoice).{0,80}?([A-Z]{0,5}\d{2,5}[-\/]\d{1,6}(?:[-\/]\d{1,4})?|[A-Z]{2,5}\d{4,10})/gi;
  let fm: RegExpExecArray | null;
  while ((fm = facturaRe.exec(tFlat)) !== null) {
    const v = fm[1];
    // Descartar fechas (DD-MM-YYYY) que matchean el patrón
    if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/.test(v)) continue;
    factura_num_valor = v;
    break;
  }
  const factura_num: CampoExtraido<string> = factura_num_valor
    ? { valor: factura_num_valor, confianza: 'media', fuente: 'etiqueta factura' }
    : { valor: null, confianza: 'baja' };

  // ── Albarán nº
  const albaranM = buscarEtiqueta(
    t,
    [/alba[rl][aá]n/, /delivery\s*note/],
    /([A-Z0-9][\w\-\/\.]{2,25})/,
  );
  const albaran_ref: CampoExtraido<string> = albaranM
    ? { valor: albaranM[1], confianza: 'alta', fuente: 'etiqueta albarán' }
    : { valor: null, confianza: 'baja' };

  // ── Fecha
  let fechaIso: string | null = null;
  const fechaM = t.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/);
  if (fechaM) {
    let [, d, m, y] = fechaM;
    if (y.length === 2) y = '20' + y;
    fechaIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const fecha: CampoExtraido<string> = fechaIso
    ? { valor: fechaIso, confianza: 'media' }
    : { valor: null, confianza: 'baja' };

  // ── CIF/NIF (España)
  const cifM = t.match(/\b([A-HJNPQRSUVW]\d{7}[0-9A-J])\b/);
  const nifM = t.match(/\b(\d{8}[A-Z])\b/);
  const proveedor_cif: CampoExtraido<string> = cifM
    ? { valor: cifM[1], confianza: 'alta', fuente: 'CIF español' }
    : nifM
    ? { valor: nifM[1], confianza: 'media', fuente: 'NIF español' }
    : { valor: null, confianza: 'baja' };

  // ── Nombre proveedor: heurística → primera línea no vacía con letras + (S.L.|S.A.|S.L.U|SL|SA)
  let nombre: string | null = null;
  const lineas = t.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  for (const l of lineas.slice(0, 15)) {
    if (/\b(S\.?L\.?(U\.?)?|S\.?A\.?(U\.?)?|S\.?C\.?L\.?|LTD|LIMITED|CO\.?\s*LTD|GMBH|INC\.?)\b/i.test(l)) {
      // Limpiar líneas con demasiados números (suelen ser direcciones/CIFs)
      const numChars = (l.match(/\d/g) ?? []).length;
      if (numChars < l.length / 3) {
        nombre = l.replace(/\s{2,}/g, ' ').slice(0, 80);
        break;
      }
    }
  }
  // Fallback: primera línea con >5 letras y pocos dígitos
  if (!nombre) {
    for (const l of lineas.slice(0, 8)) {
      if (l.length >= 5 && l.length <= 80 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{5,}/.test(l)) {
        const numChars = (l.match(/\d/g) ?? []).length;
        if (numChars < 3) { nombre = l; break; }
      }
    }
  }
  const proveedor_nombre: CampoExtraido<string> = nombre
    ? { valor: nombre, confianza: cifM ? 'media' : 'baja' }
    : { valor: null, confianza: 'baja' };

  // ── Divisa
  const divisa: CampoExtraido<string> = {
    valor: detectarDivisa(t),
    confianza: /\b(EUR|USD|CNY|GBP|JPY|CHF)\b/.test(t) ? 'alta' : 'media',
  };

  // ── IVA %
  const ivaM = t.match(/iva[\s:]*\(?\s*(\d{1,2})(?:[,.]\d+)?\s*%?\s*\)?/i)
            ?? t.match(/\b(\d{1,2})\s*%\s*iva/i);
  const ivaPct = ivaM ? Number(ivaM[1]) : null;
  const iva_pct: CampoExtraido<number> = ivaPct != null && ivaPct >= 0 && ivaPct <= 30
    ? { valor: ivaPct, confianza: 'alta' }
    : { valor: 21, confianza: 'baja', fuente: 'default España' };

  // Patrón de monto con decimales: "1.000,00" / "1,000.00" / "1000,00" / "1000.00"
  // Exige los 2 decimales finales para evitar capturar números sueltos.
  const MONTO_RE = '([0-9]{1,3}(?:[.,\\s][0-9]{3})*[.,][0-9]{2}|[0-9]+[.,][0-9]{2})';

  // Helper: busca el primer número decimal cercano a una etiqueta. `gap` permite
  // texto intermedio (incluye letras → tolera "Subtotal sin IVA 21% 1.000,00").
  const buscarMonto = (etiqueta: RegExp, gap = 80): number | null => {
    const re = new RegExp(etiqueta.source + `.{0,${gap}}?` + MONTO_RE, 'i');
    const m = tFlat.match(re);
    return m ? parseNum(m[1]) : null;
  };
  // Variante: TODAS las apariciones, devuelve la última.
  const buscarMontoUltimo = (etiqueta: RegExp, gap = 80): number | null => {
    const re = new RegExp(etiqueta.source + `.{0,${gap}}?` + MONTO_RE, 'gi');
    let last: number | null = null;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(tFlat)) !== null) {
      const n = parseNum(mm[1]);
      if (n != null && n > 0) last = n;
    }
    return last;
  };
  // Variante: el MAYOR número en ventana tras la etiqueta. Útil cuando hay
  // múltiples cifras juntas ("Importe a pagar (EUR) 0,00 1.210,00") y queremos
  // el total real, no un pago parcial.
  const buscarMontoMayor = (etiqueta: RegExp, gap = 100): number | null => {
    const re0 = new RegExp(etiqueta.source, 'gi');
    let best: number | null = null;
    let lm: RegExpExecArray | null;
    while ((lm = re0.exec(tFlat)) !== null) {
      const start = lm.index + lm[0].length;
      const window = tFlat.slice(start, start + gap);
      const re = new RegExp(MONTO_RE, 'g');
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(window)) !== null) {
        const n = parseNum(mm[1]);
        if (n != null && n > 0 && (best == null || n > best)) best = n;
      }
    }
    return best;
  };

  // ── Total sin IVA / Base imponible
  const baseValor = buscarMonto(/base\s*imponible/i)
    ?? buscarMonto(/subtotal(?:\s*sin\s*[a-z]+)?/i)
    ?? buscarMonto(/total\s*sin\s*iva/i)
    ?? buscarMonto(/importe\s*neto/i);
  const total_sin_iva: CampoExtraido<number> = {
    valor: baseValor,
    confianza: baseValor != null ? 'alta' : 'baja',
    fuente: baseValor != null ? 'subtotal/base imponible' : undefined,
  };

  // ── Total con IVA
  // "Importe a pagar" suele ser el más fiable porque aparece al final.
  // Usa "mayor en ventana" para gestionar "Importe a pagar 0,00 1.210,00".
  const totalCon = buscarMontoMayor(/importe\s*a\s*pagar/i)
    ?? buscarMontoMayor(/\btotal\b(?!\s*sin)/i);
  const total_con_iva: CampoExtraido<number> = totalCon != null
    ? { valor: totalCon, confianza: 'media', fuente: 'importe a pagar / último total' }
    : { valor: null, confianza: 'baja' };

  // ── Portes / Transporte (word boundary para no confundir con "Importe")
  const porteVal = buscarMonto(/\bportes?\b/i, 30)
    ?? buscarMonto(/\btransporte\b/i, 30)
    ?? buscarMonto(/\benv[ií]o\b/i, 30)
    ?? buscarMonto(/\bshipping\b/i, 30)
    ?? buscarMonto(/\bfreight\b/i, 30);
  const porte: CampoExtraido<number> = porteVal != null
    ? { valor: porteVal, confianza: 'alta' }
    : { valor: 0, confianza: 'baja', fuente: 'sin línea de porte' };

  // ── Líneas de producto: dos estrategias
  //   1. Patrón explícito: "100 a 3,20" / "100 kg x 3,20" / "200 ud × 0,45"
  //   2. Línea con cantidad+unidad y siguiente número con decimales = precio
  let cantidad: number | null = null;
  let unidadDetectada: string | null = null;
  let precio_ud: number | null = null;
  let precio_conf: Confianza = 'baja';

  const mapUnidad = (u: string): string | null => {
    const x = u.toLowerCase();
    if (x.startsWith('kg') || x.startsWith('kilo')) return 'kg';
    if (x === 'l' || x.startsWith('l.') || x.startsWith('litr')) return 'L';
    // Acepta: ud, uds, unidad, unidades
    if (x.startsWith('ud') || x.startsWith('unid')) return 'ud';
    if (x === 'g' || x.startsWith('gr')) return 'g';
    if (x.startsWith('m')) return 'm';
    return null;
  };

  // Estrategia 1 — separador explícito
  const UNIT_RE = '(?:kg|kilos?|l\\.?|litros?|ud\\.?|uds\\.?|unidad(?:es)?|g\\b|gr\\.?|gramos?|m[²2]?|metros?)';
  const explicitRe = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RE})?\\s*(?:a|@|x|×|por)\\s*([0-9]+[.,][0-9]+)`, 'i');
  const linM = t.match(explicitRe);
  if (linM) {
    cantidad = parseNum(linM[1]);
    unidadDetectada = mapUnidad(linM[2] ?? '');
    precio_ud = parseNum(linM[3]);
    precio_conf = 'alta';
  }

  // Estrategia 2 (tFlat) — patrón "cantidad unidad precio" en texto aplanado.
  // Útil para PDFs con tabla en columnas separadas por newlines.
  if (cantidad == null || precio_ud == null) {
    const flatRe = new RegExp(`(?:^|[\\s,;])(\\d+(?:[.,]\\d+)?)\\s+(${UNIT_RE})\\s+([0-9]+(?:\\.\\d{3})*[.,]\\d{2})`, 'i');
    const fm2 = tFlat.match(flatRe);
    if (fm2) {
      const c = parseNum(fm2[1]);
      const p = parseNum(fm2[3]);
      if (c != null && c > 0 && p != null && p > 0) {
        cantidad = c;
        unidadDetectada = mapUnidad(fm2[2]);
        precio_ud = p;
        precio_conf = 'alta';
      }
    }
  }

  // Estrategia 3 — buscar línea por línea (no aplanado)
  if (cantidad == null || precio_ud == null) {
    const lineRe = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s+(${UNIT_RE})\\b(.*)`, 'i');
    for (const linea of lineas) {
      const m = linea.match(lineRe);
      if (!m) continue;
      const c = parseNum(m[1]);
      if (c == null || c <= 0) continue;
      const u = mapUnidad(m[2]);
      // En el resto de la línea, buscar el primer número con decimales (precio)
      const rest = m[3];
      const numMatch = rest.match(/([0-9]+[.,][0-9]+)/);
      if (numMatch) {
        const p = parseNum(numMatch[1]);
        if (p != null && p > 0 && p < 100000) {
          cantidad = c;
          unidadDetectada = u;
          precio_ud = p;
          precio_conf = 'alta';
          break;
        }
      }
      // Aunque no haya precio en la línea, capturar cantidad+unidad
      if (cantidad == null) {
        cantidad = c;
        unidadDetectada = u;
      }
    }
  }

  // Si NO se ha encontrado precio_unitario pero sí cantidad y total_sin_iva:
  //   precio_ud = (total_sin_iva - porte) / cantidad
  if (precio_ud == null && cantidad != null && cantidad > 0 && total_sin_iva.valor != null) {
    const base = total_sin_iva.valor - (porte.valor ?? 0);
    if (base > 0) {
      precio_ud = base / cantidad;
      precio_conf = 'calculada';
    }
  }

  // Si tampoco hay cantidad detectada pero hay total y unidad esperada del producto:
  // dejamos cantidad null para que el usuario la meta.

  const cantidadCampo: CampoExtraido<number> = {
    valor: cantidad,
    confianza: cantidad != null ? 'alta' : 'baja',
  };
  const unidadCampo: CampoExtraido<string> = {
    valor: unidadDetectada,
    confianza: unidadDetectada ? 'alta' : 'baja',
  };
  const precioCampo: CampoExtraido<number> = {
    valor: precio_ud,
    confianza: precio_conf,
    fuente: precio_conf === 'calculada' ? '(total_sin_iva - porte) / cantidad' : undefined,
  };
  const unidadPrecioCampo: CampoExtraido<string> = {
    valor: unidadDetectada,
    confianza: unidadDetectada ? 'alta' : 'baja',
  };

  return {
    factura_num,
    albaran_ref,
    fecha,
    proveedor_nombre,
    proveedor_cif,
    cantidad: cantidadCampo,
    unidad: unidadCampo,
    precio_unitario: precioCampo,
    divisa,
    unidad_precio: unidadPrecioCampo,
    total_sin_iva,
    iva_pct,
    total_con_iva,
    porte,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Punto de entrada principal
// ──────────────────────────────────────────────────────────────────────────
export async function extraerFactura(filepath: string, mimetype: string): Promise<FacturaExtraida> {
  const buffer = await readFile(filepath);
  let texto = '';
  let metodo: 'pdf-text' | 'ocr' = 'pdf-text';

  if (mimetype === 'application/pdf') {
    const r = await extraerTextoPDF(buffer);
    texto = r.texto; metodo = r.metodo;
  } else if (mimetype.startsWith('image/')) {
    const r = await extraerTextoImagen(buffer);
    texto = r.texto; metodo = r.metodo;
  } else {
    throw new Error('Formato no soportado. Sube un PDF o imagen.');
  }

  const campos = parsearTextoFactura(texto);
  return { ...campos, texto_crudo: texto, metodo };
}
