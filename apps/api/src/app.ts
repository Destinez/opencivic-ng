import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type AppDb, hashPassword, sessions, users, verifyPassword } from '@opencivic/db';
import {
  RESULTS_DISCLAIMER,
  loginSchema,
  registerSchema,
  roleChangeSchema,
} from '@opencivic/shared';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { mountBoardRoutes } from './board';
import { mountCaseRoutes } from './cases';
import { mountEvidenceRoutes } from './evidence';
import { errorBody, readJson, validation } from './http';
import { docsHtml, openApiDocument } from './openapi';
import {
  aggregateElection,
  countActiveAdmins,
  findUserByEmail,
  findUserBySession,
  getElection,
  getPollingUnit,
  getSubmissionRow,
  listAudit,
  listElections,
  listLgas,
  listStates,
  listSubmissions,
  listUsers,
  listWards,
  recordAudit,
  searchPollingUnits,
} from './queries';
import { LOGIN_LIMIT, REGISTER_LIMIT, REQUEST_LIMIT, createRateLimiter } from './rate-limit';
import { mountReferenceRoutes } from './references';
import {
  aggregateQuerySchema,
  auditQuerySchema,
  electionSlugSchema,
  emptyQuerySchema,
  identifierSchema,
  pollingUnitQuerySchema,
  queryValues,
} from './request-validation';
import { mountReviewRoutes } from './reviews';
import { mountSubmissionRoutes } from './submissions';

const COOKIE = 'oc_session';
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'observer' | 'reviewer' | 'desk' | 'admin';
};

export type AppDeps = {
  db: AppDb;
  uploadDir: string;
  webOrigins: string[];
  cookieSecure: boolean;
  rateLimit?: boolean;
};

export type AppEnv = { Variables: { user: SessionUser | null; requestId: string } };

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

let dummyHash: Promise<string> | null = null;
function timingPad() {
  dummyHash ??= hashPassword('opencivic-timing-pad');
  return dummyHash;
}

