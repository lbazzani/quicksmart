import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.BASE ?? 'http://localhost:3005',
    viewport: { width: 390, height: 844 }, // iPhone-ish, mobile first
    hasTouch: true,
  },
  reporter: [['list']],
});
