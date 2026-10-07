# Layers and ports: domain, ports, services, composition

## Contents
- The rings as imports
- Domain
- Ports
- Services
- Composition: container + routes plugin
- Worked example: the PR list
- When not to add a ring

The ✓ examples are excerpts of real code unless marked "illustration". `modules/pulls/`
is the worked example: `domain.ts`, `ports.ts`, a `service.ts` built from `deps`, a
repository that `implements PullStore`, a routes plugin that wires them
(`server/src/modules/pulls/routes.ts:22-29`) and a fake-based test
(`server/test/pulls-service.test.ts`). `settings/`, `workspace/`, `repos/`, `agents/`,
`polling/` and `reviews/` have the same shape; only `repo-intel/` is legacy.

## The rings as imports

```text
            routes.ts        repository.ts        src/adapters/<tech>/
                 \                 |                    /
                  └──────►   service.ts   ◄────────────┘ (implement ports)
                                   │
                               ports.ts
                                   │
                               domain.ts
                                   │
                 @devdigest/shared · platform/errors.ts · zod
```

An arrow means "may import". Edges implement ports (`implements PullStore`) and are
wired in by the composition root. The service never imports an edge (F1, F4, F9).

## Domain

Pure functions over values. No `await`, no `Date.now()`, no `randomUUID()`: pass them in.

```ts
// ✗ modules/agents/repository.ts:118-141 — isConfigChange lives in domain.ts, but the
//   next-version arithmetic is still buried in the write
const configChanged = isConfigChange(existing, patch);
const nextVersion = configChanged ? existing.version + 1 : existing.version;
await tx.update(t.agents).set({ /* … */ version: nextVersion });
if (configChanged && row) await this.snapshotVersion(tx, row, nextVersion);
```

```ts
// ✓ illustration: modules/agents/domain.ts, next step — the whole decision, testable without a DB
import type { Agent } from '@devdigest/shared';

export interface AgentChange {
  next: Agent;
  snapshot: boolean; // true when this change creates a new immutable version
}

export function applyAgentPatch(current: Agent, patch: AgentPatch): AgentChange {
  const configChanged = isConfigChange(current, patch);
  const next = { ...current, ...patch, version: configChanged ? current.version + 1 : current.version };
  return { next, snapshot: configChanged };
}
```

The repository then persists `next` and, when `snapshot` is true, the version row, in one
transaction ([persistence-and-transactions.md](persistence-and-transactions.md)).

Rules:
- Reuse `@devdigest/shared` types when the shape is the same. Add a domain type only for
  a shape the API doesn't have (F8, A4).
- Throw `AppError` subclasses for broken invariants; don't return HTTP codes.
- `modules/pulls/domain.ts` (`deriveReviewStatus`, `toPrMeta`) is this kind of code; so are
  `modules/agents/domain.ts` and `modules/polling/domain.ts` (`newestUpdate`, `statsTargets`).

## Ports

A port is a sentence the service says to the outside world, in the service's words (F3, F5).

```ts
// ✗ shaped by the database and the SDK
export interface PullRequestsRepo {
  select(where: SQL): Promise<(typeof pullRequests.$inferSelect)[]>; // Drizzle leaks
  octokit(): Octokit;                                               // SDK leaks
}
```

```ts
// ✓ modules/pulls/ports.ts:1-28 (abridged) — shaped by the use case
import type { GitHubClient, PrDetail, PrMeta } from '@devdigest/shared';
import type { PrCommitRecord, PrFileRecord, PullRecord, PullRepoRef, PullRollup } from './domain.js';

export interface PullStore {
  repoInWorkspace(workspaceId: string, repoId: string): Promise<PullRepoRef | undefined>;
  upsertFromGitHub(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<number>;
  listForRepo(repoId: string): Promise<PullRecord[]>;
  saveDiffStats(prId: string, stats: { additions: number; deletions: number; filesCount: number }): Promise<void>;
  rollups(prIds: string[]): Promise<Map<string, PullRollup>>;
  // … pullInWorkspace, replaceDetail, storedDetail
}

/** Structural subset of pino (`app.log`). */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export interface PullsDeps {
  pulls: PullStore;
  /** Throws when no GitHub token is configured. */
  github: () => Promise<GitHubClient>;
  log: Logger;
  now?: () => number;
}
```

Rules:
- Name ports for the role (`PullStore`, `JobQueue`, `RunEvents`), methods for the
  intent. No generic `Repository<T>` with `findAll/findById/save` (A2, A3).
