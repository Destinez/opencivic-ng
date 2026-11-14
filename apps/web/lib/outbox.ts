import type { SubmissionInput } from '@opencivic/shared/validation';

export type OutboxEntry = {
  clientId: string;
  ownerId: string;
  unitLabel: string;
  input: SubmissionInput;
  photo: Blob | null;
  sourceBytes: number;
  createdAt: number;
  state: 'saved' | 'sending' | 'sent' | 'attention';
  phase: 'figures' | 'photo' | 'done';
  attempts: number;
  nextAttemptAt: number;
  serverId?: string;
  error?: string;
  leaseToken?: string;
  leaseUntil?: number;
};

let database: Promise<IDBDatabase> | undefined;
function notify() {
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('opencivic-outbox');
    channel.postMessage('changed');
    channel.close();
  }
}
function open() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('opencivic-outbox', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('outbox', { keyPath: 'clientId' });
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('meta').objectStore('meta').get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function setMeta(key: string, value: unknown) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    if (value === undefined) tx.objectStore('meta').delete(key);
    else tx.objectStore('meta').put(value, key);
    tx.oncomplete = () => {
      notify();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function listDrafts(ownerId: string): Promise<OutboxEntry[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('outbox').objectStore('outbox').getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as OutboxEntry[])
          .filter((entry) => entry.ownerId === ownerId)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(entry: OutboxEntry) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').put(entry);
    tx.oncomplete = () => {
      notify();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function changeDraft(
  id: string,
  change: (entry: OutboxEntry) => OutboxEntry | undefined,
): Promise<OutboxEntry | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    const request = store.get(id);
    let result: OutboxEntry | undefined;
    request.onsuccess = () => {
      if (request.result) result = change(request.result as OutboxEntry);
      if (result) store.put(result);
    };
    tx.oncomplete = () => {
      if (result) notify();
      resolve(result);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeDraft(id: string) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
