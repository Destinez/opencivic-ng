import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function expectNoSeriousAxeViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).exclude('.leaflet-container').analyze();
  const serious = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test('home, lookup, guidance, and tally are unofficial and readable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Find a polling unit');
  await expect(page.getByText(/does not announce official results/i).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole('link', { name: 'Find a polling unit' }).click();
  await page.getByLabel('Search polling units').fill('Ikeja GRA');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(/not an official INEC polling unit/i).first()).toBeVisible();
  await expect(page.getByText(/SAMPLE\/LA-IKE-01/).first()).toBeVisible();

  await page.goto('/elections/nigeria-2027-general');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('2027');
  await expect(page.getByText('16 January 2027').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'INEC election calendar' }).first()).toBeVisible();
  await expect(page.getByText('Unverified').first()).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.goto('/results?election=sample-demonstration-poll');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Unofficial');
  await expect(page.getByText(/3 of 18/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /winner/i })).toHaveCount(0);
});

test('a reviewer can open the queue', async ({ page }) => {
  await page.goto('/account');
  await page.locator('#sign-in-email').fill('chidi.bello@example.com');
  await page.locator('#sign-in-password').fill('reviewer-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.goto('/review');
  await expect(page.getByText('Victoria Island I sample unit 1')).toBeVisible();
  await expect(page.getByText('Needs a check')).toBeVisible();
});
