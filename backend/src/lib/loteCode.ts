// Generador de códigos de lote en formato YY+L+### (e.g. "26E265").
//   YY  = dos últimos dígitos del año (2026 → "26")
//   L   = letra del mes: A=enero, B=febrero, … L=diciembre
//   ### = secuencia GLOBAL consecutiva (001…999, vuelve a 001 al pasar 999).
//
// La secuencia es GLOBAL — no se resetea por cambio de mes/año, solo cuando
// supera 999. Esto significa que el último número usado en mayo (ej. 26E350)
// continúa en junio como 26F351, etc. Sirve tanto para lotes de materia prima
// como producto terminado; comparten numeración en la tabla lotes (que ya
// tiene UNIQUE en lote_interno).

const MONTH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export function lotePrefix(d: Date = new Date()): string {
  const yy = String(d.getFullYear()).slice(-2);
  const letter = MONTH_LETTERS[d.getMonth()];
  return `${yy}${letter}`;
}

// Calcula el siguiente código libre con secuencia GLOBAL.
// DEBE invocarse dentro de una transacción: usa pg_advisory_xact_lock para
// serializar la generación concurrente y evitar colisiones bajo la UNIQUE.
export async function nextLoteCode(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ max: string | null }> }> },
  d: Date = new Date()
): Promise<string> {
  const prefix = lotePrefix(d);
  // Lock global (no por-prefijo) para serializar la generación entre meses.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`lote:global`]);
  // Buscamos el MAX del SUFIJO numérico en TODA la tabla lotes (cualquier
  // prefijo año+mes). El número se trata como entero — "999" ordena después
  // de "099", etc. Solo consideramos lote_interno con formato YY+L+digits.
  const { rows } = await client.query(
    `SELECT MAX((regexp_match(lote_interno, '^[0-9]{2}[A-L]([0-9]+)$'))[1]::integer) AS max
       FROM lotes
      WHERE lote_interno ~ '^[0-9]{2}[A-L][0-9]+$'`
  );
  let next = (Number(rows[0]?.max) || 0) + 1;
  if (next > 999) next = 1; // wrap a 001 tras 999
  return `${prefix}${String(next).padStart(3, '0')}`;
}
