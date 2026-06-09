import { Truck } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  agencia?: string | null;
  pesoKg?: string | number | null;
  importe?: string | number | null;
  size?: 'sm' | 'md';
}

const LABEL: Record<string, string> = {
  SCHENKER:   'Schenker',
  PALETRAPID: 'Paletrapid',
  PALLETWAYS: 'Palletways',
};

const COLOR: Record<string, string> = {
  SCHENKER:   'bg-orange-100 text-orange-800 border-orange-200',
  PALETRAPID: 'bg-red-100 text-red-800 border-red-200',
  PALLETWAYS: 'bg-blue-100 text-blue-800 border-blue-200',
};

export default function AgenciaBadge({ agencia, pesoKg, importe, size = 'sm' }: Props) {
  if (!agencia) return null;
  const ag = String(agencia).toUpperCase();
  const cls = COLOR[ag] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  const label = LABEL[ag] ?? ag;
  const pesoNum = pesoKg != null ? Number(pesoKg) : null;
  const importeNum = importe != null ? Number(importe) : null;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap',
      cls,
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
    )}>
      <Truck size={size === 'sm' ? 10 : 12} />
      {label}
      {pesoNum != null && pesoNum > 0 && (
        <span className="font-mono opacity-70">· {pesoNum.toFixed(0)} kg</span>
      )}
      {importeNum != null && importeNum > 0 && (
        <span className="font-mono opacity-90">· {importeNum.toFixed(2)} €</span>
      )}
    </span>
  );
}
