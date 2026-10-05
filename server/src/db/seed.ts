import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { API_CONTRACT_SKILLS, TEST_QUALITY_SKILLS } from './seed-skills.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/** The L02 agent the seeded skills are linked to. */
const TEST_QUALITY_AGENT_NAME = 'Test Quality Reviewer';
/** The HW2 agent the API contract skills are linked to. */
const API_CONTRACT_AGENT_NAME = 'API Contract Reviewer';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures; a row that exists is never changed.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, PR #483 (partial refunds, a happy-path-only test — the
 * L02 skills control experiment, no review), PR #484 (refund validation + disputes:
 * subtle breaks under a minor bump — the HW2 API Contract control experiment,
 * no review), the five built-in agents (General + Security + Performance + Test
 * Quality + API Contract), all on the default openrouter/deepseek-v4-flash
 * provider+model, and seven skills (v1 snapshots): three linked to the Test
 * Quality Reviewer, four to the API Contract Reviewer.
 *
 * Each agent's skills are linked only in the run that creates that agent, so a reseed
 * (`scripts/dev.sh` seeds on every boot) never relinks a skill the user removed.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …) once
 * their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0, patch: DEMO_CONFIG_PATCH },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- PR #483 (partial refunds — the L02 skills control experiment) ----
  // Production code with several branches and a test that only covers the happy
  // path, so a Test Quality review with skills off vs on can be compared. Stored
  // patches only (no clone): `PrDiffSource` builds the diff from them. No review.
  const [refundsPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 483)));
  if (!refundsPr) {
    const files = REFUNDS_PR_FILES.map((f) => ({ path: f.path, patch: newFilePatch(f.lines) }));
    const additions = REFUNDS_PR_FILES.reduce((sum, f) => sum + f.lines.length, 0);
    const [created] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 483,
        title: 'Add partial refunds',
        author: 'dev.okafor',
        branch: 'feat/partial-refunds',
        base: 'main',
        headSha: 'b7c8d9e0f1a2',
        additions,
        deletions: 0,
        filesCount: files.length,
        status: 'needs_review',
        body: 'Lets support refund part of a settled charge. Adds `refundCharge` with idempotency keys, plus a unit test.',
      })
      .returning();

    await db.insert(t.prFiles).values(
      REFUNDS_PR_FILES.map((f, i) => ({
        prId: created!.id,
        path: f.path,
        additions: f.lines.length,
        deletions: 0,
        patch: files[i]!.patch,
      })),
    );

    await db.insert(t.prCommits).values({
      prId: created!.id,
      sha: 'b7c8d9e0f1a2',
      message: 'Add partial refunds with idempotency keys',
      author: 'dev.okafor',
    });
  }

  // ---- PR #484 (refund validation + disputes — the HW2 API Contract control experiment) ----
  // Breaks that read as improvements: narrower request validation, a new success
  // status, a nullable field and a new enum value in the response, a smaller default
  // page size, a bare @deprecated and only a minor version bump. Compares an API
  // Contract review with skills off vs on. Stored patches only (no clone), no review.
  const [contractPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 484)));
  if (!contractPr) {
    const files = CONTRACT_PR_FILES.map((f) => ({
      path: f.path,
      patch: f.patch.join('\n'),
      additions: changedLines(f.patch, '+'),
      deletions: changedLines(f.patch, '-'),
    }));
    const [created] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 484,
        title: 'Harden refund validation and support disputed charges',
        author: 'lena.berg',
        branch: 'feat/refund-validation-disputes',
        base: 'main',
        headSha: 'd5e6f7a8b9c0',
        additions: files.reduce((sum, f) => sum + f.additions, 0),
        deletions: files.reduce((sum, f) => sum + f.deletions, 0),
        filesCount: files.length,
        status: 'needs_review',
        body: 'Validates refund currencies and idempotency keys properly, processes refunds asynchronously, adds the disputed charge status and guest-checkout charges without a customer, and makes charge list pages lighter. Bumps the version to 2.4.0.',
      })
      .returning();

    await db.insert(t.prFiles).values(files.map((f) => ({ prId: created!.id, ...f })));

    await db.insert(t.prCommits).values({
      prId: created!.id,
      sha: 'd5e6f7a8b9c0',
      message: 'Harden refund validation, support disputed charges',
      author: 'lena.berg',
    });
  }

  // ---- built-in agents (3 starter presets + L02 Test Quality + HW2 API Contract) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: TEST_QUALITY_AGENT_NAME,
      description:
        'Checks test quality: uncovered branches, missed corner cases, over-mocking and flaky tests.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: API_CONTRACT_AGENT_NAME,
      description:
        'Flags breaking API changes: removed or renamed routes and fields, changed response shapes, version bumps that understate a break, and removals with no deprecation.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  /** Agents inserted by THIS run (name → id); an existing agent is left alone. */
  const createdAgents = new Map<string, string>();
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) {
      const [row] = await db.insert(t.agents).values(a).returning({ id: t.agents.id });
      createdAgents.set(a.name, row!.id);
    }
  }

  // ---- built-in skills (L02 + HW2; mirrored in docs/agent-skills/*.md) ----
  /** Each agent's seeded skills, in its prompt order. */
  const seedSkillSets = [
    { agentName: TEST_QUALITY_AGENT_NAME, skills: TEST_QUALITY_SKILLS },
    { agentName: API_CONTRACT_AGENT_NAME, skills: API_CONTRACT_SKILLS },
  ];
  for (const { agentName, skills } of seedSkillSets) {
    // A skill is created with its v1 snapshot when no skill of that name exists.
    const skillIds: string[] = [];
    for (const skill of skills) {
      const [existing] = await db
        .select({ id: t.skills.id })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skill.name)));
      if (existing) {
        skillIds.push(existing.id);
        continue;
      }
      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(t.skills)
          .values({
            workspaceId,
            name: skill.name,
            description: skill.description,
            type: skill.type,
            source: 'manual',
            body: skill.body,
            enabled: true,
            version: 1,
          })
          .returning({ id: t.skills.id });
        await tx.insert(t.skillVersions).values({
          skillId: row!.id,
          version: 1,
          name: skill.name,
          description: skill.description,
          type: skill.type,
          body: skill.body,
          note: 'Created',
        });
        return row!.id;
      });
      skillIds.push(id);
    }

    // Link them only when this run created the agent: a reseed must not relink a
    // skill the user unlinked (or re-enable one they switched off).
    const agentId = createdAgents.get(agentName);
    if (agentId) {
      await db
        .insert(t.agentSkills)
        .values(
          skillIds.map((skillId, order) => ({
            agentId,
            skillId,
            order,
            enabled: true,
          })),
        )
        .onConflictDoNothing();
    }
  }

  return { workspaceId, userId };
}

