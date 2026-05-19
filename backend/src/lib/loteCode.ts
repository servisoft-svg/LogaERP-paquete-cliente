// Generador de códigos de lote en formato YY+L+### (e.g. "26E265").
//   YY  = dos últimos dígitos del año (2026 → "26")
//   L   = letra del mes: A=enero, B=febrero, … L=diciembre
//   ### = secuencia mensual, mínimo 3 dígitos (001…999, sigue creciendo si pasa de 999)
//
// La secuencia es por (año, mes): cada mes empieza desde el siguiente al MAX
// existente en BD con ese mismo prefijo. Sirve tanto para lotes de materia
// prima como para lotes de producto terminado — comparten numeración en la
// tabla lotes (que ya tiene UNIQUE en lote_interno).

const MONTH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export function lotePrefix(d: Date = new Date()): string {
  const yy = String(d.getFullYear()).slice(-2);
  const letter = MONTH_LETTERS[d.getMonth()];
  return `${yy}${letter}`;
}

// Calcula el siguiente código libre para el prefijo del mes actual.
// DEBE invocarse dentro de una transacción: usa pg_advisory_xact_lock para
// serializar la generación concurrente y evitar colisiones bajo la UNIQUE.
export async function nextLoteCode(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ max: string | null }> }> },
  d: Date = new Date()
): Promise<string> {
  const prefix = lotePrefix(d);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`lote:${prefix}`]);
  const { rows } = await client.query(
    `SELECT MAX((regexp_match(lote_interno, '^' || $1 || '([0-9]+)$'))[1]::integer) AS max
       FROM lotes
      WHERE lote_interno ~ ('^' || $1 || '[0-9]+$')`,
    [prefix]
  );
  const next = (Number(rows[0]?.max) || 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}
