// Auto-clasificación de productos tipo `material_embalaje` por nombre.
//
// Objetivo: dejar a CERO los productos sin material/peso. La estimación es
// aproximada — Hacienda exige valores reales — pero serve de base que el
// admin afina luego. Las reglas son deterministas y se basan en patrones
// típicos de fábrica de adhesivos vinílicos:
//
//   bote / bidón / garrafa → Plástico (PE)
//   caja / cartón / kraft  → Cartón
//   palet / tarima         → Madera
//   lata / hojalata        → Metal
//   bote vidrio / cristal  → Vidrio
//   etiqueta / sticker     → Cartón  (no hay "Papel" en catálogo base)
//   tapón / cápsula        → Plástico
//   film / strech          → Plástico
//   saco kraft / papel     → Cartón
//   saco PE / polietileno  → Plástico
//
// El peso vacío se estima a partir de la capacidad detectada en el nombre
// (litros o kg). Si no hay capacidad legible, cae a valores típicos por
// tipo de envase.

export type MaterialDetectado =
  | 'Plástico'
  | 'Cartón'
  | 'Madera'
  | 'Vidrio'
  | 'Metal'
  | 'Otros';

export type EstimacionEmbalaje = {
  material: MaterialDetectado;
  peso_vacio_kg: number;
  // Trazabilidad: qué regla activó la decisión. Útil para revisión humana.
  fuente_material: string;
  fuente_peso: string;
  confianza: 'alta' | 'media' | 'baja';
};

// Quita acentos y baja a minúsculas para regex.
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Detecta capacidad en litros: "5L", "5 l", "5,5L", "1.5 litros".
// Acepta los formatos coma/punto decimal típicos en ES.
function capacidadLitros(n: string): number | null {
  const m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:l|lts?|litros?)\b/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

