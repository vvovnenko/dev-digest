import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  numeric,
  index,
  check,
} from 'drizzle-orm/pg-core';
import type { IntentSource } from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';
import { agentRuns } from './runs';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** The agent_run that produced this review (links the timeline run ↔ review); deleting the run deletes it. */
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // The PR list and the Review runs tab read a PR's reviews newest first.
    prCreatedIdx: index('reviews_pr_created_idx').on(t.prId, t.createdAt.desc()),
    runIdx: index('reviews_run_idx').on(t.runId),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    /** The reviewer flagged it as outside the PR intent (kept when tag-only or the one CRITICAL signal). */
    outOfScope: boolean('out_of_scope').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    reviewIdx: index('findings_review_idx').on(t.reviewId),
    severityCk: check('findings_severity_ck', sql`${t.severity} in ('CRITICAL', 'WARNING', 'SUGGESTION')`),
    confidenceCk: check('findings_confidence_ck', sql`${t.confidence} between 0 and 1`),
  }),
);

/**
 * One row per PR. The result columns (`intent` … `derivedAt`) belong to the last
 * successful derive; `status`, `error`, `jobId`, the model, usage and the two
 * request/finish times belong to the latest attempt. A failed re-derive keeps the result.
 */
export const prIntent = pgTable(
  'pr_intent',
  {
    prId: uuid('pr_id')
      .primaryKey()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The intent summary; null until a derive succeeds. */
    intent: text('intent'),
    inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] }).notNull().default('done'),
    error: text('error'),
    /** The `jobs` row that runs it (no FK: jobs are operational rows). */
    jobId: uuid('job_id'),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }),
    sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
    missingContext: jsonb('missing_context').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    headSha: text('head_sha'),
    /** sha256 of the normalized title + description at derive time; null = never compared. */
    inputHash: text('input_hash'),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: numeric('cost_usd', { mode: 'number' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    derivedAt: timestamp('derived_at', { withTimezone: true }),
  },
  (t) => ({
    statusCk: check('pr_intent_status_ck', sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
    confidenceCk: check('pr_intent_confidence_ck', sql`${t.confidence} in ('high', 'medium', 'low')`),
  }),
);

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
