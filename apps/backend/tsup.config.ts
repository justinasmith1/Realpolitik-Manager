import { defineConfig } from 'tsup';

export default defineConfig({
  // `crear-primer-administrador` sale en el build para poder ejecutarlo en producción sin tsx.
  // Entradas con nombre: `dist/server.js` (lo usa `start`) y `dist/crear-primer-administrador.js`.
  entry: {
    server: 'src/server.ts',
    'crear-primer-administrador': 'src/scripts/crear-primer-administrador.ts',
  },
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
});