// Detecta capacidad en kilos: "25kg", "1Kg", "25 kg".
function capacidadKg(n: string): number | null {
  const m = n.match(/(\d+(?:[.,]\d+)?)\s*kg\b/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

// Para "saco 25 kg" el kg es del CONTENIDO, no del saco. Peso del saco vacío
// no se deduce del peso del contenido — usamos defaults razonables.
function pesoEnvasePlastico(capL: number): number {
  // Empírico: peso PE vacío ≈ 30g + 12g por litro.
  //   1 L  →  42 g
  //   5 L  →  90 g
  //   10 L → 150 g
  //   25 L → 330 g
  //  200 L → 2430 g (bidón 200 l)
  // 1000 L → 14.0 kg (IBC carcasa plástico, excluye jaula metálica)
  return Math.max(0.005, 0.03 + 0.012 * capL);
}

function pesoEnvaseMetal(capL: number): number {
  // Lata hojalata vacía ≈ 60 g + 18 g por litro.
  return Math.max(0.02, 0.06 + 0.018 * capL);
}

function pesoEnvaseVidrio(capL: number): number {
  // Vidrio pesa mucho: 200 g + 400 g por litro (frasco/botella).
  return Math.max(0.05, 0.2 + 0.4 * capL);
}

function pesoCajaCarton(capL: number | null): number {
  // Caja cartón ondulado ≈ 25 g por litro útil. Si no hay litros, default 300 g.
  return capL && capL > 0 ? Math.max(0.05, 0.025 * capL) : 0.3;
}

export function estimarEmbalaje(nombre: string): EstimacionEmbalaje {
  const n = normalizar(nombre);
  const capL = capacidadLitros(n);
  const capKg = capacidadKg(n);

  // ── 1. VIDRIO (prioridad alta — fácil identificar) ──────────────────────
  if (/\bvidrio\b|\bcristal\b/.test(n)) {
    const peso = pesoEnvaseVidrio(capL ?? 0.25);
    return {
      material: 'Vidrio',
      peso_vacio_kg: peso,
      fuente_material: 'palabra "vidrio/cristal"',
      fuente_peso: capL ? `${capL} L × 0.4 + 0.2 kg` : 'default 250 ml',
      confianza: capL ? 'alta' : 'media',
    };
  }

  // ── 2. MADERA ───────────────────────────────────────────────────────────
  if (/\bpalet\b|\bpalets?\b|\beuropalet\b|\btarima\b|\bmader/.test(n)) {
    const esEuropalet = /europalet/.test(n);
    const peso = esEuropalet ? 22 : /palet/.test(n) ? 25 : 5; // tarima genérica
    return {
      material: 'Madera',
      peso_vacio_kg: peso,
      fuente_material: 'palabra "palet/madera/tarima"',
      fuente_peso: esEuropalet ? 'europalet 22 kg' : '/palet/ → 25 kg',
      confianza: 'alta',
    };
  }

  // ── 3. METAL (latas y bidones metálicos) ───────────────────────────────
  if (/\blata\b|\bhojalata\b|\baluminio\b|\bacero\b|\bmetalic/.test(n)) {
    const peso = pesoEnvaseMetal(capL ?? 1);
    return {
      material: 'Metal',
      peso_vacio_kg: peso,
      fuente_material: 'palabra "lata/hojalata/metal"',
      fuente_peso: capL ? `${capL} L × 0.018 + 0.06 kg` : 'default 1 L',
      confianza: capL ? 'alta' : 'media',
    };
  }

  // ── 4. CARTÓN / PAPEL ───────────────────────────────────────────────────
  // Cuidado: "caja" sin más puede ser plástico. Sólo damos cartón si:
  //   - aparece explícito "cartón"
  //   - aparece "caja" sin negación
  //   - aparece "kraft" o "saco papel"
  //   - es etiqueta / sticker / pegatina (papel adhesivo)
  if (/\bcarton\b|\bkraft\b|\bsaco\s+(?:de\s+)?papel\b|\bpapel\b/.test(n)) {
    const peso = pesoCajaCarton(capL);
    return {
      material: 'Cartón',
      peso_vacio_kg: peso,
      fuente_material: 'palabra "cartón/kraft/papel"',
      fuente_peso: capL ? `${capL} L × 0.025 kg` : 'default 300 g',
      confianza: 'media',
    };
  }
  if (/\bcaja\b/.test(n) && !/\bplast/.test(n)) {
    return {
      material: 'Cartón',
      peso_vacio_kg: pesoCajaCarton(capL),
      fuente_material: '"caja" sin marcador plástico → Cartón',
      fuente_peso: capL ? `${capL} L × 0.025 kg` : 'default 300 g',
      confianza: 'media',
    };
  }
  if (/\betiqueta\b|\bsticker\b|\bpegatina\b/.test(n)) {
    return {
      material: 'Cartón',
      peso_vacio_kg: 0.002,
      fuente_material: 'etiqueta → Cartón (papel adhesivo)',
      fuente_peso: 'default 2 g/uds',
      confianza: 'media',
    };
  }

  // ── 5. PLÁSTICO (catch-all para envases típicos cola blanca) ───────────
  // bote, bidón, garrafa, IBC, saco PE, film, granza, polietileno, PE, PP, PET
  if (/\bbidon\b|\bbote\b|\bgarrafa\b|\bibc\b|\bcuneta\b|\bcubo\b/.test(n)
      || /\bpolietileno\b|\bpolipropileno\b|\bpvc\b|\bpe\b|\bpp\b|\bpet\b/.test(n)) {
    const peso = pesoEnvasePlastico(capL ?? capKg ?? 1);
    return {
      material: 'Plástico',
      peso_vacio_kg: peso,
      fuente_material: 'palabra envase plástico (bote/bidón/garrafa/IBC)',
      fuente_peso: capL ? `${capL} L × 0.012 + 0.03 kg`
        : capKg ? `${capKg} kg × 0.012 + 0.03 kg`
        : 'default 1 L',
      confianza: capL || capKg ? 'alta' : 'baja',
    };
  }
  if (/\btapon\b|\bcapsula\b|\btapa\b/.test(n)) {
    return {
      material: 'Plástico',
      peso_vacio_kg: 0.008,
      fuente_material: 'tapón/cápsula/tapa → Plástico',
      fuente_peso: 'default 8 g',
      confianza: 'media',
    };
  }
  if (/\bfilm\b|\bstretch\b|\bretractil\b|\bplastico\b|\bpolietilen/.test(n)) {
    return {
      material: 'Plástico',
      peso_vacio_kg: 0.05,
      fuente_material: 'film/stretch/plástico',
      fuente_peso: 'default 50 g',
      confianza: 'baja',
    };
  }
  if (/\bsaco\b/.test(n)) {
    // Saco sin marcador → asumimos PE (más común en industria química).
    return {
      material: 'Plástico',
      peso_vacio_kg: 0.04,
      fuente_material: 'saco genérico → Plástico (PE)',
      fuente_peso: 'default 40 g',
      confianza: 'baja',
    };
  }

  // ── 6. SIN MATCH → Otros con peso simbólico ─────────────────────────────
  return {
    material: 'Otros',
    peso_vacio_kg: 0,
    fuente_material: 'sin coincidencia',
    fuente_peso: 'requiere asignación manual',
    confianza: 'baja',
  };
}
