// CP español (5 dígitos) → provincia + zona porte.
// Los dos primeros dígitos del CP identifican la provincia.

const CP_PROVINCIAS: Record<string, string> = {
  '01': 'Álava',           '02': 'Albacete',        '03': 'Alicante',
  '04': 'Almería',         '05': 'Ávila',           '06': 'Badajoz',
  '07': 'Baleares',        '08': 'Barcelona',       '09': 'Burgos',
  '10': 'Cáceres',         '11': 'Cádiz',           '12': 'Castellón',
  '13': 'Ciudad Real',     '14': 'Córdoba',         '15': 'A Coruña',
  '16': 'Cuenca',          '17': 'Girona',          '18': 'Granada',
  '19': 'Guadalajara',     '20': 'Guipúzcoa',       '21': 'Huelva',
  '22': 'Huesca',          '23': 'Jaén',            '24': 'León',
  '25': 'Lleida',          '26': 'La Rioja',        '27': 'Lugo',
  '28': 'Madrid',          '29': 'Málaga',          '30': 'Murcia',
  '31': 'Navarra',         '32': 'Ourense',         '33': 'Asturias',
  '34': 'Palencia',        '35': 'Las Palmas',      '36': 'Pontevedra',
  '37': 'Salamanca',       '38': 'Santa Cruz de Tenerife',
  '39': 'Cantabria',       '40': 'Segovia',         '41': 'Sevilla',
  '42': 'Soria',           '43': 'Tarragona',       '44': 'Teruel',
  '45': 'Toledo',          '46': 'Valencia',        '47': 'Valladolid',
  '48': 'Vizcaya',         '49': 'Zamora',          '50': 'Zaragoza',
  '51': 'Ceuta',           '52': 'Melilla',
};

// Zona porte agrupada (orientativa, ajustable):
//   peninsula  → estándar
//   baleares   → marítimo balear
//   canarias   → marítimo canario
//   ceuta_mel  → especial Ceuta/Melilla
export type ZonaPorte = 'peninsula' | 'baleares' | 'canarias' | 'ceuta_mel';

export function cpAProvincia(cp?: string | null): string | null {
  if (!cp) return null;
  const m = cp.trim().match(/^(\d{2})\d{3}$/);
  if (!m) return null;
  return CP_PROVINCIAS[m[1]] ?? null;
}

export function cpAZona(cp?: string | null): ZonaPorte | null {
  if (!cp) return null;
  const m = cp.trim().match(/^(\d{2})\d{3}$/);
  if (!m) return null;
  const p = m[1];
  if (p === '07') return 'baleares';
  if (p === '35' || p === '38') return 'canarias';
  if (p === '51' || p === '52') return 'ceuta_mel';
  return 'peninsula';
}

export const ZONA_LABEL: Record<ZonaPorte, string> = {
  peninsula: 'Península',
  baleares:  'Baleares',
  canarias:  'Canarias',
  ceuta_mel: 'Ceuta/Melilla',
};
