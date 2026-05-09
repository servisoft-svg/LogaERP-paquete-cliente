/**
 * Calculadora táctil para recuento de inventario.
 * - Botones grandes (≥56px) para usar con guantes en planta.
 * - Memoria acumulativa (M+, MR, MC) para sumar mientras caminas con la tablet.
 * - Botón "Enviar al lote activo" que rellena el campo en el listado.
 * - Soporte teclado físico (números, +,-,*,/,=, Enter, Backspace, Esc).
 *
 * Diseño inspirado en calculadoras táctiles industriales:
 *   display superior grande, botones cuadrados con feedback de pulsación,
 *   colores sutiles (rojo solo en accion final).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, RotateCcw, History } from 'lucide-react';
import clsx from 'clsx';

type Op = '+' | '-' | '*' | '/' | null;

interface Props {
  /** Lote actualmente seleccionado en el listado. Si null, el botón Enviar queda deshabilitado */
  loteActivo: { lote_interno: string; producto_nombre: string; unidad: string } | null;
  /** Llama esto cuando el usuario pulse "Enviar". Recibe el valor numérico actual */
  onEnviar: (valor: number) => void;
}

export default function CalculadoraRecuento({ loteActivo, onEnviar }: Props) {
  const [display, setDisplay] = useState('0');
  const [acumulador, setAcumulador] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [esperandoOperando, setEsperandoOperando] = useState(false);
  const [memoria, setMemoria] = useState<number | null>(null);
  const [historial, setHistorial] = useState<string[]>([]);
  const [showHistorial, setShowHistorial] = useState(false);
  const [pulsando, setPulsando] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Lógica core ──────────────────────────────────────────────
  const meterDigito = useCallback((d: string) => {
    if (esperandoOperando) {
      setDisplay(d === '.' ? '0.' : d);
      setEsperandoOperando(false);
    } else if (d === '.' && display.includes('.')) {
      // ignora segundo punto
    } else {
      setDisplay(display === '0' && d !== '.' ? d : display + d);
    }
  }, [display, esperandoOperando]);

  const aplicarOp = useCallback((nuevaOp: Op) => {
    const valor = parseFloat(display);
    if (acumulador === null) {
      setAcumulador(valor);
    } else if (op) {
      const resultado = calcular(acumulador, valor, op);
      setAcumulador(resultado);
      setDisplay(formatear(resultado));
      setHistorial(h => [`${formatear(acumulador)} ${op} ${formatear(valor)} = ${formatear(resultado)}`, ...h.slice(0, 9)]);
    }
    setOp(nuevaOp);
    setEsperandoOperando(true);
  }, [acumulador, op, display]);

  const calcular = (a: number, b: number, operador: Op): number => {
    switch (operador) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? NaN : a / b;
      default:  return b;
    }
  };

  const igualar = useCallback(() => {
    const valor = parseFloat(display);
    if (acumulador !== null && op) {
      const resultado = calcular(acumulador, valor, op);
      setHistorial(h => [`${formatear(acumulador)} ${op} ${formatear(valor)} = ${formatear(resultado)}`, ...h.slice(0, 9)]);
      setDisplay(formatear(resultado));
      setAcumulador(null);
      setOp(null);
      setEsperandoOperando(true);
    }
  }, [acumulador, op, display]);

  const limpiar = useCallback(() => {
    setDisplay('0');
    setAcumulador(null);
    setOp(null);
    setEsperandoOperando(false);
  }, []);

  const borrar = useCallback(() => {
    if (esperandoOperando) return;
    setDisplay(d => d.length === 1 ? '0' : d.slice(0, -1));
  }, [esperandoOperando]);

  const cambiarSigno = useCallback(() => {
    setDisplay(d => d.startsWith('-') ? d.slice(1) : (d === '0' ? d : '-' + d));
  }, []);

  // ── Memoria: acumular sumando o restando del valor actual ──
  const memoriaAdd = () => {
    const v = parseFloat(display);
    if (!isNaN(v)) setMemoria((memoria ?? 0) + v);
  };
  const memoriaSub = () => {
    const v = parseFloat(display);
    if (!isNaN(v)) setMemoria((memoria ?? 0) - v);
  };
  const memoriaRecall = () => {
    if (memoria !== null) {
      setDisplay(formatear(memoria));
      setEsperandoOperando(true);
    }
  };
  const memoriaClear = () => setMemoria(null);

  const enviarAlLote = () => {
    const v = parseFloat(display);
    if (!isNaN(v) && loteActivo) onEnviar(v);
  };

  // ── Soporte teclado físico ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // No interceptar si hay un input/textarea activo (deja que el usuario teclee normalmente).
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (/[0-9]/.test(e.key)) { meterDigito(e.key); flash(e.key); }
      else if (e.key === '.' || e.key === ',') { meterDigito('.'); flash('.'); }
      else if (e.key === '+') { aplicarOp('+'); flash('+'); }
      else if (e.key === '-') { aplicarOp('-'); flash('-'); }
      else if (e.key === '*' || e.key === 'x') { aplicarOp('*'); flash('*'); }
      else if (e.key === '/') { e.preventDefault(); aplicarOp('/'); flash('/'); }
      else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); igualar(); flash('='); }
      else if (e.key === 'Backspace') { borrar(); flash('⌫'); }
      else if (e.key === 'Escape') { limpiar(); flash('AC'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [meterDigito, aplicarOp, igualar, borrar, limpiar]);

  // Feedback visual al pulsar tecla física
  const flash = (key: string) => {
    setPulsando(key);
    setTimeout(() => setPulsando(null), 100);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="rounded-2xl border border-gray-200 bg-white shadow-lg overflow-hidden select-none">
      {/* Header con badge de lote activo */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-700 px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold opacity-70">Calculadora</span>
          <button
            onClick={() => setShowHistorial(s => !s)}
            className="rounded p-1 hover:bg-white/10 transition-colors"
            title="Historial"
          >
            <History size={14} className="opacity-70" />
          </button>
        </div>
        {loteActivo ? (
          <div className="mt-1 truncate text-[11px] opacity-90">
            <span className="opacity-70">→</span> <span className="font-semibold">{loteActivo.producto_nombre}</span>
            <span className="opacity-60"> · {loteActivo.lote_interno}</span>
          </div>
        ) : (
          <div className="mt-1 text-[11px] opacity-50 italic">Toca un campo "Contado" para enlazarlo</div>
        )}
      </div>

      {/* Display */}
      <div className="bg-gray-50 px-5 py-5 border-b border-gray-100">
        {/* Operación en curso (preview) */}
        <div className="text-right text-xs text-gray-400 h-4 tabular-nums">
          {acumulador !== null && op && `${formatear(acumulador)} ${op}`}
          {memoria !== null && (
            <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 font-bold">
              M: {formatear(memoria)}
            </span>
          )}
        </div>
        <div className="text-right text-3xl font-mono font-bold tabular-nums text-gray-900 mt-1 truncate" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </div>
      </div>

      {/* Historial colapsable */}
      {showHistorial && (
        <div className="bg-white px-3 py-2 border-b border-gray-100 max-h-32 overflow-y-auto">
          {historial.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic text-center py-2">Sin historial</p>
          ) : (
            <ul className="space-y-0.5 text-[11px] font-mono">
              {historial.map((h, i) => (
                <li key={i} className="text-gray-500 truncate" title={h}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Botonera */}
      <div className="grid grid-cols-4 gap-1.5 p-2.5 bg-white">
        {/* Fila memoria + clear */}
        <Btn label="MC" onPress={memoriaClear} variant="memo" pulsando={pulsando} disabled={memoria === null} />
        <Btn label="MR" onPress={memoriaRecall} variant="memo" pulsando={pulsando} disabled={memoria === null} />
        <Btn label="M-" onPress={memoriaSub} variant="memo" pulsando={pulsando} />
        <Btn label="M+" onPress={memoriaAdd} variant="memo" pulsando={pulsando} />

        {/* Fila utilidad */}
        <Btn label="AC" onPress={limpiar} variant="util" pulsando={pulsando} />
        <Btn label="±" onPress={cambiarSigno} variant="util" pulsando={pulsando} />
        <Btn label="⌫" onPress={borrar} variant="util" pulsando={pulsando} />
        <Btn label="/" onPress={() => aplicarOp('/')} variant="op" active={op === '/'} pulsando={pulsando} />

        {/* Filas dígitos */}
        <Btn label="7" onPress={() => meterDigito('7')} pulsando={pulsando} />
        <Btn label="8" onPress={() => meterDigito('8')} pulsando={pulsando} />
        <Btn label="9" onPress={() => meterDigito('9')} pulsando={pulsando} />
        <Btn label="*" labelDisplay="×" onPress={() => aplicarOp('*')} variant="op" active={op === '*'} pulsando={pulsando} />

        <Btn label="4" onPress={() => meterDigito('4')} pulsando={pulsando} />
        <Btn label="5" onPress={() => meterDigito('5')} pulsando={pulsando} />
        <Btn label="6" onPress={() => meterDigito('6')} pulsando={pulsando} />
        <Btn label="-" onPress={() => aplicarOp('-')} variant="op" active={op === '-'} pulsando={pulsando} />

        <Btn label="1" onPress={() => meterDigito('1')} pulsando={pulsando} />
        <Btn label="2" onPress={() => meterDigito('2')} pulsando={pulsando} />
        <Btn label="3" onPress={() => meterDigito('3')} pulsando={pulsando} />
        <Btn label="+" onPress={() => aplicarOp('+')} variant="op" active={op === '+'} pulsando={pulsando} />

        <Btn label="0" onPress={() => meterDigito('0')} className="col-span-2" pulsando={pulsando} />
        <Btn label="." onPress={() => meterDigito('.')} pulsando={pulsando} />
        <Btn label="=" onPress={igualar} variant="igual" pulsando={pulsando} />
      </div>

      {/* Acción enviar al lote */}
      <div className="border-t border-gray-100 p-2.5 bg-gray-50">
        <button
          onClick={enviarAlLote}
          disabled={!loteActivo || display === '0' || isNaN(parseFloat(display))}
          className={clsx(
            'w-full flex items-center justify-center gap-2 rounded-xl py-3 px-4 text-sm font-bold transition-all shadow-sm active:scale-[0.98]',
            loteActivo && display !== '0' && !isNaN(parseFloat(display))
              ? 'bg-loga-red text-white hover:brightness-110 shadow-loga-red/30'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          )}
        >
          <Send size={15} />
          Enviar al lote activo
        </button>
        <button
          onClick={limpiar}
          className="mt-1.5 w-full flex items-center justify-center gap-1 rounded-lg py-1.5 px-3 text-[11px] font-medium text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <RotateCcw size={11} />
          Limpiar todo
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────
function formatear(n: number): string {
  if (!Number.isFinite(n)) return 'Error';
  // Hasta 6 decimales, sin trailing zeros
  return parseFloat(n.toFixed(6)).toString();
}

interface BtnProps {
  label: string;
  labelDisplay?: string;
  onPress: () => void;
  variant?: 'digit' | 'op' | 'util' | 'memo' | 'igual';
  active?: boolean;
  className?: string;
  disabled?: boolean;
  pulsando?: string | null;
}

function Btn({ label, labelDisplay, onPress, variant = 'digit', active, className, disabled, pulsando }: BtnProps) {
  const isFlashing = pulsando === label;
  const styles: Record<string, string> = {
    digit: 'bg-white hover:bg-gray-50 text-gray-900 border-gray-200 active:bg-gray-100',
    op:    'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200 active:bg-amber-200 font-bold',
    util:  'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-200 active:bg-gray-300',
    memo:  'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200 active:bg-blue-200 text-[10px]',
    igual: 'bg-gray-900 hover:bg-gray-700 text-white border-gray-900 active:bg-gray-800 font-bold',
  };
  return (
    <button
      onClick={onPress}
      disabled={disabled}
      className={clsx(
        'rounded-xl border min-h-[52px] text-base font-semibold transition-all shadow-sm active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed',
        styles[variant],
        active && 'ring-2 ring-amber-400 ring-offset-1',
        isFlashing && 'scale-95 brightness-95',
        className,
      )}
      // Anti-zoom-iOS y feedback táctil
      style={{ touchAction: 'manipulation' }}
    >
      {labelDisplay ?? label}
    </button>
  );
}
