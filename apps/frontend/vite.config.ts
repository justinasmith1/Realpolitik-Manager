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
    // Necesario en Docker: escuchar en todas las interfaces para que el host acceda al contenedor.
    host: true,
    port: 5173,
    // Los eventos de archivos no cruzan el bind mount en Windows/WSL: hace falta polling para HMR.
    watch: { usePolling: true, interval: 300 },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
