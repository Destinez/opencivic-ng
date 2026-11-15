import { createHash } from 'node:crypto';
import {
  caseItems,
  discrepancyCases,
  elections,
  lgas,
  pollingUnits,
  states,
  wards,
} from '@opencivic/db';
import { datasetNotice } from '@opencivic/shared';
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps, AppEnv } from './app';
import { parse, reject } from './http';
import { identifierSchema, queryValues } from './request-validation';

const boardQuery = z
  .object({
    election: identifierSchema.optional(),
    state: identifierSchema.optional(),
    lga: identifierSchema.optional(),
    severity: z.enum(['info', 'warn', 'critical']).optional(),
    status: z
      .enum([
        'published',
        'retracted',
        'under_investigation',
        'confirmed',
        'open',
        'explained',
        'dismissed',
        'all',
      ])
      .default('published'),
    page_token: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(1000)
      .optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(50))
      .default('20'),
  })
  .strict();
const tokenSchema = z
  .object({ at: z.string().datetime(), id: identifierSchema, filter: z.string().length(64) })
  .strict();

export function mountBoardRoutes(app: Hono<AppEnv>, deps: AppDeps) {
  app.get('/v1/cases', async (c) => {
    const query = parse(boardQuery, queryValues(c.req.queries()));
    const user = c.get('user');
    const staff = user && ['reviewer', 'desk', 'admin'].includes(user.role);
    const drafts = user?.role === 'reviewer' || user?.role === 'admin';
    if (
      (!staff && !['published', 'retracted'].includes(query.status)) ||
      (!drafts && query.status === 'open')
    )
      reject('forbidden', 'This case status is not available to this account.', 403);
    const { page_token, ...filters } = query;
    const filter = createHash('sha256')
      .update(JSON.stringify({ ...filters, scope: drafts ? 'review' : staff ? 'desk' : 'public' }))
      .digest('hex');
    let after: z.infer<typeof tokenSchema> | undefined;
    if (page_token) {
      let value: unknown;
      try {
        value = JSON.parse(Buffer.from(page_token, 'base64url').toString());
      } catch {
        reject('validation', 'The page token is invalid.');
      }
      after = parse(tokenSchema, value);
      if (after.filter !== filter)
        reject('validation', 'Use a page token with the same filters and account access.');
    }
    const conditions = [
      query.election
        ? or(eq(elections.id, query.election), eq(elections.slug, query.election))
        : undefined,
      query.state ? eq(states.id, query.state) : undefined,
      query.lga ? eq(lgas.id, query.lga) : undefined,
      query.severity ? eq(discrepancyCases.severity, query.severity) : undefined,
      query.status === 'published'
        ? inArray(discrepancyCases.status, ['published', 'retracted'])
        : query.status === 'all'
          ? drafts
            ? undefined
            : ne(discrepancyCases.status, 'open')
          : eq(discrepancyCases.status, query.status),
      !staff ? isNotNull(discrepancyCases.publishedAt) : undefined,
      after
        ? sql`(${discrepancyCases.createdAt}, ${discrepancyCases.id}) < (${after.at}::timestamptz, ${after.id})`
        : undefined,
    ];
    const rows = await deps.db
      .select({
        id: discrepancyCases.id,
        status: discrepancyCases.status,
        severity: discrepancyCases.severity,
        summary: discrepancyCases.summary,
        createdAt: discrepancyCases.createdAt,
        publishedAt: discrepancyCases.publishedAt,
        pageTime: sql<string>`to_char(${discrepancyCases.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        unitId: pollingUnits.id,
        unitName: pollingUnits.name,
        code: pollingUnits.code,
        dataset: pollingUnits.dataset,
        latitude: pollingUnits.latitude,
        longitude: pollingUnits.longitude,
        stateId: states.id,
        stateName: states.name,
        lgaId: lgas.id,
        lgaName: lgas.name,
        flags: sql<
          Array<{ rule: string; field: string; severity: string }>
        >`(SELECT coalesce(jsonb_agg(i.snapshot->'flag' ORDER BY i.flag_id), '[]'::jsonb) FROM case_items i WHERE i.case_id = ${discrepancyCases.id})`,
      })
      .from(discrepancyCases)
      .innerJoin(elections, eq(elections.id, discrepancyCases.electionId))
      .innerJoin(pollingUnits, eq(pollingUnits.id, discrepancyCases.pollingUnitId))
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .innerJoin(states, eq(states.id, lgas.stateId))
      .where(and(...conditions))
      .orderBy(desc(discrepancyCases.createdAt), desc(discrepancyCases.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return c.json({
      data: page.map(
        ({
          pageTime,
          unitId,
          unitName,
          code,
          dataset,
          latitude,
          longitude,
          stateId,
          stateName,
          lgaId,
          lgaName,
          ...record
        }) => ({
          ...record,
          pollingUnit: {
            id: unitId,
            name: unitName,
            code,
            dataset,
            datasetNotice: datasetNotice(dataset === 'sample' ? 'sample' : 'imported'),
            latitude,
            longitude,
            state: { id: stateId, name: stateName },
            lga: { id: lgaId, name: lgaName },
          },
        }),
      ),
      nextPageToken:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ at: last.pageTime, id: last.id, filter })).toString(
              'base64url',
            )
          : null,
    });
  });

  app.get('/v1/polling-units/:id/sheetmatch', async (c) => {
    const id = parse(identifierSchema, c.req.param('id'));
    const query = parse(
      z.object({ election: identifierSchema }).strict(),
      queryValues(c.req.queries()),
    );
    const [unit] = await deps.db
      .select({ id: pollingUnits.id })
      .from(pollingUnits)
      .where(eq(pollingUnits.id, id));
    if (!unit) reject('not_found', 'That polling unit does not exist.', 404);
    const rows = await deps.db
      .select({
        id: discrepancyCases.id,
        status: discrepancyCases.status,
        severity: discrepancyCases.severity,
        summary: discrepancyCases.summary,
        publishedAt: discrepancyCases.publishedAt,
        flags: sql<number>`(SELECT count(*)::int FROM ${caseItems} WHERE ${caseItems.caseId} = ${discrepancyCases.id})`,
      })
      .from(discrepancyCases)
      .innerJoin(elections, eq(elections.id, discrepancyCases.electionId))
      .where(
        and(
          eq(discrepancyCases.pollingUnitId, id),
          or(eq(elections.id, query.election), eq(elections.slug, query.election)),
          isNotNull(discrepancyCases.publishedAt),
        ),
      )
      .orderBy(desc(discrepancyCases.publishedAt));
    return c.json({
      data: rows,
      counts: {
        published: rows.filter((row) => row.status === 'published').length,
        retracted: rows.filter((row) => row.status === 'retracted').length,
        flags: rows.reduce((sum, row) => sum + row.flags, 0),
      },
    });
  });
}
