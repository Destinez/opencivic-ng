import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  type AppDb,
  elections,
  hashPassword,
  pollingUnits,
  sessions,
  submissions,
  users,
  verifyPassword,
} from '@opencivic/db';
import {
  DATASET_DISCLAIMER,
  RESULTS_DISCLAIMER,
  consistencyWarnings,
  decisionSchema,
  loginSchema,
  parseSubmissionBody,
  registerSchema,
  roleChangeSchema,
} from '@opencivic/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { docsHtml, openApiDocument } from './openapi';
import {
  type QueueStatus,
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

const COOKIE = 'oc_session';
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: 'observer' | 'reviewer' | 'admin';
};

export type AppDeps = {
  db: AppDb;
  uploadDir: string;
  webOrigins: string[];
  cookieSecure: boolean;
  rateLimit?: boolean;
};

type AppEnv = { Variables: { user: SessionUser | null } };

function errorBody(code: string, message: string, details: unknown = null) {
  return { error: { code, message, details } };
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

let dummyHash: Promise<string> | null = null;
function timingPad() {
  dummyHash ??= hashPassword('opencivic-timing-pad');
  return dummyHash;
}

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  try {
    const info = getConnInfo(c as never);
    return info.remote.address ?? 'local';
  } catch {
    return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  }
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const hits = new Map<string, number[]>();
  const limitsOn = deps.rateLimit !== false;

  function limited(key: string, max: number, windowMs: number) {
    if (!limitsOn) return false;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= max) return true;
    recent.push(now);
    hits.set(key, recent);
    return false;
  }

  app.use('*', async (c, next) => {
    await next();
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
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );

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

  app.get('/v1/states', async (c) => c.json(await listStates(deps.db)));

  app.get('/v1/states/:stateId/lgas', async (c) => {
    const result = await listLgas(deps.db, c.req.param('stateId'));
    if (!result) return c.json(errorBody('not_found', 'That state is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/lgas/:lgaId/wards', async (c) => {
    const result = await listWards(deps.db, c.req.param('lgaId'));
    if (!result)
      return c.json(errorBody('not_found', 'That local government is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/polling-units', async (c) => {
    const q = c.req.query('q')?.trim();
    if (q && q.length < 2) {
      return c.json(errorBody('validation', 'Search needs at least 2 characters.'), 422);
    }
    const limit = clampInt(c.req.query('limit'), 20, 1, 100);
    const offset = clampInt(c.req.query('offset'), 0, 0, 5000);
    const result = await searchPollingUnits(deps.db, {
      q: q || undefined,
      stateId: c.req.query('stateId') || undefined,
      lgaId: c.req.query('lgaId') || undefined,
      wardId: c.req.query('wardId') || undefined,
      limit,
      offset,
    });
    return c.json(result);
  });

  app.get('/v1/polling-units/:id', async (c) => {
    const result = await getPollingUnit(deps.db, c.req.param('id'));
    if (!result)
      return c.json(errorBody('not_found', 'That polling unit is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/elections', async (c) => c.json(await listElections(deps.db)));

  app.get('/v1/elections/:slug', async (c) => {
    const result = await getElection(deps.db, c.req.param('slug'));
    if (!result)
      return c.json(errorBody('not_found', 'That election is not in this dataset.'), 404);
    return c.json(result);
  });

  app.get('/v1/aggregates', async (c) => {
    const election = c.req.query('election');
    const level = c.req.query('level');
    if (!election || (level !== 'state' && level !== 'lga' && level !== 'ward')) {
      return c.json(errorBody('validation', 'Pass election and level=state|lga|ward.'), 422);
    }
    const parentId = c.req.query('parentId') || undefined;
    if (level !== 'state' && !parentId) {
      return c.json(
        errorBody('validation', 'Pass parentId for a local government or ward rollup.'),
        422,
      );
    }
    const result = await aggregateElection(deps.db, election, level, parentId);
    if (result.missing)
      return c.json(errorBody('not_found', 'That election is not in this dataset.'), 404);
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
    if (limited(`register:${clientKey(c)}`, 5, 60 * 60 * 1000)) {
      return c.json(
        errorBody('rate_limited', 'Too many new accounts from this network. Try later.'),
        429,
      );
    }
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
    if (limited(`login:${clientKey(c)}`, 10, 15 * 60 * 1000)) {
      return c.json(errorBody('rate_limited', 'Too many sign-in attempts. Try later.'), 429);
    }
    const parsed = loginSchema.safeParse(await readJson(c));
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

  app.post('/v1/submissions', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    let payload: Record<string, unknown>;
    let photo: File | null = null;
    const contentType = c.req.header('content-type') ?? '';
    try {
      if (contentType.includes('multipart/form-data')) {
        const body = await c.req.parseBody({ all: true });
        const candidate = body.photo;
        if (candidate instanceof File && candidate.size > 0) photo = candidate;
        payload = body as Record<string, unknown>;
      } else {
        payload = (await c.req.json()) as Record<string, unknown>;
      }
    } catch {
      return c.json(errorBody('validation', 'The request body could not be read.'), 400);
    }
    let input: ReturnType<typeof parseSubmissionBody>;
    try {
      input = parseSubmissionBody(payload);
    } catch (error) {
      if (error instanceof z.ZodError) return validation(c, error);
      return c.json(errorBody('validation', 'Party votes must be JSON.'), 422);
    }
    const electionRows = await deps.db
      .select()
      .from(elections)
      .where(eq(elections.id, input.electionId));
    const election = electionRows[0];
    if (!election)
      return c.json(errorBody('not_found', 'That election is not in this dataset.'), 404);
    if (!election.acceptsSubmissions) {
      return c.json(
        errorBody(
          'election_closed',
          'This election is information only. The demonstration poll is the one that accepts observations.',
        ),
        409,
      );
    }
    const unitRows = await deps.db
      .select()
      .from(pollingUnits)
      .where(eq(pollingUnits.id, input.pollingUnitId));
    if (!unitRows[0])
      return c.json(errorBody('not_found', 'That polling unit is not in this dataset.'), 404);

    let photoPath: string | null = null;
    if (photo) {
      if (photo.size > 2_000_000) {
        return c.json(errorBody('payload_too_large', 'Photos must be 2 MB or smaller.'), 413);
      }
      const bytes = Buffer.from(await photo.arrayBuffer());
      const kind = sniffImage(bytes);
      if (!kind) {
        return c.json(errorBody('unsupported_media', 'Use a JPEG, PNG, or WebP image.'), 415);
      }
      await mkdir(deps.uploadDir, { recursive: true });
      photoPath = join(deps.uploadDir, `${randomUUID()}.${kind}`);
      await writeFile(photoPath, bytes);
    }

    const warnings = consistencyWarnings(input);
    const id = randomUUID();
    await deps.db.insert(submissions).values({
      id,
      electionId: election.id,
      pollingUnitId: input.pollingUnitId,
      observerId: user.id,
      accreditedVoters: input.accreditedVoters,
      rejectedBallots: input.rejectedBallots,
      partyVotes: input.partyVotes,
      consistencyWarnings: warnings,
      photoPath,
      photoPlaceholder: false,
      status: 'pending',
    });
    await recordAudit(deps.db, {
      actorId: user.id,
      action: 'submission.created',
      entityType: 'submission',
      entityId: id,
      metadata: {
        electionId: election.id,
        pollingUnitId: input.pollingUnitId,
        warnings,
        hasPhoto: Boolean(photoPath),
      },
    });
    return c.json(
      {
        id,
        status: 'pending',
        warnings,
        official: false,
        disclaimer: RESULTS_DISCLAIMER,
        datasetNotice: DATASET_DISCLAIMER,
      },
      201,
    );
  });

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

  app.get('/v1/review/submissions', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role === 'observer') {
      return c.json(errorBody('forbidden', 'The review queue is for reviewers and admins.'), 403);
    }
    const status = c.req.query('status') ?? 'pending';
    if (status !== 'pending' && status !== 'approved' && status !== 'flagged') {
      return c.json(errorBody('validation', 'Status must be pending, approved, or flagged.'), 422);
    }
    const data = await listSubmissions(deps.db, { status: status as QueueStatus });
    return c.json({ disclaimer: RESULTS_DISCLAIMER, official: false, data });
  });

  app.post('/v1/review/submissions/:id', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role === 'observer') {
      return c.json(errorBody('forbidden', 'The review queue is for reviewers and admins.'), 403);
    }
    const parsed = decisionSchema.safeParse(await readJson(c));
    if (!parsed.success) return validation(c, parsed.error);
    if (parsed.data.decision === 'flagged' && parsed.data.note.trim().length < 8) {
      return c.json(errorBody('validation', 'A flag needs a note of at least 8 characters.'), 422);
    }
    const row = await getSubmissionRow(deps.db, c.req.param('id'));
    if (!row) return c.json(errorBody('not_found', 'That observation does not exist.'), 404);
    if (row.observerId === user.id) {
      return c.json(errorBody('forbidden', 'You cannot review your own observation.'), 403);
    }
    if (row.status !== 'pending') {
      return c.json(errorBody('conflict', 'Only a pending observation can be decided.'), 409);
    }
    const updated = await deps.db
      .update(submissions)
      .set({
        status: parsed.data.decision,
        decisionNote: parsed.data.note.trim() || null,
        decidedBy: user.id,
        decidedAt: new Date(),
      })
      .where(and(eq(submissions.id, row.id), eq(submissions.status, 'pending')))
      .returning({ id: submissions.id });
    if (updated.length === 0) {
      return c.json(errorBody('conflict', 'Only a pending observation can be decided.'), 409);
    }
    await recordAudit(deps.db, {
      actorId: user.id,
      action: parsed.data.decision === 'approved' ? 'submission.approved' : 'submission.flagged',
      entityType: 'submission',
      entityId: row.id,
      metadata: { note: parsed.data.note.trim() || null },
    });
    return c.json({
      id: row.id,
      status: parsed.data.decision,
      official: false,
      disclaimer: RESULTS_DISCLAIMER,
    });
  });

  app.get('/v1/admin/audit', async (c) => {
    const user = requireUser(c);
    if (!user) return c.json(errorBody('unauthenticated', 'Sign in required.'), 401);
    if (user.role !== 'admin')
      return c.json(errorBody('forbidden', 'The audit log is for admins.'), 403);
    const limit = clampInt(c.req.query('limit'), 50, 1, 200);
    return c.json({ data: await listAudit(deps.db, limit) });
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

function clampInt(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function validation(c: { json: (body: unknown, status?: number) => Response }, error: z.ZodError) {
  return c.json(errorBody('validation', 'Check the form and try again.', error.flatten()), 422);
}

function sniffImage(bytes: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (
    bytes.length > 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function mimeFor(extension: string) {
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
}
