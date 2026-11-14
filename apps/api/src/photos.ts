import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { reject } from './http';

export async function processPhoto(photo: File) {
  if (photo.size > 2_000_000) reject('payload_too_large', 'Photos must be 2 MB or smaller.', 413);
  if (!photo.size) reject('validation', 'Choose a photo.');
  const input = Buffer.from(await photo.arrayBuffer());
  let bytes: Buffer;
  try {
    const source = sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' });
    const metadata = await source.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
      reject('unsupported_media', 'Use a single JPEG, PNG, or WebP sheet image.', 415);
    }
    bytes = await source
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch {
    reject(
      'unsupported_media',
      'The photo could not be decoded. Use a JPEG, PNG, or WebP image.',
      415,
    );
  }
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    phash: await perceptualHash(bytes),
  };
}

async function perceptualHash(bytes: Buffer): Promise<string> {
  const pixels = await sharp(bytes).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
  const coefficients: number[] = [];
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      for (let x = 0; x < 32; x += 1) {
        for (let y = 0; y < 32; y += 1) {
          sum +=
            (pixels[y * 32 + x] ?? 0) *
            Math.cos(((2 * x + 1) * u * Math.PI) / 64) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 64);
        }
      }
      coefficients.push(sum);
    }
  }
  const median = [...coefficients.slice(1)].sort((a, b) => a - b)[31] ?? 0;
  let hash = 0n;
  for (const [index, coefficient] of coefficients.entries())
    hash = (hash << 1n) | (index > 0 && coefficient > median ? 1n : 0n);
  return hash.toString(16).padStart(16, '0');
}

export async function storePhoto(
  directory: string,
  id: string,
  photo: Awaited<ReturnType<typeof processPhoto>>,
) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${id}-${photo.sha256}.jpg`);
  await writeFile(path, photo.bytes);
  return path;
}
