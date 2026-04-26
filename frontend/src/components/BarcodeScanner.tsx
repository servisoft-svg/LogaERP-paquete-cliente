/**
 * BarcodeScanner
 * ==============
 * Camera-based barcode scanner using the native BarcodeDetector API.
 * Opens a modal with a live video feed and scans for barcodes in real-time.
 * Works in Chrome/Edge on mobile (and desktop with camera).
 */
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, ScanLine } from 'lucide-react';

interface Props {
  open: boolean;
  onScan: (code: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ open, onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // Try BarcodeDetector API
        if ('BarcodeDetector' in window) {
          const detector = new (window as any).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code']
          });
          const scan = async () => {
            if (cancelled || !videoRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) {
                onScan(barcodes[0].rawValue);
                return;
              }
            } catch { /* retry */ }
            requestAnimationFrame(scan);
          };
          // Wait for video to be ready
          videoRef.current?.addEventListener('loadeddata', () => {
            if (!cancelled) scan();
          });
        } else {
          setError('Tu navegador no soporta escaneo de codigos. Usa Chrome en movil.');
        }
      } catch {
        setError('No se pudo acceder a la camara');
      }
    };

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setError('');
    };
  }, [open, onScan]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 w-full max-w-sm rounded-2xl bg-black overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 bg-black/80">
          <div className="flex items-center gap-2 text-white text-sm font-medium">
            <ScanLine size={16} />
            Escanear codigo
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="relative aspect-[4/3]">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {/* Scan line animation */}
          <motion.div
            className="absolute left-4 right-4 h-0.5 bg-loga-red shadow-lg shadow-red-500/50"
            animate={{ top: ['20%', '80%', '20%'] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <p className="text-white text-sm text-center px-6">{error}</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
