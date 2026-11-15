import { mkdir, readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('captures the fictional offline sheet, document comparison, board and evidence pack', async ({
  page,
  context,
}) => {
  await mkdir('.data/demo-frames', { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.site-header { position: relative !important; }';
      document.head.append(style);
    });
  });
  async function gifFrame(name: string) {
    await page.screenshot({ path: `.data/demo-frames/${name}.png`, animations: 'disabled' });
  }
  async function frame(name: string, path: string) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/sheetmatch-${name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await frame('lookup', '/lookup?q=Ikeja+GRA');
  await gifFrame('01-lookup');
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'ada.okonkwo@example.com', password: 'observer-demo-pass' },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/results/new?pollingUnitId=sample-ward-lagos-ikeja-gra-pu-3');
  await expect(page.getByText('Ikeja GRA sample unit 3', { exact: false })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByLabel('Accredited voters', { exact: true }).fill('120');
  await page.getByLabel('Rejected ballots', { exact: true }).fill('2');
  await page.locator('#vote-APC').fill('112');
  await page.getByLabel('Photo of the result sheet, optional').setInputFiles({
    name: 'sample-observer.png',
    mimeType: 'image/png',
    buffer: await readFile('packages/db/fixtures/demo-observer.png'),
  });
  await context.setOffline(true);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save observation', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved on phone', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/sheetmatch-offline-mobile.png', fullPage: true });
  await page
    .getByRole('heading', { name: 'On this phone' })
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await gifFrame('02-offline');
  await context.setOffline(false);
  await expect(page.getByText('Sent ✓', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/sheetmatch-sent-mobile.png', fullPage: true });
  await page
    .getByRole('heading', { name: 'On this phone' })
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await gifFrame('03-sent');
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'femi.adeyemi@example.com', password: 'desk-demo-pass' },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/cases');
  await page.getByLabel('State', { exact: true }).selectOption('sample-state-lagos');
  await page.getByLabel('Local government area').selectOption('sample-lga-lagos-ikeja');
  await expect(page.getByRole('link', { name: 'Read case and evidence' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Show case map' }).click();
  await expect(page.locator('.case-pin').first()).toBeVisible();
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLImageElement>('.leaflet-tile')].every(
      (tile) => tile.complete && tile.naturalWidth > 0,
    ),
  );
  await page.screenshot({
    path: 'docs/screenshots/sheetmatch-board-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('heading', { name: 'Cases on this page' }).scrollIntoViewIfNeeded();
  await gifFrame('04-board');
  await page.getByRole('link', { name: 'Read case and evidence' }).first().click();
  await expect(page.getByText('⚠ Differs by 30', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Reference result sheet/ })).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/sheetmatch-case-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .getByRole('heading', { name: 'Document differences' })
    .evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await gifFrame('05-documents');
  await page.getByText('⚠ Differs by 30', { exact: true }).scrollIntoViewIfNeeded();
  await gifFrame('06-diff');
  const check = await new AxeBuilder({ page }).analyze();
  expect(
    check.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download evidence pack' }).click();
  expect(await (await download).failure()).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/sheetmatch-case-mobile.png', fullPage: true });
  await frame('board-mobile', '/cases');
});
