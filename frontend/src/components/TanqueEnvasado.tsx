/**
 * TanqueEnvasado — Tolva al 100% que se vacía hacia un bote que se llena
 * pct: 0-100 = progreso del envasado (0=tolva llena/bote vacío, 100=tolva vacía/bote lleno)
 */
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useSpring } from 'framer-motion';

interface Props {
  pct: number;
  size?: number;
}

export default function TanqueEnvasado({ pct, size = 200 }: Props) {
  const spring = useSpring(pct, { stiffness: 50, damping: 16 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef(0);
  const rafRef = useRef(0);
  const h = Math.round(size * 1.1);

  useEffect(() => { spring.set(pct); }, [pct, spring]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = size / 200;

    const draw = () => {
      const w = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, w, ch);

      const progress = spring.get() / 100; // 0→1
      const tolvaLevel = 1 - progress; // 1→0 (se vacía)
      const boteLevel = progress; // 0→1 (se llena)

      // ── TOLVA (izquierda superior) ──
      const tx = 15 * s, ty = 10 * s, tw = 70 * s, th = 90 * s, tcone = 18 * s;
      const tr = 8 * s;

      // Tolva outline
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, [tr, tr, 0, 0]);
      ctx.stroke();
      // Cono
      ctx.beginPath();
      ctx.moveTo(tx, ty + th);
      ctx.lineTo(tx + tw / 2 - 6 * s, ty + th + tcone);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx + tw, ty + th);
      ctx.lineTo(tx + tw / 2 + 6 * s, ty + th + tcone);
      ctx.stroke();
      // Válvula
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.roundRect(tx + tw / 2 - 4 * s, ty + th + tcone, 8 * s, 6 * s, 2 * s);
      ctx.fill();
      // Flange
      ctx.beginPath();
      ctx.roundRect(tx - 3 * s, ty - 3 * s, tw + 6 * s, 5 * s, 2 * s);
      ctx.fill();

      // Liquid in tolva (se vacía)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, [tr, tr, 0, 0]);
      ctx.moveTo(tx, ty + th);
      ctx.lineTo(tx + tw, ty + th);
      ctx.lineTo(tx + tw / 2 + 6 * s, ty + th + tcone);
      ctx.lineTo(tx + tw / 2 - 6 * s, ty + th + tcone);
      ctx.closePath();
      ctx.clip();

      const tolvaTop = ty + th + tcone - (tolvaLevel * (th + tcone));
      ctx.beginPath();
      ctx.moveTo(0, tolvaTop);
      for (let x = 0; x <= w; x += 2) {
        const y = tolvaTop + Math.sin((x / w) * Math.PI * 4 + waveRef.current) * 2 * s;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, ch);
      ctx.lineTo(0, ch);
      ctx.closePath();
      const tolvaGrad = ctx.createLinearGradient(0, tolvaTop, 0, ty + th + tcone);
      tolvaGrad.addColorStop(0, 'rgba(255,60,60,0.8)');
      tolvaGrad.addColorStop(1, 'rgba(200,15,15,0.9)');
      ctx.fillStyle = tolvaGrad;
      ctx.fill();
      ctx.restore();

      // ── CHORRO (flujo entre tolva y bote) ──
      if (progress > 0.02 && progress < 0.98) {
        const chorroX = tx + tw / 2;
        const chorroY1 = ty + th + tcone + 6 * s;
        const chorroY2 = ch - 65 * s;
        ctx.beginPath();
        ctx.moveTo(chorroX - 2 * s, chorroY1);
        ctx.lineTo(chorroX + 2 * s, chorroY1);
        ctx.lineTo(chorroX + 3 * s, chorroY2);
        ctx.lineTo(chorroX - 3 * s, chorroY2);
        ctx.closePath();
        const chorroGrad = ctx.createLinearGradient(0, chorroY1, 0, chorroY2);
        chorroGrad.addColorStop(0, 'rgba(255,50,50,0.7)');
        chorroGrad.addColorStop(0.5, 'rgba(255,80,80,0.5)');
        chorroGrad.addColorStop(1, 'rgba(255,50,50,0.3)');
        ctx.fillStyle = chorroGrad;
        ctx.fill();

        // Gotas
        const dropY = chorroY1 + ((Date.now() / 8) % (chorroY2 - chorroY1));
        ctx.beginPath();
        ctx.arc(chorroX, dropY, 2 * s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,80,80,0.6)';
        ctx.fill();
      }

      // ── BOTE (centro-abajo) ──
      const bx = tx + tw / 2 - 25 * s, by = ch - 60 * s, bw = 50 * s, bh = 55 * s;
      const br = 6 * s;

      // Bote outline
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, [0, 0, br, br]);
      ctx.stroke();
      // Borde superior del bote (labio)
      ctx.fillStyle = '#bbb';
      ctx.beginPath();
      ctx.roundRect(bx - 2 * s, by - 3 * s, bw + 4 * s, 5 * s, 2 * s);
      ctx.fill();
      ctx.strokeStyle = '#999';
      ctx.beginPath();
      ctx.roundRect(bx - 2 * s, by - 3 * s, bw + 4 * s, 5 * s, 2 * s);
      ctx.stroke();

      // Liquid in bote (se llena)
      if (boteLevel > 0.01) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, [0, 0, br, br]);
        ctx.clip();

        const boteTop = by + bh - (boteLevel * bh * 0.9);
        ctx.beginPath();
        ctx.moveTo(bx, boteTop);
        for (let x = bx; x <= bx + bw; x += 2) {
          const y = boteTop + Math.sin(((x - bx) / bw) * Math.PI * 3 + waveRef.current * 1.3) * 1.5 * s;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(bx + bw, by + bh);
        ctx.lineTo(bx, by + bh);
        ctx.closePath();
        const boteGrad = ctx.createLinearGradient(0, boteTop, 0, by + bh);
        boteGrad.addColorStop(0, 'rgba(255,70,70,0.85)');
        boteGrad.addColorStop(1, 'rgba(190,10,10,0.95)');
        ctx.fillStyle = boteGrad;
        ctx.fill();
        ctx.restore();
      }

      // Etiqueta en bote
      if (boteLevel > 0.3) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.roundRect(bx + 8 * s, by + 15 * s, bw - 16 * s, 18 * s, 2 * s);
        ctx.fill();
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 0.5 * s;
        ctx.beginPath();
        ctx.roundRect(bx + 8 * s, by + 15 * s, bw - 16 * s, 18 * s, 2 * s);
        ctx.stroke();

        // Texto CL
        ctx.fillStyle = '#FF0000';
        ctx.font = `bold ${7 * s}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('CL', bx + bw / 2, by + 27 * s);
      }

      // Tapón si está lleno
      if (boteLevel > 0.95) {
        ctx.fillStyle = '#FF0000';
        ctx.beginPath();
        ctx.roundRect(bx + 5 * s, by - 6 * s, bw - 10 * s, 6 * s, [3 * s, 3 * s, 0, 0]);
        ctx.fill();
      }

      // Logo tolva
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#FF0000';
      ctx.font = `bold ${10 * s}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('CL', tx + tw / 2, ty + th / 2 + 4 * s);
      ctx.globalAlpha = 1;

      waveRef.current += 0.05;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spring, size, h]);

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative" style={{ width: size * 0.55, height: h }}>
        <canvas ref={canvasRef} width={Math.round(size * 0.55)} height={h} className="w-full h-full" />
        <AnimatePresence>
          {pct > 3 && pct < 97 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute left-1/2 -translate-x-1/2 bottom-2 bg-white/95 backdrop-blur-sm rounded-full px-2 py-0.5 text-[10px] font-bold text-loga-red shadow-sm border border-red-100"
            >
              {Math.round(pct)}%
            </motion.div>
          )}
          {pct >= 97 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute left-1/2 -translate-x-1/2 bottom-2 bg-emerald-500 rounded-full px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm"
            >
              Listo
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
