import { type Page, expect, test } from '@playwright/test';

async function shot(page: Page, name: string) {
  await page.addStyleTag({ content: '.site-header { position: relative !important; }' });
  await page.screenshot({
    path: `docs/screenshots/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/account');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
  }
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test('desktop lookup, map, guidance, tally, submission, and review', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto('/lookup?q=Ikeja+GRA');
  await expect(page.getByText(/SAMPLE\/LA-IKE-01/).first()).toBeVisible();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  await shot(page, 'lookup-desktop');

  await page.goto(
    '/lookup?state=sample-state-lagos&lga=sample-lga-lagos-ikeja&ward=sample-ward-lagos-ikeja-gra',
  );
  await expect(
    page.getByRole('region', { name: 'Map of polling units in the current list' }),
  ).toBeVisible();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  await shot(page, 'map-desktop');

  await page.goto('/elections/nigeria-2027-general');
  await expect(page.getByText('Unverified').first()).toBeVisible();
  await shot(page, 'election-desktop');

  await page.goto('/results?election=sample-demonstration-poll');
  await expect(page.getByText(/3 of 18/).first()).toBeVisible();
  await shot(page, 'aggregate-desktop');

  await signIn(page, 'ada.okonkwo@example.com', 'observer-demo-pass');
  await page.goto('/results/new?pollingUnitId=sample-ward-lagos-ikeja-gra-pu-1');
  await expect(page.getByText(/Ikeja GRA sample unit 1/)).toBeVisible();
  await page.getByLabel('Accredited voters').fill('120');
  await shot(page, 'submit-desktop');

  await signIn(page, 'chidi.bello@example.com', 'reviewer-demo-pass');
  await page.goto('/review');
  await expect(page.getByText('Needs a check')).toBeVisible();
  await shot(page, 'review-desktop');
});

test('mobile lookup, map, guidance, tally, submission, and review', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/lookup?q=Ikeja+GRA');
  await expect(page.getByText(/SAMPLE\/LA-IKE-01/).first()).toBeVisible();
  await shot(page, 'lookup-mobile');

  await page.goto(
    '/lookup?state=sample-state-lagos&lga=sample-lga-lagos-ikeja&ward=sample-ward-lagos-ikeja-gra',
  );
  await page.getByRole('button', { name: 'Show map' }).click();
  await expect(
    page.getByRole('region', { name: 'Map of polling units in the current list' }),
  ).toBeVisible();
  await page.locator('.leaflet-tile-loaded').first().waitFor();
  await shot(page, 'map-mobile');

  await page.goto('/elections/nigeria-2027-general');
  await expect(page.getByText('Unverified').first()).toBeVisible();
  await shot(page, 'election-mobile');

  await page.goto('/results?election=sample-demonstration-poll');
  await expect(page.getByText(/3 of 18/).first()).toBeVisible();
  await shot(page, 'aggregate-mobile');

  await signIn(page, 'ada.okonkwo@example.com', 'observer-demo-pass');
  await page.goto('/results/new?pollingUnitId=sample-ward-lagos-ikeja-gra-pu-1');
  await expect(page.getByText(/Ikeja GRA sample unit 1/)).toBeVisible();
  await shot(page, 'submit-mobile');

  await signIn(page, 'chidi.bello@example.com', 'reviewer-demo-pass');
  await page.goto('/review');
  await expect(page.getByText('Needs a check')).toBeVisible();
  await shot(page, 'review-mobile');
});
