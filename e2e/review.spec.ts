import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { sampleSheetPng } from '../packages/db/src/placeholder-png';
import { emptyVotes } from '../packages/shared/src/parties';

test('reviewers claim, compare and independently verify a sample reference', async ({
  page,
}, testInfo) => {
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'ada.okonkwo@example.com', password: 'observer-demo-pass' },
  });
  const observation = await page.request.post('/backend/v1/submissions', {
    data: {
      clientId: randomUUID(),
      capturedAt: '2027-02-20T12:00:00Z',
      electionId: 'election-sample-poll',
      pollingUnitId: `sample-ward-lagos-ikeja-gra-pu-${testInfo.retry ? 2 : 3}`,
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
  await expect(page.getByText('⚠ Differs by 30', { exact: true })).toBeVisible();
  await page.getByLabel('Decision note').fill('The two documents show different APC figures.');
  await page.getByRole('button', { name: 'Discrepancy likely', exact: true }).click();
  await expect(page.getByText('Decision recorded.', { exact: false })).toBeVisible();
  const check = await new AxeBuilder({ page }).analyze();
  expect(
    check.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
  await page
    .getByLabel('Case summary')
    .fill('The sample APC figures differ by thirty votes between the documents.');
  await page.getByRole('button', { name: 'Open discrepancy case', exact: true }).click();
  await expect(page).toHaveURL(/\/cases\//);
  const caseUrl = page.url();
  await page
    .getByLabel('Decision note')
    .fill('Checking both sample documents and the source reference.');
  await page.getByRole('button', { name: 'Start investigation' }).click();
  await expect(page.getByText('Case decision saved.')).toBeVisible();
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'zainab.ali@example.com', password: 'reviewer-two-demo-pass' },
  });
  await page.goto(`/review/${id}`);
  await page.getByRole('button', { name: 'Verify reference transcription' }).click();
  await expect(page.getByText('Reference verified independently.')).toBeVisible();
  await page.goto(caseUrl);
  await page
    .getByLabel('Decision note')
    .fill('Independently checked the sample documents and confirmed the difference.');
  await page.getByRole('button', { name: 'Confirm and publish' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Case decision saved.')).toBeVisible();
  await page.request.post('/backend/v1/auth/logout');
  await page.reload();
  await expect(page.getByRole('paragraph').filter({ hasText: /Status: published/ })).toBeVisible();
  await expect(page.getByText('Ada Okonkwo', { exact: false })).toHaveCount(0);
  const published = await new AxeBuilder({ page }).analyze();
  expect(
    published.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
  await expect(
    page.getByRole('img', { name: 'Result sheet supplied by the observer' }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download evidence pack' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^case-.+-v1\.zip$/);
  expect(await download.failure()).toBeNull();
  await page.request.post('/backend/v1/auth/login', {
    data: { email: 'femi.adeyemi@example.com', password: 'desk-demo-pass' },
  });
  await page.goto('/cases');
  await page.getByLabel('State', { exact: true }).selectOption('sample-state-lagos');
  await page.getByLabel('Local government area').selectOption('sample-lga-lagos-ikeja');
  await page.getByLabel('Case status').selectOption('all');
  await expect(page.locator(`a.button[href="${new URL(caseUrl).pathname}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Show case map' }).click();
  await expect(page.locator('.case-pin').first()).toBeVisible();
  const board = await new AxeBuilder({ page }).analyze();
  expect(
    board.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact ?? '')),
  ).toEqual([]);
});
