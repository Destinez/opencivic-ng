import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { sampleSheetPng } from '../packages/db/src/placeholder-png';
import { emptyVotes } from '../packages/shared/src/parties';

test('reviewers claim, compare and independently verify a sample reference', async ({ page }) => {
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'ada.okonkwo@example.com', password: 'observer-demo-pass' },
  });
  const observation = await page.request.post('/backend/v1/submissions', {
    data: {
      clientId: randomUUID(),
      capturedAt: '2027-02-20T12:00:00Z',
      electionId: 'election-sample-poll',
      pollingUnitId: 'sample-ward-lagos-ikeja-gra-pu-3',
      accreditedVoters: 120,
      rejectedBallots: 2,
      partyVotes: { ...emptyVotes(), APC: 112 },
      declaration: true,
    },
  });
  expect(observation.status()).toBe(201);
  const { id } = await observation.json();
  await page.request.post(`/backend/v1/submissions/${id}/photo`, {
    multipart: { photo: { name: 'sample.png', mimeType: 'image/png', buffer: sampleSheetPng() } },
  });
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'chidi.bello@example.com', password: 'reviewer-demo-pass' },
  });
  await page.goto(`/review/${id}`);
  await expect(page.getByText('⚠ Differs by 30', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Claim this sheet' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Claim saved for ten minutes.')).toBeVisible();
  await page.getByText('Attach a reference record', { exact: true }).click();
  await page.getByLabel('Reference APC', { exact: true }).fill('142');
  await page
    .getByLabel('Reference sheet photo')
    .setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: sampleSheetPng() });
  await page.getByRole('button', { name: 'Attach reference', exact: true }).click();
  await expect(
    page.getByText('Reference attached. A different reviewer must verify it.'),
  ).toBeVisible();
  await page.getByLabel('Decision note').fill('The two documents show different APC figures.');
  await page.getByRole('button', { name: 'Discrepancy likely', exact: true }).click();
  await expect(page.getByText('Decision recorded.', { exact: false })).toBeVisible();
  const check = await new AxeBuilder({ page }).analyze();
  expect(
    check.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'zainab.ali@example.com', password: 'reviewer-two-demo-pass' },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Verify reference transcription' }).click();
  await expect(page.getByText('Reference verified independently.')).toBeVisible();
});
