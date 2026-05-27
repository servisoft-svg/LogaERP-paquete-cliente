import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Sin sourcemaps en prod (reduce tamaño + no expone source).
    // Para debugging: VITE_SOURCEMAP=true npm run build
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
    rollupOptions: {
      output: {
        // Separar vendors estables del código app — mejor cache HTTP entre
        // updates de la app (vendor.js raramente cambia, app.js cada release).
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui':      ['framer-motion', 'lucide-react'],
          'vendor-utils':   ['axios', 'date-fns', 'clsx', 'sileo'],
        },
      },
    },
  },
  server: (() => {
    // BACKEND_PORT permite apuntar el proxy a otra instancia de backend (default 3001).
    // Usa 127.0.0.1 explícito (no `localhost`) para evitar conflicto IPv4/IPv6
    // que provoca ECONNREFUSED en macOS cuando backend escucha en una sola familia.
    const backendTarget = `http://127.0.0.1:${process.env.BACKEND_PORT ?? '3001'}`;
    return {
      host: true,
      port: Number(process.env.PORT ?? 5173),
      allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.railway.app'],
      hmr: { clientPort: 443 },
      proxy: {
        // Timeout largo para endpoints lentos como /backup (pg_dump + cifrado + Drive).
        '/api':     { target: backendTarget, changeOrigin: true, timeout: 300_000, proxyTimeout: 300_000 },
        '/uploads': { target: backendTarget, changeOrigin: true },
      },
    };
  })(),
});
