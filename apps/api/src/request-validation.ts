import { z } from 'zod';

export const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Use a dataset ID, not a polling-unit code.');

export const electionSlugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use an election slug.');

function integerQuery(fallback: number, min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/, 'Use a whole number.')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(String(fallback));
}

export const pollingUnitQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[^\p{Cc}]+$/u)
      .optional(),
    stateId: identifierSchema.optional(),
    lgaId: identifierSchema.optional(),
    wardId: identifierSchema.optional(),
    limit: integerQuery(20, 1, 100),
    offset: integerQuery(0, 0, 5000),
  })
  .strict();

export const aggregateQuerySchema = z
  .object({
    election: electionSlugSchema,
    level: z.enum(['state', 'lga', 'ward']),
    parentId: identifierSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.level === 'state' ? value.parentId !== undefined : !value.parentId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parentId'],
        message:
          'Omit parentId for state totals; pass a state ID for lga totals or an LGA ID for ward totals.',
      });
    }
  });

export const auditQuerySchema = z.object({ limit: integerQuery(50, 1, 200) }).strict();
export const reviewQuerySchema = z
  .object({
    status: z
      .enum(['pending', 'in_review', 'approved', 'flagged', 'rejected', 'superseded', 'withdrawn'])
      .default('pending'),
  })
  .strict();
export const emptyQuerySchema = z.object({}).strict();

export function queryValues(queries: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(queries).map(([key, values]) => [key, values.length === 1 ? values[0] : values]),
  );
}
