import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build (`vite preview`) so the service worker is real.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
