import { defineConfig } from 'vitest/config';
import { bakeHash } from './scripts/bake-hash.mjs';

export default defineConfig({
  base: './',
  // Pişirilmiş ışık: kaynak özeti derleme anında (docs/BAKE.md) — oyun manifest.srcHash ile karşılaştırır
  define: { __BAKE_SRC_HASH__: JSON.stringify(bakeHash()) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
