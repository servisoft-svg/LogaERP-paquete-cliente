/**
 * SpinnerColaBlanca — Logo Loga gris → rojo minimalista
 */

import { motion } from 'framer-motion';

interface SpinnerColaBlancaProps {
  size?: 'sm' | 'md' | 'lg';
}

const maskStyle = {
  WebkitMaskImage: 'url(/colas-loga.png)',
  WebkitMaskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskImage: 'url(/colas-loga.png)',
  maskSize: 'contain',
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
} as React.CSSProperties;

function LogoFill({ dim, duration = 1 }: { dim: number; duration?: number }) {
  return (
    <div className="relative" style={{ width: dim, height: dim }}>
      {/* Logo gris */}
      <img
        src="/colas-loga.png"
        alt=""
        className="absolute inset-0 w-full h-full object-contain"
        style={{ filter: 'grayscale(1) brightness(0.8)', opacity: 0.15 }}
      />
      {/* Rojo mascarado */}
      <div className="absolute inset-0" style={maskStyle}>
        <motion.div
          className="absolute bottom-0 left-0 right-0 bg-[#E8001C]"
          initial={{ height: '0%' }}
          animate={{ height: '100%' }}
          transition={{ duration, ease: [0.4, 0, 0.2, 1], repeat: Infinity, repeatType: 'reverse' }}
        />
      </div>
    </div>
  );
}

/** Spinner entre paginas — 1 segundo de llenado */
export default function SpinnerColaBlanca({ size = 'md' }: SpinnerColaBlancaProps) {
  const dim = { sm: 56, md: 80, lg: 120 }[size];
  return (
    <div className="flex items-center justify-center select-none">
      <LogoFill dim={dim} duration={1} />
    </div>
  );
}

/** Splash al abrir la app — animacion completa con fade y scale */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <LogoFill dim={160} duration={1.8} />
      </motion.div>
      <motion.p
        className="mt-6 text-[11px] tracking-[0.3em] uppercase text-gray-300 font-medium"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        Colas Loga
      </motion.p>
    </div>
  );
}
