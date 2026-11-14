import { sampleSheetPng } from '../../../packages/db/src/placeholder-png';
import { submissionBody, type testApp } from './test-utils';

export type TestSetup = Awaited<ReturnType<typeof testApp>>;
export function caseRequest(
  setup: TestSetup,
  path: string,
  cookie: string,
  body?: unknown,
  method = 'POST',
) {
  return setup.app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function prepareCase(setup: TestSetup) {
  const observer = await setup.login();
  const reviewer = await setup.login('reviewer');
  const second = await setup.login('reviewer2');
  const send = (path: string, cookie: string, body?: unknown, method?: string) =>
    caseRequest(setup, path, cookie, body, method);
  const created = await send('/v1/submissions', observer, submissionBody());
  const sheet = (await created.json()) as { id: string };
  if (!sheet.id) throw new Error(`Submission setup failed: ${created.status}`);
  const form = new FormData();
  form.set('photo', new File([sampleSheetPng()], 'sample.png', { type: 'image/png' }));
  await setup.app.request(`/v1/submissions/${sheet.id}/photo`, {
    method: 'POST',
    headers: { cookie: observer },
    body: form,
  });
  await send(`/v1/review/submissions/${sheet.id}/claim`, reviewer);
  await send(`/v1/review/submissions/${sheet.id}`, reviewer, {
    decision: 'flagged',
    reasonCode: 'document_mismatch',
    note: 'The APC figures differ between these two sample documents.',
  });
  const detail = (await (
    await setup.app.request(`/v1/review/submissions/${sheet.id}`, { headers: { cookie: reviewer } })
  ).json()) as { flags: Array<{ id: string; rule: string }> };
  const flagIds = detail.flags
    .filter((flag: { rule: string }) => flag.rule !== 'duplicate_image')
    .map((flag: { id: string }) => flag.id) as string[];
  const input = {
    flagIds,
    summary: 'The sample observer and reference documents disagree on APC figures.',
  };
  const open = async () => {
    const result = await send('/v1/cases', reviewer, input);
    const data = (await result.json()) as { id: string };
    if (result.status !== 201)
      throw new Error(`Case setup failed: ${result.status} ${JSON.stringify(data)}`);
    return data.id;
  };
  const transition = (
    id: string,
    to: string,
    cookie = reviewer,
    note = 'Checked the two documents and their provenance.',
  ) => send(`/v1/cases/${id}/transition`, cookie, { to, note });
  const verify = () =>
    send('/v1/references/sample-reference-ikeja-gra/verify', second, undefined, 'PATCH');
  const publish = async () => {
    const id = await open();
    await transition(id, 'under_investigation');
    await verify();
    const result = await transition(id, 'confirmed', second);
    if (result.status !== 200) throw new Error(`Publication failed: ${result.status}`);
    return id;
  };
  return {
    observer,
    reviewer,
    second,
    sheetId: sheet.id,
    flagIds,
    input,
    send,
    open,
    transition,
    verify,
    publish,
  };
}
