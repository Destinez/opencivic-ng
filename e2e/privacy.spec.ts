import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
test('public and staff pages pass accessibility checks and remain usable at twice normal text size', async ({
  page,
}) => {
  for (const path of [
    '/',
    '/lookup',
    '/elections',
    '/elections/nigeria-2027-general',
    '/results?election=sample-demonstration-poll',
    '/account',
    '/privacy',
    '/developers',
    '/cases',
    '/results/new',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const check = await new AxeBuilder({ page }).analyze();
    expect(
      check.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
      path,
    ).toEqual([]);
    await page.evaluate(() => {
      document.body.style.zoom = '2';
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      path,
    ).toBe(true);
  }
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'amina.yusuf@example.com', password: 'admin-demo-pass' },
  });
  for (const path of ['/account', '/review', '/admin/audit', '/admin/observers']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const check = await new AxeBuilder({ page }).analyze();
    expect(
      check.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
      path,
    ).toEqual([]);
  }
});
test('an observer can download an export and withdraw or restore evidence consent', async ({
  page,
}) => {
  await page.request.post('/backend/v1/auth/register', {
    data: {
      name: 'Privacy demo observer',
      email: 'privacy-demo@example.com',
      password: 'privacy-demo-pass',
      ageConfirmed: true,
      consent: true,
    },
  });
  await page.goto('/account');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download your data and photos' }).click();
  expect((await download).suggestedFilename()).toBe('opencivic-account.zip');
  await page.getByRole('button', { name: 'Withdraw evidence consent' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Evidence consent withdrawn.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Restore evidence consent' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Evidence consent restored.', { exact: true })).toBeVisible();
});
