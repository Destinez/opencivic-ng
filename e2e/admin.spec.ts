import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
test('an admin documents observer trust and can inspect abuse signals with a keyboard', async ({
  page,
}) => {
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'amina.yusuf@example.com', password: 'admin-demo-pass' },
  });
  await page.goto('/admin/observers');
  await expect(
    page.getByRole('heading', { name: 'Observer trust and abuse review' }),
  ).toBeVisible();
  await page.getByLabel('Trust level for Ada Okonkwo', { exact: true }).selectOption('2');
  await page.getByLabel('Accreditation reference for Ada Okonkwo').fill('SAMPLE/verified-observer');
  await page
    .getByLabel('Trust decision note for Ada Okonkwo')
    .fill('Checked the fictional observer accreditation.');
  await page.getByRole('button', { name: 'Save trust for Ada Okonkwo' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Change saved in the audit log.')).toBeVisible();
  const check = await new AxeBuilder({ page }).analyze();
  expect(
    check.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
  await page.request.post('/backend/v1/auth/logout');
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Sign in required.' })).toBeVisible();
  await expect(page.getByText('ada.okonkwo@example.com', { exact: true })).toHaveCount(0);
});
