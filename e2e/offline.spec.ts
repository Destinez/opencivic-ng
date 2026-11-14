import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { sampleSheetPng } from '../packages/db/src/placeholder-png';

async function signIn(page: Page) {
  const response = await page.request.post('/backend/v1/auth/login', {
    data: { email: 'ada.okonkwo@example.com', password: 'observer-demo-pass' },
  });
  expect(response.ok()).toBe(true);
}

async function fill(page: Page) {
  await page.getByLabel('Accredited voters', { exact: true }).fill('120');
  await page.locator('#vote-APC').fill('112');
  await page.locator('input[name="declaration"]').check();
}

test('a phone keeps a draft through an offline reload and syncs it once', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/results/new?pollingUnitId=sample-ward-lagos-ikeja-gra-pu-3');
  await expect(page.getByText('Ready for an offline reload.')).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await fill(page);
  await page
    .locator('#photo')
    .setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: sampleSheetPng() });
  await page.getByRole('button', { name: 'Save observation', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 waiting to send' })).toBeVisible();
  const id = await page.locator('[data-outbox-id]').getAttribute('data-outbox-id');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save observation', exact: true })).toBeEnabled();
  await expect(page.locator(`[data-outbox-id="${id}"]`).getByText(/Photo:/)).toBeVisible();
  await expect(
    page.locator(`[data-outbox-id="${id}"]`).getByText('Saved on phone', { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.locator(`[data-outbox-id="${id}"]`).getByText('Sent ✓', { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const response = await page.request.get('/backend/v1/submissions/mine');
  const body = (await response.json()) as {
    data: Array<{ clientId: string; photoSha256: string }>;
  };
  expect(body.data.filter((row) => row.clientId === id)).toHaveLength(1);
  expect(body.data.find((row) => row.clientId === id)?.photoSha256).toMatch(/^[a-f0-9]{64}$/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
});

test('the observer flow sends on a slow connection without loading fonts or a map', async ({
  page,
  context,
}) => {
  await signIn(page);
  const fonts: string[] = [];
  const tiles: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fonts.push(request.url());
    if (request.url().includes('tile.openstreetmap')) tiles.push(request.url());
  });
  const network = await context.newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 1500,
    downloadThroughput: 32 * 1024,
    uploadThroughput: 16 * 1024,
  });
  await page.goto('/results/new?pollingUnitId=sample-ward-lagos-ikeja-gra-pu-3');
  await expect(page.getByLabel('Accredited voters', { exact: true })).toBeVisible();
  await fill(page);
  const start = Date.now();
  await page.getByRole('button', { name: 'Save observation', exact: true }).click();
  await expect(page.getByText('Sent ✓', { exact: true })).toBeVisible({ timeout: 45_000 });
  expect(Date.now() - start).toBeLessThan(45_000);
  expect(fonts).toEqual([]);
  expect(tiles).toEqual([]);
});
