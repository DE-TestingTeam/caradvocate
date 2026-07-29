import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    // Relative /api calls in the app reach the Express server through here, so
    // there is no CORS configuration and no base-URL env var in the client.
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
});