- Signatures carry domain or contract types only. `ports.ts` may import only its module's
  `domain.ts` and `@devdigest/shared` (`onion-ports-pure`).
- Reuse a shared port (`GitHubClient`, `GitClient`, `LLMProvider`, …) instead of
  wrapping it again.
- Infrastructure without an interface of its own (`JobRunner`, `RunBus`) is reached
  through a narrow structural port declared in `ports.ts`: `JobQueue`
  (`modules/repos/ports.ts:24`) and `RunEvents` (`modules/reviews/ports.ts:75`). The real
  `container.jobs` and `container.runBus` satisfy them without changes.
- Another module's data: declare the narrow port you need — `AgentLookup`
  (`modules/reviews/ports.ts:64`) is satisfied by the agents repository, `PollStore`
  (`modules/polling/ports.ts`) by the pulls repository — and let the composition root pass
  it. Never import that module's folder (`onion-no-cross-module`).
- When the port needs knowledge only the root has, the container adapts it:
  `RepoIndexing` (`modules/repos/ports.ts`) becomes enqueues of repo-intel's job kinds in
  `container.repoIndexing`.

## Services

```ts
// ✗ legacy shape — modules/repo-intel/service.ts:104-106
constructor(private container: Container) {
  this.repo = new RepoIntelRepository(container.db); // builds its own edge
}
```

```ts
// ✓ modules/polling/service.ts:18-49 (abridged) — ports in, decisions in domain.ts, clock as a dep
export class PollingService {
  constructor(private deps: PollingDeps) {}

  async poll(workspaceId: string, repoId: string): Promise<{ synced: number; reviewTriggered: false }> {
    const repo = await this.deps.pulls.repoInWorkspace(workspaceId, repoId);        // load
    if (!repo) throw new NotFoundError('Repo not found');
    const gh = await this.deps.github();                                            // lazy port: no token → ConfigError
    const since = await this.deps.pulls.syncWatermark(repo.id);
    const pulls = await gh.listPullRequests(repo, since ? { updatedSince: since.toISOString() } : {});
    const synced = await this.deps.pulls.upsertFromGitHub(workspaceId, repo.id, pulls); // persist

    const lacking = await this.deps.pulls.lackingDiffStats(repo.id, STATS_PER_POLL);
    const targets = statsTargets(pulls.map((p) => p.number), lacking.map((p) => p.number), STATS_PER_POLL); // decide
    if (targets.length > 0) {
      try {
        await this.deps.pulls.saveDiffStats(repo.id, await gh.getDiffStats(repo, targets));
      } catch (err) {
        this.deps.log?.warn({ err, repoId: repo.id }, 'PR diff-stat refresh skipped');   // Logger port
      }
    }
    await this.deps.pulls.markPolled(repo.id, this.deps.now?.() ?? new Date(), newestUpdate(pulls) ?? undefined);
    return { synced, reviewTriggered: false };
  }
}
```

Rules:
- `deps` holds ports only. No `Container`, no `new XRepository`, no Fastify type. The
  service imports `domain.ts`, `ports.ts`, `@devdigest/shared`, `platform/errors.ts` and
  pure platform helpers (`onion-app-no-infra`).
- Order: load → decide (domain) → persist → emit or enqueue after the write succeeded.
- A service that grows value-level `if`s is becoming a transaction script: move the
  decisions into `domain.ts` (F8).
- Error handling that the old route did (`app.log.warn` and carry on) moves with the
  logic; the service logs through its `Logger` port, and a route passes `req.log` so the
  lines carry the request id.

## Composition: container + routes plugin

```ts
// platform/container.ts:136-138 — the composition root builds edges lazily
get pullsRepo(): PullsRepository {
  return (this._pullsRepo ??= new PullsRepository(this.db));
}
```

```ts
// modules/pulls/routes.ts:22-29 — the plugin builds the service once from ports
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PullsService({
    pulls: container.pullsRepo,
    github: () => container.github(),
    log: app.log,
  });

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    return service.listForRepo(workspaceId, req.params.id, req.log);
  });
}
```

Only `platform/container.ts` imports repository and adapter classes; routes read them
from `app.container` by name. Tests override adapters through `ContainerOverrides`, or
build the service directly with fakes ([testing.md](testing.md)). (F2, F14)

## When not to add a ring

- A read-only endpoint that returns one table's rows as the contract shape needs a
  repository method and a thin service method, no `domain.ts`.
- Don't add a mapper when the row and the contract have the same fields; add it the day
  they differ (A4).
- Don't create a port for a pure function: import the function.
- Lasagna check: if a layer only forwards calls with the same arguments, remove it (A1).
