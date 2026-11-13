import type { PartyVotes } from '@opencivic/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export type Source = { label: string; url: string };

export const states = pgTable('states', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  dataset: text('dataset').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
});

export const lgas = pgTable('lgas', {
  id: text('id').primaryKey(),
  stateId: text('state_id').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  dataset: text('dataset').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
});

export const wards = pgTable('wards', {
  id: text('id').primaryKey(),
  lgaId: text('lga_id').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  dataset: text('dataset').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
});

export const pollingUnits = pgTable('polling_units', {
  id: text('id').primaryKey(),
  wardId: text('ward_id').notNull(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  address: text('address').notNull(),
  dataset: text('dataset').notNull(),
  coordinateKind: text('coordinate_kind').notNull(),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  registeredVoters: integer('registered_voters'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const elections = pgTable('elections', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  fictional: boolean('fictional').notNull(),
  acceptsSubmissions: boolean('accepts_submissions').notNull(),
  heldOn: date('held_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const electionDates = pgTable('election_dates', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull(),
  label: text('label').notNull(),
  occursOn: date('occurs_on'),
  detail: text('detail').notNull(),
  unverified: boolean('unverified').notNull(),
  sources: jsonb('sources').$type<Source[]>().notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const guidanceBlocks = pgTable('guidance_blocks', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull(),
  topic: text('topic').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  bullets: jsonb('bullets').$type<string[]>().notNull(),
  unverified: boolean('unverified').notNull(),
  sources: jsonb('sources').$type<Source[]>().notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  ageConfirmedAt: timestamp('age_confirmed_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const submissions = pgTable('submissions', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull(),
  pollingUnitId: text('polling_unit_id').notNull(),
  observerId: text('observer_id'),
  clientId: uuid('client_id'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  accreditedVoters: integer('accredited_voters').notNull(),
  rejectedBallots: integer('rejected_ballots').notNull(),
  partyVotes: jsonb('party_votes').$type<PartyVotes>().notNull(),
  consistencyWarnings: jsonb('consistency_warnings').$type<string[]>().notNull(),
  photoPath: text('photo_path'),
  photoPlaceholder: boolean('photo_placeholder').notNull().default(false),
  photoSha256: text('photo_sha256'),
  photoPhash: text('photo_phash'),
  photoBytes: integer('photo_bytes'),
  declaredTotalVotes: integer('declared_total_votes'),
  totalVotes: integer('total_votes').generatedAlwaysAs(
    sql.raw(
      `${['ADC', 'APC', 'APGA', 'LP', 'NNPP', 'PDP', 'SDP', 'YPP', 'others']
        .map((party) => `coalesce((party_votes->>'${party}')::integer, 0)`)
        .join(' + ')} + rejected_ballots`,
    ),
  ),
  claimedBy: text('claimed_by'),
  claimedUntil: timestamp('claimed_until', { withTimezone: true }),
  status: text('status').notNull(),
  decisionNote: text('decision_note'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull(),
  prevHash: text('prev_hash').notNull().default(''),
  hash: text('hash').notNull().default(''),
});

export const submissionReviews = pgTable('submission_reviews', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  submissionId: text('submission_id').notNull(),
  reviewerId: text('reviewer_id').notNull(),
  decision: text('decision').notNull(),
  reasonCode: text('reason_code'),
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const referenceRecords = pgTable('reference_records', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull(),
  pollingUnitId: text('polling_unit_id').notNull(),
  source: text('source').notNull(),
  sourceUrl: text('source_url').notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  imagePath: text('image_path').notNull(),
  imageSha256: text('image_sha256').notNull(),
  accreditedVoters: integer('accredited_voters').notNull(),
  rejectedBallots: integer('rejected_ballots').notNull(),
  partyVotes: jsonb('party_votes').$type<PartyVotes>().notNull(),
  declaredTotalVotes: integer('declared_total_votes'),
  transcribedBy: text('transcribed_by').notNull(),
  verifiedBy: text('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  dataset: text('dataset').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const discrepancyFlags = pgTable('discrepancy_flags', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull(),
  pollingUnitId: text('polling_unit_id').notNull(),
  submissionId: text('submission_id').notNull(),
  referenceId: text('reference_id'),
  rule: text('rule').notNull(),
  field: text('field').notNull(),
  observed: integer('observed').notNull(),
  expected: integer('expected').notNull(),
  severity: text('severity').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const discrepancyCases = pgTable('discrepancy_cases', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull(),
  pollingUnitId: text('polling_unit_id').notNull(),
  status: text('status').notNull(),
  severity: text('severity').notNull(),
  openedBy: text('opened_by').notNull(),
  confirmedBy: text('confirmed_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  retractionRequestedBy: text('retraction_requested_by'),
  retractedBy: text('retracted_by'),
  retractionNote: text('retraction_note'),
});

export const caseItems = pgTable('case_items', {
  caseId: text('case_id').notNull(),
  flagId: text('flag_id').notNull(),
});

export const caseComments = pgTable('case_comments', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull(),
  authorId: text('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const observerProfiles = pgTable('observer_profiles', {
  userId: text('user_id').primaryKey(),
  trustLevel: integer('trust_level').notNull().default(0),
  accreditationRef: text('accreditation_ref'),
  approvedCount: integer('approved_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  homeStateId: text('home_state_id'),
  frozen: boolean('frozen').notNull().default(false),
});

export const evidencePacks = pgTable('evidence_packs', {
  caseId: text('case_id').notNull(),
  version: integer('version').notNull(),
  manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
  sha256: text('sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
});
