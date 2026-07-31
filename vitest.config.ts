import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // stesso alias di tsconfig.json: vitest non lo legge da solo
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    // i test end-to-end girano con Playwright, non con vitest
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'tests-e2e', '.next'],
  },
});
