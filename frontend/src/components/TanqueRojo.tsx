import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useSpring } from 'framer-motion';
import { Thermometer } from 'lucide-react';

interface Props {
  pct: number;
  temperatura?: number;
  size?: number;
}

type Bubble = { x: number; y: number; r: number; vy: number; alpha: number; wobble: number; ph: number };
type Ripple = { y: number; t: number; amp: number; sign: 1 | -1 };
type Splash = { x: number; y: number; vx: number; vy: number; r: number; life: number };

export default function TanqueRojo({ pct, temperatura, size = 120 }: Props) {
  const spring = useSpring(pct, { stiffness: 55, damping: 16 });
  const waveOffset = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const bubblesRef = useRef<Bubble[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const splashesRef = useRef<Splash[]>([]);
  const prevPctRef = useRef<number>(pct);
  const h = Math.round(size * 140 / 120);

  // Detecta cambios de nivel → dispara ripple + splash particles
  useEffect(() => {
    const diff = pct - prevPctRef.current;
    if (Math.abs(diff) > 0.5) {
      // Ripple onda en la superficie
      ripplesRef.current.push({ y: 0, t: 0, amp: Math.min(6, Math.abs(diff) * 0.4), sign: diff > 0 ? 1 : -1 });
      // Salpicaduras al subir nivel
      if (diff > 0) {
        const n = Math.min(12, Math.floor(diff * 0.6));
        for (let i = 0; i < n; i++) {
          splashesRef.current.push({
            x: 0.5 + (Math.random() - 0.5) * 0.6,  // normalized -.3..+.3 around center
            y: 0,
            vx: (Math.random() - 0.5) * 1.4,
            vy: -1.5 - Math.random() * 1.5,
            r: 1 + Math.random() * 1.5,
            life: 1,
          });
        }
      }
    }
    prevPctRef.current = pct;
    spring.set(pct);
  }, [pct, spring]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = size / 120;

    // Inicializa pool de burbujas (pre-llenadas, distribuidas)
    if (bubblesRef.current.length === 0) {
      const count = Math.max(6, Math.floor(size / 18));
      for (let i = 0; i < count; i++) {
        bubblesRef.current.push({
          x: 0.15 + Math.random() * 0.7,
          y: Math.random(),
          r: (0.5 + Math.random() * 1.4) * s,
          vy: (0.25 + Math.random() * 0.55) * s * 0.4,
          alpha: 0.18 + Math.random() * 0.32,
          wobble: Math.random() * Math.PI * 2,
          ph: Math.random() * Math.PI * 2,
        });
      }
    }

    const draw = () => {
      const w = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, w, ch);

      const tankX = 20 * s, tankY = 18 * s, tankW = w - 40 * s, tankH = ch - 55 * s, coneH = 22 * s;
      const r = 12 * s;
      const currentPct = spring.get();
      const liquidTop = tankY + tankH + coneH - ((currentPct / 100) * (tankH + coneH));

      // ── Tank shadow + body
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.10)';
      ctx.shadowBlur = 14 * s;
      ctx.shadowOffsetY = 4 * s;
      ctx.beginPath();
      ctx.roundRect(tankX, tankY, tankW, tankH, [r, r, 0, 0]);
      ctx.fillStyle = '#fafafa';
      ctx.fill();
      ctx.restore();

      // ── Inner shading (glass effect)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(tankX, tankY, tankW, tankH, [r, r, 0, 0]);
      ctx.clip();
      const innerGrad = ctx.createLinearGradient(tankX, 0, tankX + tankW, 0);
      innerGrad.addColorStop(0, 'rgba(255,255,255,0.6)');
      innerGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
      innerGrad.addColorStop(1, 'rgba(0,0,0,0.04)');
      ctx.fillStyle = innerGrad;
      ctx.fillRect(tankX, tankY, tankW, tankH);
      ctx.restore();

      // ── Clip for liquid + cone shape
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(tankX, tankY, tankW, tankH, [r, r, 0, 0]);
      ctx.moveTo(tankX, tankY + tankH);
      ctx.lineTo(tankX + tankW, tankY + tankH);
      ctx.lineTo(tankX + tankW / 2 + 10 * s, tankY + tankH + coneH);
      ctx.lineTo(tankX + tankW / 2 - 10 * s, tankY + tankH + coneH);
      ctx.closePath();
      ctx.clip();

      if (currentPct > 0.5) {
        // ── BACK WAVE (más lenta, más amplia, oscura)
        ctx.beginPath();
        ctx.moveTo(0, liquidTop);
        for (let x = 0; x <= w; x += 2) {
          const y = liquidTop
            + Math.sin((x / w) * Math.PI * 2.5 + waveOffset.current * 0.6) * 4 * s
            + Math.sin((x / w) * Math.PI * 1.5 - waveOffset.current * 0.3) * 1.5 * s;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, ch);
        ctx.lineTo(0, ch);
        ctx.closePath();
        const backGrad = ctx.createLinearGradient(0, liquidTop - 10, 0, ch);
        backGrad.addColorStop(0, 'rgba(160, 0, 0, 0.55)');
        backGrad.addColorStop(1, 'rgba(120, 0, 0, 0.75)');
        ctx.fillStyle = backGrad;
        ctx.fill();

        // ── MAIN WAVE (principal con gradiente vibrante)
        ctx.beginPath();
        ctx.moveTo(0, liquidTop + 2 * s);
        const ripples = ripplesRef.current;
        for (let x = 0; x <= w; x += 2) {
          const baseY = liquidTop + 2 * s
            + Math.sin((x / w) * Math.PI * 3.2 + waveOffset.current) * 3.5 * s
            + Math.sin((x / w) * Math.PI * 5 - waveOffset.current * 0.85) * 1.8 * s;
          // Ripples superpuestas (ondas concéntricas)
          let rippleY = 0;
          for (const rp of ripples) {
            const decay = Math.max(0, 1 - rp.t / 1.4);
            const phase = rp.t * 12 - (x / w) * 4;
            rippleY += Math.sin(phase) * rp.amp * decay * s * rp.sign;
          }
          ctx.lineTo(x, baseY + rippleY);
        }
        ctx.lineTo(w, ch);
        ctx.lineTo(0, ch);
        ctx.closePath();
        const mainGrad = ctx.createLinearGradient(0, liquidTop - 10, 0, ch);
        mainGrad.addColorStop(0, 'rgba(255, 80, 80, 0.92)');
        mainGrad.addColorStop(0.25, 'rgba(235, 35, 35, 0.95)');
        mainGrad.addColorStop(0.7, 'rgba(200, 15, 15, 0.96)');
        mainGrad.addColorStop(1, 'rgba(160, 0, 0, 0.98)');
        ctx.fillStyle = mainGrad;
        ctx.fill();

        // ── HIGHLIGHT en la superficie (brillo de luz)
        ctx.beginPath();
        ctx.moveTo(0, liquidTop + 1 * s);
        for (let x = 0; x <= w; x += 2) {
          const y = liquidTop + 1 * s + Math.sin((x / w) * Math.PI * 3.2 + waveOffset.current) * 3.5 * s;
          ctx.lineTo(x, y);
        }
        for (let x = w; x >= 0; x -= 2) {
          const y = liquidTop + 4 * s + Math.sin((x / w) * Math.PI * 3.2 + waveOffset.current) * 3.5 * s;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        const shineGrad = ctx.createLinearGradient(0, liquidTop, 0, liquidTop + 6 * s);
        shineGrad.addColorStop(0, 'rgba(255, 200, 200, 0.45)');
        shineGrad.addColorStop(1, 'rgba(255, 150, 150, 0)');
        ctx.fillStyle = shineGrad;
        ctx.fill();

        // ── BURBUJAS (ascendiendo desde el fondo)
        const liquidBottomY = ch;
        const liquidHeight = Math.max(1, liquidBottomY - liquidTop);
        for (const b of bubblesRef.current) {
          // Posición real
          const bx = tankX + b.x * tankW + Math.sin(b.wobble) * 1.5 * s;
          const by = liquidTop + b.y * liquidHeight;
          if (by < liquidTop - 2 || by > liquidBottomY + 5) continue;
          // Pop al alcanzar la superficie
          const proximityToSurface = Math.max(0, 1 - (by - liquidTop) / (8 * s));
          const alphaNow = b.alpha * (1 - proximityToSurface * 0.6);
          ctx.beginPath();
          ctx.arc(bx, by, b.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 200, 200, ${alphaNow})`;
          ctx.fill();
          // Highlight pequeño en la burbuja
          ctx.beginPath();
          ctx.arc(bx - b.r * 0.3, by - b.r * 0.3, b.r * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${alphaNow * 0.8})`;
          ctx.fill();
        }

        // ── SPLASH particles (salpicaduras al subir nivel)
        for (const sp of splashesRef.current) {
          const x = tankX + tankW * sp.x;
          const y = liquidTop + sp.y * s;
          ctx.beginPath();
          ctx.arc(x, y, sp.r * s, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 120, 120, ${sp.life * 0.85})`;
          ctx.fill();
        }
      }

      ctx.restore();

      // ── Tank outline
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

      // Fill level marks (líneas de medida)
      ctx.strokeStyle = 'rgba(255,0,0,0.18)';
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

      // ── Avanza estado de animaciones
      waveOffset.current += 0.045;

      // Burbujas: avanzan hacia arriba; reset cuando llegan a la superficie
      for (const b of bubblesRef.current) {
        b.y -= b.vy / Math.max(20, ch);
        b.wobble += 0.04;
        if (b.y < -0.02) {
          // Reset al fondo
          b.y = 1 + Math.random() * 0.05;
          b.x = 0.15 + Math.random() * 0.7;
          b.r = (0.5 + Math.random() * 1.4) * s;
          b.vy = (0.25 + Math.random() * 0.55) * s * 0.4;
          b.alpha = 0.18 + Math.random() * 0.32;
        }
      }

      // Ripples decay
      ripplesRef.current = ripplesRef.current
        .map(rp => ({ ...rp, t: rp.t + 0.04 }))
        .filter(rp => rp.t < 1.5);

      // Splash particles physics
      splashesRef.current = splashesRef.current
        .map(sp => ({
          ...sp,
          x: sp.x + sp.vx * 0.01,
          y: sp.y + sp.vy,
          vy: sp.vy + 0.45,    // gravity
          life: sp.life - 0.04,
        }))
        .filter(sp => sp.life > 0 && sp.y < 30);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spring, size, h]);

  return (
    <div className="relative flex flex-col items-center">
      <div className="relative" style={{ width: size, height: h }}>
        <canvas ref={canvasRef} width={size} height={h} className="w-full h-full" />
        {/* Logo centrado en la tolva (sutil, da textura) */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          style={{ top: '25%', width: size * 0.45, height: size * 0.45, opacity: 0.12 }}>
          <img src="/colas-loga.png" alt="CL" className="w-full h-full object-contain" />
        </div>
        {/* Percentage badge — sigue al nivel del líquido */}
        <AnimatePresence>
          {pct > 3 && (
            <motion.div
              key="pct-badge"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              className="absolute left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-full px-2 py-0.5 text-[11px] font-bold text-loga-red shadow-md border border-red-100 z-10"
              style={{ top: `${Math.max(18, 100 - pct * 0.8)}%` }}
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
