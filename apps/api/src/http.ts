import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError, ZodTypeAny, output } from 'zod';
import type { AppEnv, SessionUser } from './app';

export function errorBody(code: string, message: string, details: unknown = null) {
  return { error: { code, message, details } };
}

export function reject(
  code: string,
  message: string,
  status: ContentfulStatusCode = 422,
  details: unknown = null,
): never {
  throw new HTTPException(status, {
    res: Response.json(errorBody(code, message, details), { status }),
  });
}

export function parse<T extends ZodTypeAny>(schema: T, value: unknown): output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    reject('validation', 'Check the request fields and try again.', 422, result.error.flatten());
  return result.data;
}

export function requireRole(c: Context<AppEnv>, roles: SessionUser['role'][]) {
  const user = c.get('user');
  if (!user) reject('unauthenticated', 'Sign in required.', 401);
  if (!roles.includes(user.role))
    reject('forbidden', 'This account cannot perform that action.', 403);
  return user;
}

export async function readJson(c: Context<AppEnv>): Promise<unknown> {
  if (c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    reject('unsupported_media', 'Use Content-Type: application/json.', 415);
  }
  try {
    return await c.req.json();
  } catch {
    reject('validation', 'The request body must be valid JSON.', 400);
  }
}

export function validation(c: Context<AppEnv>, error: ZodError) {
  return c.json(
    errorBody('validation', 'Check the request fields and try again.', error.flatten()),
    422,
  );
}