function clientKey(c: Context<AppEnv>): string {
  try {
    const info = getConnInfo(c);
    return info.remote.address ?? 'local';
  } catch {
    return 'local';
  }
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const takeRequest = createRateLimiter(deps.db);
  const limitsOn = deps.rateLimit !== false;

  async function limitRequest(
    c: Context<AppEnv>,
    key: string,
    policy: { max: number; windowMs: number },
  ) {
    if (!limitsOn) return;
    const result = await takeRequest(key, policy);
    c.header('RateLimit-Limit', String(result.limit));
    c.header('RateLimit-Remaining', String(result.remaining));
    c.header('RateLimit-Reset', String(result.retryAfter));
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter));
      return c.json(errorBody('rate_limited', 'Too many requests. Try again later.'), 429);
    }
  }

  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
    if (c.res.headers.get('content-type')?.includes('application/json')) {
      const response = c.res;
      const decoded = await response.json();
      const payload =
        decoded && typeof decoded === 'object' && !Array.isArray(decoded)
          ? (decoded as Record<string, unknown>)
          : { data: decoded };
      c.res = Response.json(
        {
          ...payload,
          official: false,
          disclaimer: payload.disclaimer ?? RESULTS_DISCLAIMER,
          requestId,
        },
        { status: response.status, headers: response.headers },
      );
    }
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Cache-Control', 'no-store');
  });

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return deps.webOrigins[0] ?? 'http://localhost:3000';
        return deps.webOrigins.includes(origin) ? origin : null;
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-Observer-Id'],
      exposeHeaders: [
        'Retry-After',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'X-Content-SHA256',
      ],
      maxAge: 600,
    }),
  );

  app.use('*', async (c, next) => {
    if (c.req.path !== '/health' && c.req.method !== 'OPTIONS') {
      const response = await limitRequest(c, `request:${clientKey(c)}`, REQUEST_LIMIT);
      if (response) return response;
    }
    if (c.req.url.length > 8192) {
      return c.json(errorBody('uri_too_long', 'The request URL is too long.'), 414);
    }
    const multipart =
      (c.req.path === '/v1/submissions' ||
        /^\/v1\/submissions\/[^/]+\/photo$/.test(c.req.path) ||
        c.req.path === '/v1/references') &&
      c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data');
    return bodyLimit({
      maxSize: multipart ? 2_100_000 : 65_536,
      onError: (context) =>
        context.json(errorBody('payload_too_large', 'The request body is too large.'), 413),
    })(c, next);
  });

  app.use('*', async (c, next) => {
    const token = getCookie(c, COOKIE);
    c.set('user', null);
    if (token) {
      const found = await findUserBySession(deps.db, tokenHash(token));
      if (found && !found.user.deletedAt && found.session.expiresAt.getTime() > Date.now()) {
        c.set('user', {
          id: found.user.id,
          email: found.user.email,
          name: found.user.name,
          role: found.user.role as SessionUser['role'],
        });
      }
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.json(errorBody('internal', 'Something went wrong.'), 500);
  });

  app.notFound((c) => c.json(errorBody('not_found', 'That path is not in the API.'), 404));

  function requireUser(c: { get: (key: 'user') => SessionUser | null }) {
    return c.get('user');
  }

  function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: deps.cookieSecure,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
  }

  async function startSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await deps.db.insert(sessions).values({
      id,
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
    });
    return token;
  }

  app.get('/health', (c) => c.json({ ok: true, service: 'opencivic-api' }));
  app.get('/v1/openapi.json', (c) => c.json(openApiDocument()));
  app.get('/docs', (c) => c.html(docsHtml()));

  app.get('/v1/states', async (c) => {
    const parsed = emptyQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!parsed.success) return validation(c, parsed.error);
    return c.json(await listStates(deps.db));
  });

  app.get('/v1/states/:stateId/lgas', async (c) => {
    const parsed = identifierSchema.safeParse(c.req.param('stateId'));
    if (!parsed.success) return validation(c, parsed.error);
    const query = emptyQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!query.success) return validation(c, query.error);
    const result = await listLgas(deps.db, parsed.data);
    if (!result) return c.json(errorBody('not_found', 'That state is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/lgas/:lgaId/wards', async (c) => {
    const parsed = identifierSchema.safeParse(c.req.param('lgaId'));
    if (!parsed.success) return validation(c, parsed.error);
    const query = emptyQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!query.success) return validation(c, query.error);
    const result = await listWards(deps.db, parsed.data);
    if (!result)
      return c.json(errorBody('not_found', 'That local government is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/polling-units', async (c) => {
    const parsed = pollingUnitQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!parsed.success) return validation(c, parsed.error);
    const result = await searchPollingUnits(deps.db, parsed.data);
    return c.json(result);
  });

  app.get('/v1/polling-units/:id', async (c) => {
    const parsed = identifierSchema.safeParse(c.req.param('id'));
    if (!parsed.success) return validation(c, parsed.error);
    const query = emptyQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!query.success) return validation(c, query.error);
    const result = await getPollingUnit(deps.db, parsed.data);
    if (!result)
      return c.json(errorBody('not_found', 'That polling unit is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/elections', async (c) => {
    const parsed = emptyQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!parsed.success) return validation(c, parsed.error);
    return c.json(await listElections(deps.db));
  });

  app.get('/v1/elections/:slug', async (c) => {
    const parsed = electionSlugSchema.safeParse(c.req.param('slug'));
    if (!parsed.success) return validation(c, parsed.error);
    const query = emptyQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!query.success) return validation(c, query.error);
    const result = await getElection(deps.db, parsed.data);
    if (!result)
      return c.json(errorBody('not_found', 'That election is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/aggregates', async (c) => {
    const parsed = aggregateQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!parsed.success) return validation(c, parsed.error);
    const { election, level, parentId } = parsed.data;
    const result = await aggregateElection(deps.db, election, level, parentId);
    if (result.missing)
      return c.json(
        errorBody('not_found', 'That election or parent area is not in this dataset.'),
        404,
      );
    return c.json({
      disclaimer: RESULTS_DISCLAIMER,
      official: false,
      coverageNote:
        'The unit count is the polling units loaded in this database. It is not the national INEC list. Only the newest approved observation for each unit is included.',
      election: result.election,
      level,
      parentId: parentId ?? null,
      rows: result.rows,
    });
  });

  app.post('/v1/auth/register', async (c) => {
    const response = await limitRequest(c, `register:${clientKey(c)}`, REGISTER_LIMIT);
    if (response) return response;
    const parsed = registerSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    const email = parsed.data.email.toLowerCase();
    const existing = await findUserByEmail(deps.db, email);
    if (existing && !existing.deletedAt) {
      return c.json(errorBody('conflict', 'An account with that email already exists.'), 409);
    }
    const now = new Date();
    const id = randomUUID();
    await deps.db.insert(users).values({
      id,
      email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      role: 'observer',
      consentAt: now,
      ageConfirmedAt: now,
    });
    await recordAudit(deps.db, {
      actorId: id,
      action: 'account.registered',
      entityType: 'user',
      entityId: id,
      metadata: { role: 'observer' },
    });
    const token = await startSession(id);
    setSessionCookie(c, token);
    return c.json({ id, email, name: parsed.data.name, role: 'observer' }, 201);
  });

  app.post('/v1/auth/login', async (c) => {
    const payload = await readJson(c);
    const email =
      typeof payload === 'object' &&
      payload !== null &&
      'email' in payload &&
      typeof payload.email === 'string'
        ? payload.email.trim().toLowerCase().slice(0, 160)
        : 'invalid';
    const response = await limitRequest(c, `login:${clientKey(c)}:${email}`, LOGIN_LIMIT);
    if (response) return response;
    const parsed = loginSchema.safeParse(payload);
    if (!parsed.success) return validation(c, parsed.error);
    const user = await findUserByEmail(deps.db, parsed.data.email.toLowerCase());
    const hash = user?.passwordHash ?? (await timingPad());
    const matches = await verifyPassword(parsed.data.password, hash);
    if (!user || user.deletedAt || !matches) {
      return c.json(errorBody('unauthenticated', 'Email or password is incorrect.'), 401);
    }
    const token = await startSession(user.id);
    await recordAudit(deps.db, {
      actorId: user.id,
      action: 'session.login',
      entityType: 'user',
      entityId: user.id,
      metadata: {},
    });
    setSessionCookie(c, token);
    return c.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  app.post('/v1/auth/logout', async (c) => {
    const token = getCookie(c, COOKIE);
    const user = requireUser(c);
    if (token) await deps.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
    if (user) {
      await recordAudit(deps.db, {
        actorId: user.id,
        action: 'session.logout',
        entityType: 'user',
        entityId: user.id,
        metadata: {},
      });
    }
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/v1/auth/me', (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    return c.json(user);
  });

  app.delete('/v1/auth/me', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role === 'admin' && (await countActiveAdmins(deps.db)) <= 1) {
      return c.json(errorBody('conflict', 'The last admin account cannot be deleted here.'), 409);
    }
    await deps.db
      .update(users)
      .set({
        name: 'Deleted account',
        email: `deleted-${user.id}@users.invalid`,
        passwordHash: 'deleted',
        deletedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await deps.db.delete(sessions).where(eq(sessions.userId, user.id));
    await recordAudit(deps.db, {
      actorId: user.id,
      action: 'account.deleted',
      entityType: 'user',
      entityId: user.id,
      metadata: {},
    });
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  mountSubmissionRoutes(app, deps, takeRequest);

  app.get('/v1/submissions/mine', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    const data = await listSubmissions(deps.db, { observerId: user.id });
    return c.json({ disclaimer: RESULTS_DISCLAIMER, official: false, data });
  });

  app.get('/v1/submissions/:id/photo', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    const row = await getSubmissionRow(deps.db, c.req.param('id'));
    if (!row?.photoPath)
      return c.json(errorBody('not_found', 'No photo is stored for that observation.'), 404);
    const allowed = user.role === 'reviewer' || user.role === 'admin' || user.id === row.observerId;
    if (!allowed)
      return c.json(errorBody('forbidden', 'That photo is not available to this account.'), 403);
    const file = resolve(row.photoPath);
    const root = resolve(deps.uploadDir);
    const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (file !== root && !file.startsWith(rootPrefix)) {
      return c.json(errorBody('not_found', 'No photo is stored for that observation.'), 404);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch {
      return c.json(errorBody('not_found', 'No photo is stored for that observation.'), 404);
    }
    c.header('Content-Type', mimeFor(extname(file)));
    c.header('X-Content-Type-Options', 'nosniff');
    if (row.photoPlaceholder) c.header('X-OpenCivic-Placeholder', 'true');
    return c.body(new Uint8Array(bytes));
  });

  mountReviewRoutes(app, deps);
  mountCaseRoutes(app, deps);
  mountBoardRoutes(app, deps);
  mountEvidenceRoutes(app, deps);
  mountReferenceRoutes(app, deps, takeRequest);

  app.get('/v1/admin/audit', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role !== 'admin')
      return c.json(errorBody('forbidden', 'The audit log is for admins.'), 403);
    const parsed = auditQuerySchema.safeParse(queryValues(c.req.queries()));
    if (!parsed.success) return validation(c, parsed.error);
    return c.json({ data: await listAudit(deps.db, parsed.data.limit) });
  });

  app.get('/v1/admin/users', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role !== 'admin')
      return c.json(errorBody('forbidden', 'Accounts are visible to admins.'), 403);
    return c.json({ data: await listUsers(deps.db) });
  });

  app.post('/v1/admin/users/:id/role', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role !== 'admin')
      return c.json(errorBody('forbidden', 'Only an admin can change roles.'), 403);
    const parsed = roleChangeSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    const targetId = c.req.param('id');
    if (targetId === user.id) {
      return c.json(errorBody('forbidden', 'You cannot change your own role.'), 403);
    }
    const targetRows = await deps.db.select().from(users).where(eq(users.id, targetId));
    const target = targetRows[0];
    if (!target || target.deletedAt)
      return c.json(errorBody('not_found', 'That account does not exist.'), 404);
    if (
      target.role === 'admin' &&
      parsed.data.role !== 'admin' &&
      (await countActiveAdmins(deps.db)) <= 1
    ) {
      return c.json(errorBody('conflict', 'The last admin cannot be demoted.'), 409);
    }
    await deps.db.update(users).set({ role: parsed.data.role }).where(eq(users.id, targetId));
    await recordAudit(deps.db, {
      actorId: user.id,
      action: 'account.role_changed',
      entityType: 'user',
      entityId: targetId,
      metadata: { role: parsed.data.role },
    });
    return c.json({ id: targetId, role: parsed.data.role });
  });

  return app;
}

function mimeFor(extension: string) {
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}