/**
 * The one seeded patch: without it the demo PR has no reviewable text (no clone
 * → `PrDiffSource` falls back to `pr_files.patch`), so a review fails before the
 * model is called. The hermetic e2e review flow depends on it.
 */
const DEMO_CONFIG_PATCH = [
  '@@ -8,6 +8,10 @@ export const config = {',
  "   port: Number(process.env.PORT ?? 3000),",
  "   logLevel: process.env.LOG_LEVEL ?? 'info',",
  "   corsOrigin: process.env.CORS_ORIGIN ?? '*',",
  '+  rateLimit: {',
  '+    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),',
  '+    max: Number(process.env.RATE_LIMIT_MAX ?? 100),',
  '+  },',
  '   database: {',
  '     url: process.env.DATABASE_URL,',
  '   },',
].join('\n');

/** A new file's patch: one hunk adding every line (`@@ -0,0 +1,N @@`). */
function newFilePatch(lines: readonly string[]): string {
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n');
}

/** The number of lines a patch adds (`+`) or removes (`-`); hunk headers start with `@@`. */
function changedLines(patch: readonly string[], sign: '+' | '-'): number {
  return patch.filter((l) => l.startsWith(sign)).length;
}

/**
 * PR #483's files. `src/refunds.ts` branches on an invalid amount, a reused
 * idempotency key, a missing or unsettled charge, a currency mismatch and an
 * amount over what is left, and returns full vs partial status;
 * `test/refunds.test.ts` only runs the happy path, mocks every collaborator,
 * asserts only on mock calls and waits with a real `setTimeout`.
 */
