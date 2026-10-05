# Persistence and transactions (Drizzle 0.45 + Postgres)

## Contents
- A repository implements a port
- Rows, contracts and mappers
- Transactions: three patterns
- External calls and transactions
- Version notes (Drizzle 0.45, not v1)

Query syntax (joins, `onConflictDoUpdate`, relations) belongs to `drizzle-orm-patterns`;
table design to `postgresql-table-design`. This file covers where persistence code sits
and where the transaction boundary goes.

## A repository implements a port

Every module but repo-intel has one; `modules/pulls/repository.ts` is the fullest.

```ts
// modules/pulls/repository.ts:1-52 (abridged, as of the list query) — the only file in the module that imports Drizzle
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullRecord, PullRepoRef } from './domain.js';
import type { PullStore } from './ports.js';

const repoRef = { id: t.repos.id, owner: t.repos.owner, name: t.repos.name };

export class PullsRepository implements PullStore {
  constructor(private db: Db) {}

  async repoInWorkspace(workspaceId: string, repoId: string): Promise<PullRepoRef | undefined> {
    const [repo] = await this.db
      .select(repoRef)
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return repo;
  }

  async listForRepo(repoId: string): Promise<PullRecord[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId)); // the row is a PullRecord
  }

  async saveDiffStats(prId: string, stats: { additions: number; deletions: number; filesCount: number }) {
    await this.db.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, prId));
  }
  // … upsertFromGitHub (one insert … onConflictDoUpdate), rollups, replaceDetail (a transaction)
}
```

Rules:
- `implements` the port, so a signature drift is a type error, not a runtime surprise.
- Scope every query by `workspaceId`, unless the id was already resolved inside that
  workspace by the same use case (as `repoId` above after `repoInWorkspace`).
- Name methods for the need ("runs still active for this pull request"), not the table
  (A2, A3). One repository per module (or aggregate), not one per table (T10).
- Large repositories split into `repository/<entity>.repo.ts` functions behind one
  facade class, as `reviews/repository.ts` does.
- Repositories throw nothing domain-specific: return `undefined`/`null` and let the
  service throw `NotFoundError`. That matches the current code.
- pgvector similarity SQL and raw `sql\`…\`` stay inside the repository.

## Rows, contracts and mappers

- A `$inferSelect` row never crosses a port. `db/rows.ts` types are for repositories and
  `src/db/**` only (F4: "don't pass database rows" across a boundary).
- If the row and the contract/domain type are the same shape, return the row typed as
  that type and don't write a mapper (A4). `modules/reviews/domain.ts` declares the
  records a run works with (`ReviewPull`, `ReviewRecord`, `FindingRecord`, …); the Drizzle
  rows satisfy them structurally, so `ReviewRepository implements ReviewStore`
  (`modules/reviews/repository.ts:29`) with no mapping layer. Map when the shapes differ
  (snake_case contract vs camelCase row, dates → ISO strings, JSON columns): a pure
  mapper over the domain record (`toPrMeta` in `pulls/domain.ts`, `toAgentDto` in
  `agents/helpers.ts`), or in the repository (N4).
- Never reuse a `drizzle-zod` schema as an HTTP contract: contracts live in
  `@devdigest/shared` and change deliberately.

## Transactions: three patterns

Anything you add or change that writes twice must be atomic. Pick the first pattern
that fits (T7, T9, T10). The repo has real examples of (a) and (b); (c) is not needed yet.
The index writes in `repo-intel/repository.ts` are still not atomic (do-not-touch).

**(a) One repository method = one consistency boundary.** The port method describes the
whole change; the repository wraps it.

```ts
// reviews/repository/run.repo.ts:199-223 — run row, review, findings, sha and trace
// commit together; the status guard makes a concurrent cancel win
export async function completeRunWithReview(db: Db, runId: string, input: …) {
  return db.transaction(async (tx) => {
    const claimed = await tx.update(t.agentRuns).set({ status: 'done', ...input.run, error: null })
      .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
      .returning({ id: t.agentRuns.id });
    if (claimed.length === 0) return null;
    const review = await insertReview(tx, { ...input.review, runId });
    const findings = await insertFindings(tx, review.id, input.findings);
    await markReviewed(tx, input.review.prId, input.reviewedSha);
    await saveRunTrace(tx, runId, input.trace);
    return { review, findings };
  });
}
```

