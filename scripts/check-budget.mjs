import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const directory = new URL('../apps/web/.next/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('app-build-manifest.json', directory), 'utf8'));
const observer = manifest.pages['/results/new/page'];
if (!observer?.length) throw new Error('Build the observer page before checking its budget.');
const files = new Set([...observer, ...(manifest.pages['/layout'] ?? [])]);
let bytes = gzipSync(readFileSync(new URL('../apps/web/public/sw.js', import.meta.url))).length;
for (const file of files)
  if (file.endsWith('.js')) bytes += gzipSync(readFileSync(new URL(file, directory))).length;
const limit = 200 * 1024;
console.log(
  `Observer JavaScript: ${(bytes / 1024).toFixed(1)} KiB gzip, including the service worker; limit 200 KiB.`,
);
if (bytes > limit) process.exitCode = 1;
