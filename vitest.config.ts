import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // i test end-to-end girano con Playwright, non con vitest
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'tests-e2e', '.next'],
  },
});
