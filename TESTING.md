# Testing & CI strategy

DevDigest is four independent packages (no workspace), so testing is organised
as **one suite per package**, each with its own CI workflow, runner, and path
filter. A package's suite runs only when that package (or a package it depends
on at type-check time) changes.

## Philosophy — typological, not exhaustive

We do **not** chase line coverage. Each suite covers the *kinds* of things that
can break in that layer — one happy path plus the edge that actually matters per
workflow — and deliberately skips the rest. Concretely:

- **Test behaviour at the seams**, not implementation details. Routes, adapters,
  contracts, the review pipeline, the rendered component.
- **Mock the outside world.** LLMs, GitHub, and git are stubbed via
  `server/src/adapters/mocks.ts` so unit tests are hermetic and key-free.
- **One real integration per data-backed workflow**, against a real Postgres —
  not a mock DB — because the bugs there live in SQL, migrations, and wiring.
- **A few end-to-end browser flows** over the *main* user journeys, on seeded
  data, with no LLM in the loop.

If a test wouldn't catch a class of regression we care about, we don't write it.

## Suite map

| Suite | Package | Kind | Runner | Workflow | Docker? |
|-------|---------|------|--------|----------|---------|
| client | `client/` | component / unit (jsdom) | vitest | `client.yml` | no |
| server-unit | `server/` | unit (hermetic) | vitest | `server-unit.yml` | no |
| server-integration | `server/` | integration (real Postgres) | vitest | `server-integration.yml` | **yes** |
| reviewer-core | `reviewer-core/` | unit (engine) | vitest | `reviewer-core.yml` | no |
| e2e web | `e2e/` | browser e2e (deterministic) | agent-browser + `run.ts` | `e2e-web.yml` | yes (stack) |

## What each suite covers

**client** — components render and react to interaction (React Testing Library + jsdom)
over `vi.mock`ed hook modules; data-layer tests mock `src/lib/api.ts` under a real QueryClient.
No API, DB, or browser. Covers the PR-review surface (list, diff, findings, run controls) and the agent editor.

**server-unit** — the DB-free majority: adapters, prompt assembly, grounding,
repo-intel ranking & indexing, pricing, route smoke. Both jobs run on Ubuntu only
(`server-unit.yml` says why it does not matrix over Windows/macOS). The `typecheck`
job type-checks `tsconfig.test.json` (source **and** tests), then runs `pnpm arch` +
`pnpm arch:stale` — onion layer boundaries checked by dependency-cruiser
(`.claude/skills/onion-architecture`) — and `pnpm lint`.

**server-integration** — the `*.it.test.ts` files. They share one Postgres (pgvector,
testcontainers; each file on its own copy of a migrated template), seed it, and
drives routes end-to-end: reviews + run lifecycle (incl. grounding), agents CRUD,
repo-intel symbol clamping, pulls comments, settings models, and the API
contracts (`test/api-contracts.it.test.ts` parses real responses with the shared
schemas). Locally they self-skip when Docker is unavailable; under `CI` a missing
Docker fails the run instead (`test/helpers/pg.ts`).

**reviewer-core** — the pure engine: `toReviewPayload` and the CI gate, prompt construction,
grounding, map-reduce, and a `reviewPullRequest` with a stubbed model → grounded findings. No
DB / GitHub / FS. Its doubles live in `reviewer-core/test/helpers/`; no test imports `server/` source.

**e2e web** — see `e2e/README.md`. Deterministic agent-browser flows over the
main journeys (boot → PR list → PR detail; agents; run a review → accept a
finding → open its trace) against a real seeded stack. No `chat`, no model key:
the API runs with `DEVDIGEST_FAKE_LLM=1`, a deterministic fake model.

## Running locally

```sh
# per package
cd client        && pnpm test           # + pnpm typecheck · pnpm lint · pnpm coverage
cd reviewer-core && npm test            # + npm run typecheck · npm run lint · npm run coverage

# server — the unit/integration split (see note below)
cd server && pnpm test:unit                                     # unit, no Docker
cd server && pnpm test:it                                       # integration, needs Docker
cd server && pnpm test                                          # both
cd server && pnpm arch                                          # layer boundaries (dependency-cruiser)
cd server && pnpm lint && pnpm coverage                         # eslint · v8 report

# browser e2e (agent-browser CLI once, then a throwaway seeded stack)
npm i -g agent-browser && agent-browser install
./scripts/e2e.sh
```

## Conventions

- **Integration tests end in `*.it.test.ts`.** `server/vitest.workspace.ts` defines
  two projects: `unit` excludes that glob, `integration` selects only it (with
  120 s timeouts); `pnpm test:unit` / `pnpm test:it` run one each, and CI calls
  them. A DB-backed test that imports `test/helpers/pg.ts` must use the
  `.it.test.ts` suffix.
- **Lint is warn-only but kept at zero.** Each package's `eslint.config.mjs` turns on
  three type-aware typescript-eslint rules (`no-floating-promises`,
  `no-misused-promises`, `switch-exhaustiveness-check`); CI runs `lint` next to
  `typecheck`. Coverage (`coverage` script, v8) is a report with no thresholds.
- **The client's `src/vendor/shared` must equal the server's.** `client.yml` fails
  on any `diff -r` between the two copies.
- **Hermetic by default.** Reach for `src/adapters/mocks.ts` (MockLLMProvider,
  MockGitClient) rather than real network/keys.
- **E2E specs are deterministic batch JSON** (`e2e/specs/*.flow.json`) using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **CI is path-filtered per package.** Cross-package source aliases are encoded
  in each workflow's `paths:` (e.g. `reviewer-core/**` triggers `server-unit`
  because the server type-checks against `../reviewer-core/src`).
- **Actions are pinned to a commit SHA** (the tag in a trailing comment), and every
  job sets `timeout-minutes`. Bump the SHA and the comment together.
- **`server/clones/**` is runtime data** (git-ignored) and never collected by
  any suite.
