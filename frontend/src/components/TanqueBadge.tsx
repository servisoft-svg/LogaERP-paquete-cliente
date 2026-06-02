/**
 * TanqueBadge — etiqueta visual del tanque físico (1-4).
 * Cada tanque tiene un color distinto para que se distingan de un vistazo en
 * recetas, lotes y selección FEFO. Devuelve null si no hay tanque asignado.
 */
import clsx from 'clsx';

const COLORES: Record<number, { bg: string; text: string; border: string; ring: string }> = {
  1: { bg: 'bg-red-600',     text: 'text-white', border: 'border-red-700',     ring: 'ring-red-200' },
  2: { bg: 'bg-blue-600',    text: 'text-white', border: 'border-blue-700',    ring: 'ring-blue-200' },
  3: { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-700', ring: 'ring-emerald-200' },
  4: { bg: 'bg-amber-500',   text: 'text-white', border: 'border-amber-600',   ring: 'ring-amber-200' },
};

export const TANQUE_COLORES = COLORES;

type Size = 'xs' | 'sm' | 'md';

interface Props {
  tanque: number | null | undefined;
  size?: Size;
  /** Si true, sólo muestra el número; si false (default), "T1". */
  numberOnly?: boolean;
  className?: string;
}

const SIZE_CLS: Record<Size, string> = {
  xs: 'px-1 py-0 text-[9px] min-w-[18px] h-[14px] rounded-sm',
  sm: 'px-1.5 py-0.5 text-[10px] min-w-[22px] h-[18px] rounded',
  md: 'px-2 py-0.5 text-xs min-w-[28px] h-[22px] rounded-md',
};

export default function TanqueBadge({ tanque, size = 'sm', numberOnly = false, className }: Props) {
  if (!tanque) return null;
  const c = COLORES[tanque] ?? COLORES[1];
  return (
    <span
      title={`Tanque ${tanque}`}
      className={clsx(
        'inline-flex items-center justify-center font-black leading-none tabular-nums shrink-0',
        'shadow-sm ring-1',
        c.bg, c.text, c.ring,
        SIZE_CLS[size],
        className,
      )}
    >
      {numberOnly ? tanque : `T${tanque}`}
    </span>
  );
}
