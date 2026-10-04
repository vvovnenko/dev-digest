import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  vector,
  index,
  integer,
  numeric,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error_handling',
  'async',
  'typing',
  'imports',
  'testing',
  'formatting',
  'other',
] as const;

/**
 * Convention candidates of a repo (HW2 Conventions Extractor). `status` is the
 * source of truth; `accepted` is kept in sync (`status = 'accepted'`) for the
 * plugin export contract. `fingerprint` is the normalised rule as the model first
 * wrote it, so a re-scan never re-adds a rule the user already accepted or
 * rejected, even after an inline edit.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    category: text('category', { enum: CONVENTION_CATEGORIES }).notNull().default('other'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceStartLine: integer('evidence_start_line'),
    evidenceEndLine: integer('evidence_end_line'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    accepted: boolean('accepted').notNull().default(false),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    fingerprint: text('fingerprint'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    wsRepoIdx: index('conventions_ws_repo_idx').on(t.workspaceId, t.repoId),
    repoFingerprintUq: uniqueIndex('conventions_repo_fingerprint_uq').on(t.repoId, t.fingerprint),
    statusCk: check('conventions_status_ck', sql`${t.status} in ('pending', 'accepted', 'rejected')`),
    confidenceCk: check('conventions_confidence_ck', sql`${t.confidence} between 0 and 1`),
  }),
);

/**
 * One `POST /repos/:id/conventions/extract` run, executed as a background job:
 * its status, what was sampled, which model, what survived. The partial unique
 * index allows one `queued`/`running` scan per repo.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    // Rows from before scans became jobs were all finished, hence the default.
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('done'),
    error: text('error'),
    /** The `jobs` row that runs it (no FK: jobs are operational rows). */
    jobId: uuid('job_id'),
    sampleFiles: jsonb('sample_files').$type<string[]>().notNull().default([]),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: numeric('cost_usd', { mode: 'number' }),
    candidatesFound: integer('candidates_found').notNull().default(0),
    candidatesKept: integer('candidates_kept').notNull().default(0),
    /** Candidates that failed the evidence check: `{ rule, reason }[]`. */
    dropped: jsonb('dropped').$type<{ rule: string; reason: string }[]>().notNull().default([]),
    createdAt: now(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    repoCreatedIdx: index('convention_scans_repo_created_idx').on(t.repoId, t.createdAt.desc()),
    repoActiveUq: uniqueIndex('convention_scans_repo_active_uq')
      .on(t.repoId)
      .where(sql`status in ('queued', 'running')`),
    statusCk: check('convention_scans_status_ck', sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
  }),
);
