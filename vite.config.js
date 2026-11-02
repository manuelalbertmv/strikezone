import { defineConfig } from 'vite';

// base './' permite desplegar en cualquier subcarpeta (GitHub Pages, Netlify, etc.)
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true, port: 5173 },
});
