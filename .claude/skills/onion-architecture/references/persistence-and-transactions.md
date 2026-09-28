# Persistence and transactions (Drizzle 0.38 + Postgres)

## Contents
- A repository implements a port
- Rows, contracts and mappers
- Transactions: three patterns
- External calls and transactions
- Version notes (Drizzle 0.38, not v1)

Query syntax (joins, `onConflictDoUpdate`, relations) belongs to `drizzle-orm-patterns`;
table design to `postgresql-table-design`. This file covers where persistence code sits
and where the transaction boundary goes.

## A repository implements a port

```ts
// modules/pulls/repository.ts — the only file in the module that imports Drizzle
import { and, eq } from 'drizzle-orm';
import type { PrMeta } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PullStats, RepoForSync } from './domain.js';
import type { PullStore } from './ports.js';

export class PullsRepository implements PullStore {
  constructor(private db: Db) {}

  async findRepo(workspaceId: string, repoId: string): Promise<RepoForSync | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, owner: t.repos.owner, name: t.repos.name })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async saveStats(pullId: string, s: PullStats): Promise<void> {
    await this.db
      .update(t.pullRequests)
      .set({ additions: s.additions, deletions: s.deletions, filesCount: s.files_count })
      .where(eq(t.pullRequests.id, pullId));
  }
  // listForRepo maps rows → PrMeta here; upsertFromGitHub: one insert … onConflictDoUpdate
}
```

Rules:
- `implements` the port, so a signature drift is a type error, not a runtime surprise.
- Scope every query by `workspaceId`, unless the id was already resolved inside that
  workspace by the same use case (as `repoId` above after `findRepo`).
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
  that type and don't write a mapper (A4). Map when they differ (snake_case contract vs
  camelCase row, dates → ISO strings, JSON columns), and keep that mapper in the
  repository or its `helpers` (N4).
- Never reuse a `drizzle-zod` schema as an HTTP contract: contracts live in
  `@devdigest/shared` and change deliberately.

## Transactions: three patterns

No code path uses a transaction today, although several do multiple writes
(`agents/repository.ts:85-146` insert/update + version snapshot, `setSkills` delete +
insert, the pulls upserts). Anything you add or change that writes twice must be atomic.
Pick the first pattern that fits (T7, T9, T10).

**(a) One repository method = one consistency boundary.** The port method describes the
whole change; the repository wraps it.

```ts
// agents/repository.ts:229-235 setSkills today: delete, then insert, no transaction
async setSkills(agentId: string, skillIds: string[]): Promise<void> {
  await this.db.transaction(async (tx) => {
    await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await tx.insert(t.agentSkills).values(skillIds.map((skillId, i) => ({ agentId, skillId, order: i })));
  });
}
```

**(b) `update(id, fn)` when the decision needs the current row.** The repository locks
and loads, the domain function decides, the repository writes: all in one transaction,
and the domain rule stays out of the repository.

```ts
// ports.ts
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

// db/client.ts — add when first needed
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
  (`createDb` uses `max: 10`, `src/db/client.ts:18`), and a rollback cannot undo the side effect.
- Order: fetch from the outside → one short transaction for all writes → emit
  (`RunEvents.publish`) and enqueue (`JobQueue.enqueue`) after it commits.
- `JobRunner.enqueue` writes the `jobs` row outside your transaction; enqueue after
  commit, so a job never runs against data that was rolled back.

## Version notes (Drizzle 0.38, not v1)

- orm.drizzle.team now documents v1 (T8). On 0.38 keep `relations()` and callback-style
  relational `where`/`orderBy`, and the separate `drizzle-zod` package.
- `db.transaction(async (tx) => …)`, `tx.rollback()`, nested transactions (savepoints)
  and `.for('update')` are all available in 0.38.4 (`node_modules/drizzle-orm/pg-core`).
- Transactions run on `postgres-js` (`src/db/client.ts`), one connection per transaction.
