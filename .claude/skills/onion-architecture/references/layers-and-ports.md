# Layers and ports: domain, ports, services, composition

## Contents
- The rings as imports
- Domain
- Ports
- Services
- Composition: container + routes plugin
- Worked example: the PR list
- When not to add a ring

The examples are illustrations for new code. They use real names from this repo but are
not in the codebase; the PR-list handler they are drawn from is legacy
(`server/src/modules/pulls/routes.ts:26-191`).

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
// ✗ modules/agents/repository.ts:112-146 — the rule is buried in a write
const configChanged = isConfigChange(existing, patch);
const nextVersion = configChanged ? existing.version + 1 : existing.version;
await this.db.update(t.agents).set({ /* … */ version: nextVersion });
if (configChanged && row) await this.snapshotVersion(row, nextVersion);
```

```ts
// ✓ modules/agents/domain.ts — the decision, testable without a DB
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
- `modules/pulls/status.ts` (`deriveReviewStatus`) is already this kind of code.

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
// ✓ modules/pulls/ports.ts — shaped by the use case
import type { GitHubClient, PrMeta } from '@devdigest/shared';
import type { PullStats, RepoForSync } from './domain.js';

export interface PullStore {
  findRepo(workspaceId: string, repoId: string): Promise<RepoForSync | undefined>;
  upsertFromGitHub(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<void>;
  listForRepo(repoId: string): Promise<PrMeta[]>;
  saveStats(pullId: string, stats: PullStats): Promise<void>;
}

/** Structural: `app.log` (pino) satisfies it. */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export interface PullsDeps {
  pulls: PullStore;
  github: () => Promise<GitHubClient>; // lazy: ConfigError only when used
  log: Logger;
}
```

Rules:
- Name ports for the role (`PullStore`, `JobQueue`, `RunEvents`), methods for the
  intent. No generic `Repository<T>` with `findAll/findById/save` (A2, A3).
- Signatures carry domain or contract types only. `ports.ts` may import only its module's
  `domain.ts` and `@devdigest/shared` (`onion-ports-pure`).
- Reuse a shared port (`GitHubClient`, `GitClient`, `LLMProvider`, …) instead of
  wrapping it again.
- Infrastructure without an interface today (`JobRunner`, `RunBus`) is reached through a
  narrow structural port declared in `ports.ts`:
  `interface JobQueue { enqueue(workspaceId: string, kind: string, payload: unknown): Promise<unknown> }`
  and `interface RunEvents { publish(runId: string, kind: RunEventKind, msg: string, data?: unknown): unknown }`.
  The real `container.jobs` and `container.runBus` satisfy them without changes.
- Another module's data: declare the narrow port you need (`interface AgentLookup { getById(…) }`)
  and let the composition root pass the other module's repository. Never import that
  module's folder (`onion-no-cross-module`).

## Services

```ts
// ✗ legacy shape — modules/reviews/service.ts:33-37
constructor(private container: Container) {
  this.repo = new ReviewRepository(container.db); // builds its own edge
}
```

```ts
// ✓ modules/pulls/service.ts
import type { PrMeta } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { needsStatsBackfill, STATS_BACKFILL_LIMIT } from './domain.js';
import type { PullsDeps } from './ports.js';

export class PullsService {
  constructor(private deps: PullsDeps) {}

  async listForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]> {
    const repo = await this.deps.pulls.findRepo(workspaceId, repoId);          // load
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.deps.github().catch((err) => {
      this.deps.log.warn({ err }, 'GitHub unavailable; serving persisted PRs');
      return null;
    });
    if (gh) await this.deps.pulls.upsertFromGitHub(workspaceId, repo.id, await gh.listPullRequests(repo));

    const pulls = await this.deps.pulls.listForRepo(repo.id);
    for (const pr of needsStatsBackfill(pulls, STATS_BACKFILL_LIMIT)) {          // decide
      if (!gh || !pr.id) break;
      const detail = await gh.getPullRequest(repo, pr.number);
      await this.deps.pulls.saveStats(pr.id, detail);                           // persist
    }
    return this.deps.pulls.listForRepo(repo.id);
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
  logic; the service logs through its `Logger` port.

## Composition: container + routes plugin

```ts
// platform/container.ts — the composition root builds edges lazily
get pullsRepo(): PullsRepository {
  return (this._pullsRepo ??= new PullsRepository(this.db));
}
```

```ts
// modules/pulls/routes.ts — the plugin builds the service once from ports
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PullsService({
    pulls: app.container.pullsRepo,
    github: () => app.container.github(),
    log: app.log,
  });

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listForRepo(workspaceId, req.params.id);
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
