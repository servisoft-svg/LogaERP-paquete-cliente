import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useSpring } from 'framer-motion';
import { Thermometer } from 'lucide-react';

interface Props {
  pct: number;
  temperatura?: number;
  size?: number;
}

export default function TanqueRojo({ pct, temperatura, size = 120 }: Props) {
  const spring = useSpring(pct, { stiffness: 60, damping: 18 });
  const waveOffset = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const h = Math.round(size * 140 / 120);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = size / 120; // scale factor

    const draw = () => {
      const w = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, w, ch);

      const tankX = 20 * s, tankY = 18 * s, tankW = w - 40 * s, tankH = ch - 55 * s, coneH = 22 * s;
      const r = 12 * s;

      // Tank shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.08)';
      ctx.shadowBlur = 12 * s;
      ctx.shadowOffsetY = 4 * s;
      ctx.beginPath();
      ctx.roundRect(tankX, tankY, tankW, tankH, [r, r, 0, 0]);
      ctx.fillStyle = '#fafafa';
      ctx.fill();
      ctx.restore();

      // Clip for liquid
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(tankX, tankY, tankW, tankH, [r, r, 0, 0]);
      ctx.moveTo(tankX, tankY + tankH);
      ctx.lineTo(tankX + tankW, tankY + tankH);
      ctx.lineTo(tankX + tankW / 2 + 10 * s, tankY + tankH + coneH);
      ctx.lineTo(tankX + tankW / 2 - 10 * s, tankY + tankH + coneH);
      ctx.closePath();
      ctx.clip();

      // Liquid fill
      const liquidTop = tankY + tankH + coneH - ((spring.get() / 100) * (tankH + coneH));

      ctx.beginPath();
      ctx.moveTo(0, liquidTop);
      for (let x = 0; x <= w; x += 2) {
        const y = liquidTop
          + Math.sin((x / w) * Math.PI * 3.5 + waveOffset.current) * 3 * s
          + Math.sin((x / w) * Math.PI * 5.5 - waveOffset.current * 0.8) * 1.5 * s;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, ch);
      ctx.lineTo(0, ch);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, liquidTop - 10, 0, ch);
      grad.addColorStop(0, 'rgba(255,60,60,0.85)');
      grad.addColorStop(0.3, 'rgba(220,30,30,0.9)');
      grad.addColorStop(0.7, 'rgba(200,15,15,0.93)');
      grad.addColorStop(1, 'rgba(170,10,10,0.95)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Shine layer
      ctx.beginPath();
      ctx.moveTo(0, liquidTop + 3 * s);
      for (let x = 0; x <= w; x += 2) {
        const y = liquidTop + 5 * s + Math.sin((x / w) * Math.PI * 4 + waveOffset.current * 1.2 + 0.8) * 2 * s;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, ch);
      ctx.lineTo(0, ch);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,120,120,0.35)';
      ctx.fill();

      ctx.restore();

      // Tank outline
      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.roundRect(tankX, tankY, tankW, tankH, [r, r, 0, 0]);
      ctx.stroke();

      // Cone
      ctx.beginPath();
      ctx.moveTo(tankX, tankY + tankH);
      ctx.lineTo(tankX + tankW / 2 - 10 * s, tankY + tankH + coneH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tankX + tankW, tankY + tankH);
      ctx.lineTo(tankX + tankW / 2 + 10 * s, tankY + tankH + coneH);
      ctx.stroke();

      // Valve
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.roundRect(tankX + tankW / 2 - 6 * s, tankY + tankH + coneH, 12 * s, 8 * s, 3 * s);
      ctx.fill();

      // Top flange
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.roundRect(tankX - 4 * s, tankY - 4 * s, tankW + 8 * s, 6 * s, 3 * s);
      ctx.fill();

      // Agitator
      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = 2 * s;
      const agX = tankX + tankW / 2;
      ctx.beginPath();
      ctx.moveTo(agX, tankY - 4 * s);
      ctx.lineTo(agX, tankY + 8 * s);
      ctx.stroke();

      // Fill level marks
      ctx.strokeStyle = 'rgba(255,0,0,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (const frac of [0.25, 0.5, 0.75]) {
        const my = tankY + tankH * (1 - frac);
        ctx.beginPath();
        ctx.moveTo(tankX + 4 * s, my);
        ctx.lineTo(tankX + tankW - 4 * s, my);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      waveOffset.current += 0.04;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spring, size, h]);

  useEffect(() => { spring.set(pct); }, [pct, spring]);

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative" style={{ width: size, height: h }}>
        <canvas ref={canvasRef} width={size} height={h} className="w-full h-full" />
        {/* Logo centrado en la tolva */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ top: '25%', width: size * 0.45, height: size * 0.45, opacity: 0.15 }}>
          <img src="/colas-loga.png" alt="CL" className="w-full h-full object-contain" />
        </div>
        {/* Percentage */}
        <AnimatePresence>
          {pct > 3 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-full px-2 py-0.5 text-[11px] font-bold text-loga-red shadow-sm border border-red-100"
              style={{ top: `${Math.max(20, 100 - pct * 0.8)}%` }}
            >
              {Math.round(pct)}%
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {temperatura !== undefined && (
        <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-500">
          <Thermometer size={10} className={temperatura > 60 ? 'text-loga-red' : temperatura > 35 ? 'text-amber-500' : 'text-blue-500'} />
          <span className="font-mono font-bold">{Math.round(temperatura)}°C</span>
        </div>
      )}
    </div>
  );
}
