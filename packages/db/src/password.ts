import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 32;

type ScryptParams = { N: number; r: number; p: number; maxmem: number };

const PARAMS: ScryptParams = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptKey(password: string, salt: Buffer, keylen: number, options: ScryptParams) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptKey(password.normalize('NFKC'), salt, KEY_LEN, PARAMS);
  return [
    'scrypt',
    String(PARAMS.N),
    String(PARAMS.r),
    String(PARAMS.p),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;
  const key = await scryptKey(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}