const REFUNDS_PR_FILES: ReadonlyArray<{ path: string; lines: readonly string[] }> = [
  {
    path: 'src/refunds.ts',
    lines: [
      "import { db } from './db';",
      "import { gateway } from './gateway';",
      '',
      "export type RefundStatus = 'partially_refunded' | 'refunded';",
      '',
      'export class RefundError extends Error {}',
      '',
      'export interface RefundRequest {',
      '  chargeId: string;',
      '  amountCents: number;',
      '  currency: string;',
      '  idempotencyKey: string;',
      '}',
      '',
      'export async function refundCharge(',
      '  req: RefundRequest,',
      '): Promise<{ refundId: string; status: RefundStatus }> {',
      '  if (!Number.isInteger(req.amountCents) || req.amountCents <= 0) {',
      "    throw new RefundError('Refund amount must be a positive number of cents');",
      '  }',
      '  const previous = await db.refunds.findByIdempotencyKey(req.idempotencyKey);',
      '  if (previous) {',
      '    return { refundId: previous.id, status: previous.status };',
      '  }',
      '  const charge = await db.charges.get(req.chargeId);',
      '  if (!charge) {',
      '    throw new RefundError(`Charge ${req.chargeId} not found`);',
      '  }',
      "  if (charge.status !== 'settled') {",
      '    throw new RefundError(`Charge ${charge.id} is not settled yet`);',
      '  }',
      '  if (charge.currency !== req.currency) {',
      '    throw new RefundError(`Refund currency ${req.currency} does not match ${charge.currency}`);',
      '  }',
      '  const remaining = charge.amountCents - charge.refundedCents;',
      '  if (req.amountCents > remaining) {',
      '    throw new RefundError(`Only ${remaining} cents are left to refund`);',
      '  }',
      '  const refund = await gateway.refund(charge.id, req.amountCents, req.idempotencyKey);',
      "  const status: RefundStatus = req.amountCents === remaining ? 'refunded' : 'partially_refunded';",
      '  await db.charges.update(charge.id, { refundedCents: charge.refundedCents + req.amountCents });',
      '  await db.refunds.insert({ id: refund.id, chargeId: charge.id, idempotencyKey: req.idempotencyKey, status });',
      '  return { refundId: refund.id, status };',
      '}',
    ],
  },
  {
    path: 'test/refunds.test.ts',
    lines: [
      "import { describe, it, expect, vi } from 'vitest';",
      "import { refundCharge } from '../src/refunds';",
      "import { db } from '../src/db';",
      "import { gateway } from '../src/gateway';",
      '',
      "vi.mock('../src/db', () => ({",
      '  db: {',
      '    refunds: { findByIdempotencyKey: vi.fn().mockResolvedValue(null), insert: vi.fn() },',
      '    charges: {',
      '      get: vi.fn().mockResolvedValue({',
      "        id: 'ch_1',",
      "        status: 'settled',",
      "        currency: 'usd',",
      '        amountCents: 5000,',
      '        refundedCents: 0,',
      '      }),',
      '      update: vi.fn(),',
      '    },',
      '  },',
      '}));',
      "vi.mock('../src/gateway', () => ({",
      "  gateway: { refund: vi.fn().mockResolvedValue({ id: 're_1' }) },",
      '}));',
      '',
      "describe('refundCharge', () => {",
      "  it('refunds part of a settled charge', async () => {",
      "    const result = refundCharge({ chargeId: 'ch_1', amountCents: 1500, currency: 'usd', idempotencyKey: 'key-1' });",
      '    await new Promise((resolve) => setTimeout(resolve, 50));',
      "    expect(gateway.refund).toHaveBeenCalledWith('ch_1', 1500, 'key-1');",
      '    expect(db.charges.update).toHaveBeenCalled();',
      '    await result;',
      '  });',
      '});',
    ],
  },
];

