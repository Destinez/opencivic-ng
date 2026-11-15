import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL ?? 'pglite:./.data/e2e';
process.env.E2E_RUN_ID ??= randomUUID().replaceAll('-', '');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    ...(process.env.PLAYWRIGHT_CHROME_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } }
      : {}),
  },
  projects: [
    { name: 'demo', testMatch: /sheetmatch-demo\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'smoke',
      testIgnore: /(?:screenshots|sheetmatch-demo)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @opencivic/api exec tsx ../../scripts/e2e-api.mts',
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        E2E_SCHEMA: `e2e_${process.env.E2E_RUN_ID}`,
        SEED_ON_BOOT: 'true',
        SEED_SHEETMATCH_DEMO: process.env.SEED_SHEETMATCH_DEMO ?? 'false',
        WEB_ORIGINS: 'http://localhost:3000',
        UPLOAD_DIR: './.data/uploads',
        PORT: '4000',
      },
    },
    {
      command: 'pnpm --filter @opencivic/web start',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        API_INTERNAL_URL: 'http://localhost:4000',
        NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      },
    },
  ],
});
import { randomUUID } from 'node:crypto';
