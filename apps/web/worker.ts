/// <reference lib="webworker" />
import { syncOutbox } from './lib/outbox-sync';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cacheName = 'opencivic-public-shell-v1';
const shell = [
  '/results/new',
  '/elections',
  '/elections/sample-demonstration-poll',
  '/icon.svg',
  '/manifest.webmanifest',
];

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(shell);
      const page = await cache.match('/results/new');
      const html = (await page?.text()) ?? '';
      const assets = [...html.matchAll(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+)"/g)]
        .map((match) => match[1] ?? '')
        .filter(Boolean);
      await cache.addAll([...new Set(assets)]);
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('opencivic-public-shell-') && key !== cacheName)
          await caches.delete(key);
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin) return;
  const isAsset = url.pathname.startsWith('/_next/static/');
  const isShell =
    request.mode === 'navigate' &&
    (url.pathname === '/results/new' || url.pathname.startsWith('/elections'));
  const isPublicData = /^\/backend\/v1\/(elections|polling-units|states|lgas)(\/|$)/.test(
    url.pathname,
  );
  if (!isAsset && !isShell && !isPublicData) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (isAsset && cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (
          cached ??
          (isShell ? await cache.match('/results/new') : undefined) ??
          new Response('Offline. Open this page once with a connection.', { status: 503 })
        );
      }
    })(),
  );
});

worker.addEventListener('sync', ((event: ExtendableEvent & { tag: string }) => {
  if (event.tag === 'opencivic-outbox') event.waitUntil(syncOutbox());
}) as EventListener);
