import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL ?? 'pglite:./.data/e2e';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'smoke', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @opencivic/api exec tsx src/index.ts',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        SEED_ON_BOOT: 'true',
        WEB_ORIGINS: 'http://localhost:3000',
        UPLOAD_DIR: './.data/uploads',
        PORT: '4000',
      },
    },
    {
      command: process.env.CI
        ? 'pnpm --filter @opencivic/web start'
        : 'pnpm --filter @opencivic/web dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        API_INTERNAL_URL: 'http://localhost:4000',
        NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      },
    },
  ],
});
