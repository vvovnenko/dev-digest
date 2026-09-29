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
// ✓ test/pulls-service.test.ts:134-148 (abridged) — a service built from ports takes fakes
it('serves what is stored when GitHub is unreachable, and 404s outside the workspace', async () => {
  const store = new InMemoryPulls();            // `implements PullStore` over arrays (:35)
  store.pulls.push(pull(7, { additions: 3 }));
  store.rollupByPr.set('pr-7', { score: 88, findingsBySeverity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 }, costUsd: 0.01 });
  const service = new PullsService({ pulls: store, github: offline, log: silent });

  expect(await service.listForRepo('ws', REPO.id)).toMatchObject([{ number: 7, score: 88, cost_usd: 0.01 }]);
  expect(await service.detail('ws', 'pr-7')).toMatchObject({ number: 7, files: [{ path: 'a.ts' }] });
  await expect(service.listForRepo('other', REPO.id)).rejects.toBeInstanceOf(NotFoundError);
});
```

- A fake is a small class that `implements` the port over arrays or maps, owned with the
  port: change them together. While one test file uses it, keep it inline there; move it
  to `test/helpers/<module>-fakes.ts` when a second file needs it.
- Real examples: `test/pulls-service.test.ts` (`PullsService`, `PollingService`),
  `test/repos-service.test.ts` (`RepoStore`, `JobQueue`, `RepoIndexing` fakes),
  `test/settings-service.test.ts` (`SettingsStore`, `SecretsProvider`),
  `test/auth-local.test.ts` (the auth adapter over an in-memory `IdentityStore`).
- Reuse the adapter mocks in `src/adapters/mocks.ts` for the shared ports.
- Assert on outcomes (what the store now holds, what the method returned), not on which
  methods were called.

## Contract suites keep fakes honest

One suite per port, run against the fake in the unit lane and against the Drizzle
repository in the `.it` lane, so a fake can't drift from the real thing (T15). None
exists yet; the first port with fakes in two test files is the one to start with.

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
  was rolled back (`test/agents-versions.it.test.ts`: a failed skills update leaves the
  previous skills and version untouched; `test/run-lifecycle.it.test.ts`: a run cancelled
  while its review is being saved saves nothing).
- If Docker can't reach Docker Hub: `TESTCONTAINERS_RYUK_DISABLED=true pnpm test`
  (`server/INSIGHTS.md`).
- The `integration` project shares one Postgres: `test/helpers/pg-global-setup.ts` starts it
  and migrates a template database once, and `startPg()` gives each file its own copy
  (`CREATE DATABASE … TEMPLATE`), dropped by `stop()` (T17). The global setup must not import
  a module that imports `inject` from `vitest` (`test/helpers/pg-shared.ts` exists for that).

## Routes: build the app and inject

- `buildApp({ config, db, overrides })` then `app.inject({ method, url, payload })`, then
  `await app.close()` (T4). `test/routes-smoke.test.ts` is the unit-lane example.
- Routes built from ports need only adapter overrides; repositories come from the real
  test DB in the `.it` lane.
- `buildApp` without `db` builds its own from `DATABASE_URL`; the vitest config points that
  at an unreachable port and blanks every provider key (`server/vitest.config.ts`), so a unit
  test can't reap the dev DB or make a billed call. Keep it that way: never set a real
  `DATABASE_URL` or key in a test.

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
