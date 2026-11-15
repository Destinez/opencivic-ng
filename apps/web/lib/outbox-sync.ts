import { type OutboxEntry, changeDraft, getMeta, listDrafts, setMeta } from './outbox';

const backoff = (attempt: number) => Math.min(300_000, 5000 * 2 ** Math.max(0, attempt - 1));

export async function syncOutbox(): Promise<void> {
  if (!navigator.onLine) return;
  if (await getMeta<boolean>('syncPaused')) return;
  const owner = await getMeta<{ id: string }>('activeUser');
  if (!owner) return;
  const due = (await listDrafts(owner.id)).filter(
    (entry) =>
      entry.state !== 'sent' &&
      entry.state !== 'attention' &&
      entry.nextAttemptAt <= Date.now() &&
      (entry.leaseUntil ?? 0) <= Date.now(),
  );
  if (!due.length) return;
  let session: { id?: string } | undefined;
  try {
    const response = await fetch('/backend/v1/auth/me', {
      credentials: 'include',
      cache: 'no-store',
    });
    if (response.ok) session = (await response.json()) as { id: string };
    else if (response.status >= 500) return;
  } catch {
    return;
  }
  if (session?.id !== owner.id) {
    for (const entry of due)
      await changeDraft(entry.clientId, (current) => ({
        ...current,
        state: 'attention',
        error: 'Sign in with the account that saved this observation.',
      }));
    return;
  }
  let deviceId = await getMeta<string>('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await setMeta('deviceId', deviceId);
  }
  for (const candidate of due) {
    const entry = await changeDraft(candidate.clientId, (current) => {
      if (
        current.ownerId !== owner.id ||
        current.state === 'sent' ||
        current.state === 'attention' ||
        (current.leaseUntil ?? 0) > Date.now()
      )
        return undefined;
      return {
        ...current,
        state: 'sending',
        attempts: current.attempts + 1,
        leaseUntil: Date.now() + 60_000,
        leaseToken: crypto.randomUUID(),
        error: undefined,
      };
    });
    if (!entry) continue;
    const update = (patch: Partial<OutboxEntry>) =>
      changeDraft(entry.clientId, (current) =>
        current.leaseToken === entry.leaseToken ? { ...current, ...patch } : undefined,
      );
    try {
      if (!entry.serverId) {
        const response = await fetch('/backend/v1/submissions', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-observer-id': owner.id,
            'x-device-id': deviceId,
          },
          body: JSON.stringify(entry.input),
        });
        const data = await readResponse(response);
        if (typeof data.id !== 'string') throw new Error('The receipt was not received.');
        entry.serverId = data.id;
        await update({ serverId: data.id, phase: entry.photo ? 'photo' : 'done' });
      }
      if (entry.photo) {
        const form = new FormData();
        form.set('photo', entry.photo, 'sheet.jpg');
        await readResponse(
          await fetch(`/backend/v1/submissions/${entry.serverId}/photo`, {
            method: 'POST',
            credentials: 'include',
            body: form,
          }),
        );
      }
      await update({ state: 'sent', phase: 'done', photo: null, error: undefined, leaseUntil: 0 });
    } catch (error) {
      const failure = error as Error & { permanent?: boolean; retryAfter?: number };
      const attention = failure.permanent || entry.attempts >= 20;
      await update({
        state: attention ? 'attention' : 'saved',
        error: failure.message || 'Waiting for a connection.',
        nextAttemptAt: Date.now() + Math.max(backoff(entry.attempts), failure.retryAfter ?? 0),
        leaseUntil: 0,
      });
    }
  }
}

async function readResponse(response: Response): Promise<{ id?: string }> {
  const data = (await response.json()) as { id?: string; error?: { message?: string } };
  if (response.ok) return data;
  const retry = response.headers.get('retry-after');
  throw Object.assign(new Error(data.error?.message ?? 'The observation could not be sent.'), {
    permanent: response.status < 500 && (response.status !== 429 || !retry),
    retryAfter: retry ? Number(retry) * 1000 : 0,
  });
}