Inside a repository, the per-entity helpers take `DbExecutor` (`Db | Tx`,
`src/db/client.ts:8-11`) so they can join the transaction. The facade method
(`ReviewRepository.completeRunWithReview(runId, input)`) never exposes it.

**(b) `update(id, fn)` when the decision needs the current row.** The repository locks
and loads, the domain function decides, the repository writes: all in one transaction,
and the domain rule stays out of the repository. In the repo:
`agents/repository.ts:274-305` `replaceSkills(workspaceId, agentId, change)` has exactly
this shape (`select … .for('update')`, `linksChanged` from `agents/domain.ts`, then the
links, the version bump and the snapshot); `update` (`:104-144`) locks the same way.
`test/agents-versions.it.test.ts` proves it: concurrent edits get distinct versions, and
a failed skills replace rolls back.

```ts
// ports.ts — illustration of the next step (the real AgentStore.update takes a patch)
export interface AgentStore {
  update(workspaceId: string, id: string, change: (current: Agent) => AgentChange): Promise<Agent | undefined>;
}

// repository.ts
async update(workspaceId: string, id: string, change: (current: Agent) => AgentChange) {
  return this.db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .for('update');
    if (!row) return undefined;
    const { next, snapshot } = change(toAgent(row));
    const [saved] = await tx.update(t.agents).set(toAgentValues(next)).where(eq(t.agents.id, id)).returning();
    if (snapshot) await tx.insert(t.agentVersions).values(toVersionValues(saved!));
    return toAgent(saved!);
  });
}

// service.ts
await this.deps.agents.update(workspaceId, id, (current) => applyAgentPatch(current, patch));
```

**(c) A unit-of-work port when one use case spans several stores.** The service asks for
atomicity without seeing Drizzle; the composition root implements it.

```ts
// ports.ts
export interface ReviewStores { reviews: ReviewStore; runs: RunStore }
export interface UnitOfWork {
  run<T>(work: (stores: ReviewStores) => Promise<T>): Promise<T>;
}

// db/client.ts:8-11 — already there
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Tx;

// platform/container.ts (composition root)
unitOfWork: UnitOfWork = {
  run: (work) => this.db.transaction((tx) =>
    work({ reviews: new ReviewRepository(tx), runs: new RunRepository(tx) })),
};
```

Repositories used this way take a `DbExecutor` in the constructor. Don't thread an
optional `tx` argument through every port method (the Sentry variant, T9): it puts a
Drizzle type into port signatures, which `onion-ports-pure` forbids. Never pass `tx`
implicitly through `AsyncLocalStorage` or a request context (T10).

## External calls and transactions

- Never call an LLM, GitHub, git, the filesystem or the SSE bus inside
  `db.transaction`. A slow or failing call holds row locks and a pool connection
  (`createDb` uses `max: 10`, `src/db/client.ts:24`), and a rollback cannot undo the side effect.
- Order: fetch from the outside → one short transaction for all writes → emit
  (`RunEvents.publish`) and enqueue (`JobQueue.enqueue`) after it commits.
- `JobRunner.enqueue` writes the `jobs` row outside your transaction; enqueue after
  commit, so a job never runs against data that was rolled back.

## Version notes (Drizzle 0.45, not v1)

- orm.drizzle.team now documents v1 (T8). On 0.45 keep `relations()` and callback-style
  relational `where`/`orderBy`, and the separate `drizzle-zod` package.
- `db.transaction(async (tx) => …)`, `tx.rollback()`, nested transactions (savepoints)
  and `.for('update')` are all available in 0.45 (`node_modules/drizzle-orm/pg-core`).
- Since 0.44 a failed query throws `DrizzleQueryError` with the driver's error in `cause`:
  match Postgres codes (`23505`, a constraint name) on the `cause` chain, as
  `reviews/repository/run.repo.ts` `isUniqueViolation` does.
- Money is `numeric('…', { mode: 'number' })`: exact in the database, a `number` in JS;
  sum it in SQL (`sum(...).mapWith(Number)`, `pulls/repository.ts` roll-ups).
- Transactions run on `postgres-js` (`src/db/client.ts`), one connection per transaction.
