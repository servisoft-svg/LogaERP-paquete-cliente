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
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.railway.app'],
    hmr: { clientPort: 443 },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
