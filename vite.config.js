import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'data',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
});