/**
 * PR #484's patches. Each break looks like an improvement: `src/api/public/refunds.ts`
 * narrows `currency` to upper-case ISO codes and `idempotency_key` to UUIDs and
 * answers 202 instead of 201; `src/api/public/charges.ts` makes `customer_id`
 * nullable, adds `disputed` to the `status` enum, marks `refunded` with a bare
 * `@deprecated` and drops the default page size from 50 to 20; `package.json` and
 * `CHANGELOG.md` ship it all as a minor release (2.3.1 → 2.4.0) with no breaking notes.
 */
const CONTRACT_PR_FILES: ReadonlyArray<{ path: string; patch: readonly string[] }> = [
  {
    path: 'src/api/public/refunds.ts',
    patch: [
      "@@ -5,17 +5,17 @@ import { refundCharge } from '../../refunds';",
      ' const CreateRefundBody = z.object({',
      '   charge_id: z.string(),',
      '   amount: z.number().int().positive(),',
      '-  currency: z.string().length(3),',
      '-  idempotency_key: z.string().min(1),',
      "+  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, upper case'),",
      '+  idempotency_key: z.string().uuid(),',
      ' });',
      ' ',
      ' export async function refundsRoutes(app: FastifyInstance) {',
      "   app.post('/v1/refunds', async (req, reply) => {",
      '     const body = CreateRefundBody.parse(req.body);',
      '     const refund = await refundCharge({',
      '       chargeId: body.charge_id,',
      '       amountCents: body.amount,',
      '       currency: body.currency,',
      '       idempotencyKey: body.idempotency_key,',
      '     });',
      '-    return reply.code(201).send({ id: refund.refundId, status: refund.status });',
      '+    return reply.code(202).send({ id: refund.refundId, status: refund.status });',
    ],
  },
  {
    path: 'src/api/public/charges.ts',
    patch: [
      '@@ -6,20 +6,21 @@ export const Charge = z.object({',
      '   id: z.string(),',
      '   amount: z.number().int(),',
      '   currency: z.string(),',
      '-  customer_id: z.string(),',
      "-  status: z.enum(['pending', 'settled', 'failed']),",
      '+  customer_id: z.string().nullable(),',
      "+  status: z.enum(['pending', 'settled', 'failed', 'disputed']),",
      '+  /** @deprecated */',
      '   refunded: z.boolean(),',
      ' });',
      ' ',
      ' const ListQuery = z.object({',
      '-  limit: z.coerce.number().int().min(1).max(100).default(50),',
      '+  limit: z.coerce.number().int().min(1).max(100).default(20),',
      '   starting_after: z.string().optional(),',
      ' });',
      ' ',
      ' function toCharge(row: ChargeRow): z.infer<typeof Charge> {',
      '   return {',
      '     id: row.id,',
      '     amount: row.amountCents,',
      '     currency: row.currency,',
      '-    customer_id: row.customerId,',
      '+    customer_id: row.customerId ?? null,',
      '     status: row.status,',
    ],
  },
  {
    path: 'package.json',
    patch: [
      '@@ -1,6 +1,6 @@',
      ' {',
      '   "name": "@acme/payments-api",',
      '-  "version": "2.3.1",',
      '+  "version": "2.4.0",',
      '   "description": "Acme payments public API",',
      '   "type": "module",',
      '   "main": "dist/server.js",',
    ],
  },
  {
    path: 'CHANGELOG.md',
    patch: [
      '@@ -1,4 +1,10 @@',
      ' # Changelog',
      ' ',
      '+## 2.4.0',
      '+',
      '+- Charges can be `disputed`, and guest-checkout charges have no customer.',
      '+- Refund requests are validated more strictly and processed asynchronously.',
      '+- Charge lists return 20 items per page by default.',
      '+',
      ' ## 2.3.1',
      ' ',
    ],
  },
];

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
