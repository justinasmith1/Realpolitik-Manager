import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // El alias `@/*` se declara una sola vez, en tsconfig.json (`paths`).
    tsconfigPaths: true,
  },
  server: {
    port: 5173,
    // Los eventos de archivos no cruzan el bind mount en Windows/WSL: hace falta polling para HMR.
    // Solo se activa dentro de Docker (docker-compose define CHOKIDAR_USEPOLLING); con `pnpm dev`
    // en el host no hay polling. El `--host 0.0.0.0` lo pasa el comando del servicio en compose.
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : null,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
