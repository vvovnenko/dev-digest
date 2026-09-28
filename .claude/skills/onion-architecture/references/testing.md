# Testing by ring

## Contents
- Which test for which ring
- Services: fakes of ports, not casts of the container
- Contract suites keep fakes honest
- Repositories: Testcontainers
- Routes: build the app and inject
- Where test files go

Test mechanics live in `TESTING.md` and `server/CLAUDE.md`: unit tests are hermetic,
`*.it.test.ts` start Postgres through `test/helpers/pg.ts`, and reviews are
fire-and-forget (`waitForPrRuns`). This file covers what the onion buys for tests.

## Which test for which ring

| Ring | Test | Doubles |
| --- | --- | --- |
| `domain.ts` | inputs → outputs, many small cases | none |
| `service.ts` | use-case tests; assert on the fake's state and the return value | hand-written in-memory fakes of its ports |
| `repository.ts` | `*.it.test.ts` against real Postgres + pgvector | none: the real DB is the point |
| adapters | against a recorded or local target where possible | `src/adapters/mocks.ts` for everyone else |
| `routes.ts` | `buildApp({ config, db?, overrides })` + `app.inject()` | adapter mocks via `ContainerOverrides` |

Order of preference for doubles: real implementation → fake → stub → interaction mock
(T15). Fakes that keep the port's contract survive refactoring; `vi.mock` of module
paths and call-count assertions break as soon as the code moves (F11).

## Services: fakes of ports, not casts of the container

```ts
// ✗ test/repo-intel-resync.test.ts:30-51 — legacy; the service builds its own repository,
//   so the test casts a fake Container and overwrites a private field
const container = { git, db: {}, depgraph, tokenizer } as unknown as Container;
const service = new RepoIntelService(container);
(service as unknown as { repo: RepoIntelRepository }).repo = repo;
```

```ts
// ✓ a service built from ports takes fakes directly
import { InMemoryPullStore } from './helpers/pulls-fakes.js';
import { ConfigError } from '../src/platform/errors.js';

it('serves persisted PRs when GitHub is unavailable', async () => {
  const pulls = new InMemoryPullStore({ repos: [{ id: 'r1', owner: 'o', name: 'n', workspaceId: 'w1' }] });
  const service = new PullsService({
    pulls,
    github: async () => { throw new ConfigError('no token'); },
    log: { warn: () => {} },
  });
  expect(await service.listForRepo('w1', 'r1')).toEqual([]);
});
```

- A fake is a small class that `implements` the port over arrays or maps. It lives in
  `test/helpers/<module>-fakes.ts` and is owned with the port: change them together.
- Reuse the adapter mocks in `src/adapters/mocks.ts` for the shared ports.
- Assert on outcomes (what the store now holds, what the method returned), not on which
  methods were called.

## Contract suites keep fakes honest

One suite per port, run against the fake in the unit lane and against the Drizzle
repository in the `.it` lane, so a fake can't drift from the real thing (T15).

```ts
// test/helpers/pull-store-contract.ts
export function pullStoreContract(make: () => Promise<{ store: PullStore; seedRepo: … }>) {
  it('upsert is idempotent per (repo, number)', async () => { /* … */ });
  it('findRepo is scoped by workspace', async () => { /* … */ });
}

// test/pulls-store.test.ts        → pullStoreContract(async () => fakeSetup())
// test/pulls-store.it.test.ts     → pullStoreContract(async () => pgSetup(pg))
```

## Repositories: Testcontainers

- Repositories are tested only against real Postgres: `test/helpers/pg.ts` starts
  `pgvector/pgvector:pg16`, runs migrations and returns a Drizzle handle (T16). A test that
  imports it must be named `*.it.test.ts`.
- Test the transaction boundary: force the second write to fail and assert the first one
  was rolled back.
- If Docker can't reach Docker Hub: `TESTCONTAINERS_RYUK_DISABLED=true pnpm test`
  (`server/INSIGHTS.md`).
- Vitest 2's `globalSetup` with `provide`/`inject` could start one container per run
  instead of per file (T17). It is not set up here; treat it as a separate change.

## Routes: build the app and inject

- `buildApp({ config, db, overrides })` then `app.inject({ method, url, payload })`, then
  `await app.close()` (T4). `test/routes-smoke.test.ts` is the unit-lane example.
- Routes built from ports need only adapter overrides; repositories come from the real
  test DB in the `.it` lane.
- Careful: `buildApp` without `db` connects to `DATABASE_URL` from `server/.env` and runs
  the boot reaper against it (`server/INSIGHTS.md`). Pass a throwaway `db` when that
  matters.

## Where test files go

| What | Where |
| --- | --- |
| Domain / service unit tests | `server/test/<module>-<topic>.test.ts` |
| Repository and route tests with a DB | `server/test/<module>-<topic>.it.test.ts` |
| Fakes | `server/test/helpers/<module>-fakes.ts` |
| Contract suites | `server/test/helpers/<port-kebab>-contract.ts` |
| reviewer-core | `reviewer-core/test/` (vitest, no DB) |

Tests are excluded from `pnpm arch` (`\.test\.ts$`), and `test/helpers` is outside the
cruised folders, so fakes may import anything they need.
