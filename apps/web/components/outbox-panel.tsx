'use client';

import { type OutboxEntry, changeDraft, listDrafts, removeDraft } from '@/lib/outbox';
import { syncOutbox } from '@/lib/outbox-sync';
import { useEffect, useState } from 'react';

export function OutboxPanel({ ownerId }: { ownerId: string }) {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    let active = true;
    let running = false;
    const refresh = async () => {
      const rows = await listDrafts(ownerId);
      if (active) setEntries(rows);
    };
    const send = async () => {
      if (running) return;
      running = true;
      try {
        await syncOutbox();
      } finally {
        running = false;
        await refresh();
      }
    };
    const changed = () => {
      void refresh();
    };
    const resume = () => {
      void send();
    };
    const channel = new BroadcastChannel('opencivic-outbox');
    channel.onmessage = changed;
    window.addEventListener('online', resume);
    window.addEventListener('opencivic-outbox', resume);
    const timer = setInterval(resume, 5000);
    void refresh();
    void send();
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(() => {
          if (active) setOfflineReady(true);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      clearInterval(timer);
      channel.close();
      window.removeEventListener('online', resume);
      window.removeEventListener('opencivic-outbox', resume);
    };
  }, [ownerId]);

  async function sendNow() {
    for (const entry of entries.filter(
      (item) => item.state !== 'sent' && item.state !== 'sending',
    )) {
      await changeDraft(entry.clientId, (current) => ({
        ...current,
        state: 'saved',
        attempts: 0,
        nextAttemptAt: 0,
        error: undefined,
      }));
    }
    window.dispatchEvent(new Event('opencivic-outbox'));
  }
  const waiting = entries.filter((entry) => entry.state !== 'sent').length;
  return (
    <section className="card outbox" aria-labelledby="outbox-title">
      <h2 id="outbox-title">On this phone</h2>
      <p className="muted">
        {offlineReady
          ? 'Ready for an offline reload.'
          : 'Open this page with a connection before going offline.'}
      </p>
      <output aria-live="polite">Saved on this phone — {waiting} waiting to send</output>
      {waiting > 0 ? (
        <button type="button" className="secondary" onClick={() => void sendNow()}>
          Send now
        </button>
      ) : null}
      <ul className="outbox-list">
        {entries.map((entry) => (
          <li key={entry.clientId} data-outbox-id={entry.clientId}>
            <strong>{entry.unitLabel}</strong>
            <p>
              <span className="badge">
                {entry.state === 'sent'
                  ? 'Sent ✓'
                  : entry.state === 'sending'
                    ? `Sending ${entry.phase === 'photo' ? 'photo' : 'figures'}…`
                    : entry.state === 'attention'
                      ? 'Needs attention'
                      : 'Saved on phone'}
              </span>
            </p>
            {entry.error ? <p className="alert">{entry.error}</p> : null}
            {entry.serverId ? <p className="muted">Receipt: {entry.serverId.slice(0, 8)}</p> : null}
            {entry.photo ? (
              <p className="muted">
                Photo: {Math.round(entry.sourceBytes / 1000)} KB →{' '}
                {Math.round(entry.photo.size / 1000)} KB. Location metadata removed.
              </p>
            ) : null}
            {entry.state === 'sent' ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void removeDraft(entry.clientId)
                    .then(() => listDrafts(ownerId))
                    .then(setEntries)
                }
              >
                Clear sent receipt
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
