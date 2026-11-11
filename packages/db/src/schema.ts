import type { PartyVotes } from '@opencivic/shared';
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
  accreditedVoters: integer('accredited_voters').notNull(),
  rejectedBallots: integer('rejected_ballots').notNull(),
  partyVotes: jsonb('party_votes').$type<PartyVotes>().notNull(),
  consistencyWarnings: jsonb('consistency_warnings').$type<string[]>().notNull(),
  photoPath: text('photo_path'),
  photoPlaceholder: boolean('photo_placeholder').notNull().default(false),
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
});
