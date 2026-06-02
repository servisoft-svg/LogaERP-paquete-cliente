/**
 * AyudaFlotante
 * =============
 * Panel de ayuda no-modal, flotante, arrastrable. Encima de todo (z-9999).
 * Sin backdrop → la app debajo sigue siendo usable. Persistente entre rutas.
 *
 * Estados:
 *   - cerrado: pestaña pequeña en esquina inferior-izq con logo
 *   - abierto: panel 360×520 (arrastrable por la cabecera)
 *   - minimizado (futuro): solo barra de título
 *
 * Contenido: FAQ estática en src/data/ayudaTemas.ts (cero coste, cero red).
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { X, Search, ChevronLeft, ExternalLink, GripHorizontal, HelpCircle, AlertTriangle } from 'lucide-react';
import { AYUDA_TEMAS } from '../data/ayudaTemas';

const LS_OPEN = 'ayuda_open_v1';
const LS_POS = 'ayuda_pos_v1';
const LS_TEMA = 'ayuda_tema_v1';

const PANEL_W = 360;
const PANEL_H = 520;
const TAB_SIZE = 48;

function readPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(LS_POS);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  // Default: esquina inferior-derecha con margen.
  return {
    x: Math.max(8, window.innerWidth - PANEL_W - 16),
    y: Math.max(80, window.innerHeight - PANEL_H - 24),
  };
}

function clampPos(p: { x: number; y: number }, w: number, h: number) {
  return {
    x: Math.max(8, Math.min(window.innerWidth - w - 8, p.x)),
    y: Math.max(8, Math.min(window.innerHeight - h - 8, p.y)),
  };
}

export default function AyudaFlotante() {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_OPEN) === '1'; } catch { return false; }
  });
  const [pos, setPos] = useState<{ x: number; y: number }>(readPos);
  const [temaId, setTemaId] = useState<string | null>(() => {
    try { return localStorage.getItem(LS_TEMA); } catch { return null; }
  });
  const [busqueda, setBusqueda] = useState('');
  const dragControlsRef = useRef<HTMLDivElement>(null);

  // Persistencia.
  useEffect(() => { localStorage.setItem(LS_OPEN, abierto ? '1' : '0'); }, [abierto]);
  useEffect(() => { localStorage.setItem(LS_POS, JSON.stringify(pos)); }, [pos]);
  useEffect(() => {
    if (temaId) localStorage.setItem(LS_TEMA, temaId);
    else localStorage.removeItem(LS_TEMA);
  }, [temaId]);

  // Re-clamp si cambia el viewport (resize, móvil).
  useEffect(() => {
    const onResize = () => setPos(p => clampPos(p, abierto ? PANEL_W : TAB_SIZE, abierto ? PANEL_H : TAB_SIZE));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [abierto]);

  const tema = temaId ? AYUDA_TEMAS.find(t => t.id === temaId) : null;

  const q = busqueda.trim().toLowerCase();
  const temasFiltrados = q
    ? AYUDA_TEMAS.filter(t =>
        t.titulo.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.includes(q)) ||
        t.pasos.some(p => p.toLowerCase().includes(q))
      )
    : AYUDA_TEMAS;
  // Mostramos todos los temas en el grid principal (sin separación entre
  // "destacados" y "otros"). Manteniendo el flag por si en el futuro queremos
  // reordenar — los destacados se ponen primero.
  const todosOrdenados = [...AYUDA_TEMAS].sort((a, b) => Number(!!b.destacado) - Number(!!a.destacado));

  const irA = (link?: string) => {
    if (!link) return;
    navigate(link);
    // No cerramos el panel: el operario sigue viendo los pasos mientras navega.
  };

  // ── Pestaña cerrada ──────────────────────────────────────────────────────
  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        title="Ayuda Loga"
        style={{ right: 16, bottom: 16 }}
        className="fixed z-[9999] w-12 h-12 rounded-full bg-loga-red text-white shadow-lg hover:shadow-xl hover:bg-red-700 transition-all flex items-center justify-center group"
      >
        <HelpCircle size={22} strokeWidth={2.2} />
        <span className="absolute right-14 bg-gray-900 text-white text-[11px] font-medium px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          Ayuda
        </span>
      </button>
    );
  }

  // ── Panel abierto ────────────────────────────────────────────────────────
  return (
    <motion.div
      drag
      dragMomentum={false}
      dragListener={false}
      dragControls={undefined}
      // El handle del drag se monta abajo. Usamos onPan en la cabecera.
      initial={false}
      animate={{ x: pos.x, y: pos.y }}
      style={{ width: PANEL_W, height: PANEL_H }}
      className="fixed top-0 left-0 z-[9999] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
    >
      {/* Cabecera: drag handle + cerrar */}
      <div
        ref={dragControlsRef}
        onPointerDown={(e) => {
          // Drag manual con pointer events. Más fiable que dragControls cuando
          // el panel está controlado por animate={{ x, y }}.
          const startX = e.clientX;
          const startY = e.clientY;
          const startPos = { ...pos };
          const onMove = (ev: PointerEvent) => {
            const next = clampPos(
              { x: startPos.x + (ev.clientX - startX), y: startPos.y + (ev.clientY - startY) },
              PANEL_W, PANEL_H
            );
            setPos(next);
          };
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }}
        className="flex items-center gap-2 px-3 py-2 bg-loga-red text-white cursor-grab active:cursor-grabbing select-none"
      >
        <GripHorizontal size={14} className="opacity-70" />
        <p className="flex-1 text-sm font-semibold">Ayuda Loga</p>
        <button
          onClick={() => setAbierto(false)}
          className="rounded p-1 hover:bg-white/20 transition-colors"
          title="Cerrar (vuelve a la pestaña)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {tema ? (
            <motion.div
              key={`tema-${tema.id}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4 space-y-3"
            >
              <button
                onClick={() => setTemaId(null)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
              >
                <ChevronLeft size={12} /> Volver
              </button>
              <h3 className="text-base font-bold text-gray-900">{tema.titulo}</h3>
              {tema.link && (
                <button
                  onClick={() => irA(tema.link)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-loga-red text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700"
                >
                  <ExternalLink size={12} /> Abrir en el ERP
                </button>
              )}
              <ol className="space-y-2 text-[13px] text-gray-700">
                {tema.pasos.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                    <span dangerouslySetInnerHTML={{ __html: renderMd(p) }} />
                  </li>
                ))}
              </ol>
              {tema.avisos && tema.avisos.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-700">
                    <AlertTriangle size={12} />
                    <p className="text-[11px] font-bold uppercase tracking-wider">Avisos</p>
                  </div>
                  {tema.avisos.map((a, i) => (
                    <p key={i} className="text-xs text-amber-800" dangerouslySetInnerHTML={{ __html: renderMd(a) }} />
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="lista"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-3 space-y-3"
            >
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar ayuda…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-loga-red focus:outline-none"
                />
              </div>

              {!q && (
                <>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">Temas</p>
                  <div className="grid grid-cols-2 gap-2">
                    {todosOrdenados.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTemaId(t.id)}
                        className="rounded-lg border border-gray-200 bg-white p-2 text-left hover:border-loga-red hover:bg-red-50 transition-colors"
                      >
                        <p className="text-xs font-bold text-gray-900 leading-tight">{t.titulo}</p>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {q && (
                <div className="space-y-1">
                  {temasFiltrados.length === 0 && (
                    <p className="text-xs text-gray-400 italic p-2">Sin resultados para "{busqueda}".</p>
                  )}
                  {temasFiltrados.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTemaId(t.id)}
                      className="w-full text-left rounded-lg p-2 hover:bg-gray-100 transition-colors"
                    >
                      <p className="text-xs font-bold text-gray-900">{t.titulo}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{(t.tags ?? []).slice(0, 4).join(' · ')}</p>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 px-3 py-1.5 bg-gray-50 text-[10px] text-gray-400 text-center">
        {AYUDA_TEMAS.length} guías · Loga ERP
      </div>
    </motion.div>
  );
}

// Render markdown ligero: **negrita** y `código`.
function renderMd(s: string): string {
  const esc = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-gray-900">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-gray-100 text-gray-800 text-[11px]">$1</code>');
}

