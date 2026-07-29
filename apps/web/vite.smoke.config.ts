/**
 * Build variant used only by scripts/smoke.mjs. jsdom cannot execute
 * <script type="module">, so this emits a classic IIFE bundle instead.
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // Vite's lib mode does not inject this the way the app build does.
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-smoke',
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/main.tsx'),
      formats: ['iife'],
      name: 'CarAdvocate',
      fileName: () => 'app.js',
    },
  },
});
