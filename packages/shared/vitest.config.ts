import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Vitest runs against source .ts files directly (no pre-build).
    // Node ESM-style imports use `.js` extensions; this tells Vite/Vitest
    // to resolve them to their .ts counterparts at test time.
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
    },
  },
});
