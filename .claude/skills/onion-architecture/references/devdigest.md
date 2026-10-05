# DevDigest `server/` + `reviewer-core/`: how the rings map to this repo

## Contents
- Sources of truth
- Ring map, file by file
- Known deviations (don't copy them)
- Where other skills disagree with this repo
- Searching this codebase

## Sources of truth

| Question | Read |
| --- | --- |
| Module file names, container, errors, tests | `server/CLAUDE.md` → Conventions, Naming |
| Container members, overrides, "Adding an adapter" | `server/docs/architecture.md` |
| Route map and DI flow | `server/README.md` |
| Review run lifecycle | `server/specs/review-flow.md` |
| Engine purity and public API | `reviewer-core/CLAUDE.md`, `reviewer-core/src/index.ts` |
| What the rules actually enforce | `server/.dependency-cruiser.cjs` |
| Which violations are frozen | `server/.dependency-cruiser-known-violations.json` |

If this file and the code disagree, trust the code and `pnpm arch`.

## Ring map, file by file

Paths are relative to `server/src/` unless they start with `reviewer-core/`.

| Path | Ring | Notes |
| --- | --- | --- |
| `app.ts`, `server.ts` | composition root | builds Fastify, the container, the error handler; `app.ts` may use Drizzle for `/health/ready` |
| `platform/container.ts` | composition root | the only non-root file allowed to import modules and adapters |
| `modules/index.ts` | composition root | static plugin registry, no autoload |
| `platform/errors.ts` | kernel | `AppError` hierarchy; imports nothing, so every ring may use it |
| `vendor/shared/**` (`@devdigest/shared`) | kernel | Zod contracts + the shared ports in `adapters.ts`; imports only `zod` |
| `platform/run-logger.ts`, `price-book.ts`, `resilience.ts`, `code-scope.ts` | pure platform helpers | application code (and adapters) may import them; `code-scope.ts` holds the parser scope constants the ast-grep and depgraph adapters share with repo-intel |
| `platform/structured.ts` | pure platform helper | re-exports `@devdigest/reviewer-core`'s structured-output helpers (the grounding and prompt shims were removed as dead code; tests import the engine) |
| `platform/jobs.ts`, `sse.ts`, `config.ts` | platform infrastructure | DB writes, an in-memory run bus with timers (one per container), `dotenv` — reach them through a port (`JobQueue`, `RunEvents`); reviews wait in `container.reviewQueue` through the `ReviewQueue` port |
| `db/**` | persistence edge | `client.ts` (`Db`, `Tx`, `DbExecutor`), `schema/*.ts`, `rows.ts`, seed, migrate, `migration-status.ts` (readiness); never imports modules or adapters |
| `modules/<m>/routes.ts`, `modules/_shared/context.ts` | HTTP edge | `context.ts` may use `FastifyRequest` and `Container` types |
| `modules/_shared/schemas.ts` | HTTP edge | shared Zod params (`IdParams`) |
| `modules/<m>/repository.ts`, `repository/*.repo.ts` | persistence edge | `reviews/repository.ts` is a facade over `repository/{review,run,pull}.repo.ts` |
| `modules/<m>/service.ts` | application | built from a `deps` object of ports (`<m>/ports.ts`) in every module but repo-intel, whose service still takes the `Container` (see deviations) |
| `modules/<m>/helpers.ts`, `constants.ts`, `run-executor.ts`, `findings.ts`, `feature-models.ts`, `repo-intel/pipeline/*` | application | every module file that is not routes/repository/domain/ports is checked as application code |
| `modules/<m>/ports.ts` | ports | `agents`, `polling`, `pulls`, `repos`, `reviews`, `settings`, `workspace`; polling's `PollStore` is satisfied structurally by the pulls repository |
| `modules/{agents,polling,pulls,repos,reviews}/domain.ts` | domain | agent versioning rules and records; the poll's watermark and which PRs get fresh diff stats (`newestUpdate`, `statsTargets`); PR review status + PR-list mapping (`toPrMeta`, `toStoredDetail`); the stored records a review run works with |
| `repo-intel/pipeline/rank.ts` | application | pure ranking math next to repository reads; the natural next `domain.ts` material |
| `adapters/<tech>/*` | external edge | implement the shared ports; `git/diff-parser.ts` is a pure parser; `git/pr-diff.ts` (`PrDiffSource`) satisfies reviews' `DiffSource` (git diff, else stored patches); `auth/local.ts` takes an `IdentityStore` (the workspace repository) and the seed identity from the container |
| `adapters/mocks.ts` | test doubles | deterministic mocks for the 7 shared ports, injected via `ContainerOverrides` |
| `adapters/llm/fake.ts` | external edge | `FakeReviewLlm`, the `LLMProvider` the container hands every agent under `DEVDIGEST_FAKE_LLM=1` (e2e); not a test mock |
| `reviewer-core/src/**` | engine core | pure; `llm/openrouter.ts` is its one adapter |

Ports live in four places today: `vendor/shared/adapters.ts` (`LLMProvider`, `Embedder`,
`GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider`), the adapter
files (`adapters/depgraph/index.ts:27`, `adapters/tokenizer/index.ts:16`,
`adapters/auth/local.ts:5`), a module (`modules/repo-intel/types.ts:137`, the `RepoIntel`
facade) and the modules' `ports.ts` (e.g. `modules/reviews/ports.ts`: `ReviewStore`,
`AgentLookup`, `RunEvents`, `DiffSource`, `RepoContext`). New ports go in the consuming
module's `ports.ts`, or in `vendor/shared/adapters.ts` when several modules share them.

## Known deviations (don't copy them)

The baseline holds 25 violations, all in `modules/repo-intel/`, whose internals are
do-not-touch (`server/CLAUDE.md`). The first four rows are those violations; the rest
pass `pnpm arch` but are patterns to leave alone. When a task touches one of these files,
don't add another instance.

| Deviation | Where | When you touch it |
| --- | --- | --- |
| Service as service locator | `modules/repo-intel/service.ts:104` (takes the `Container`, builds `RepoIntelRepository`) | new repo-intel code takes ports; a new service never takes `Container` |
| Application code using concrete adapters and `node:fs` | `repo-intel/service.ts:29`, `repo-intel/pipeline/{full,incremental,walk}.ts` | intentional per `server/docs/architecture.md`; don't spread it to other modules |
| Application code importing a repository | `repo-intel/{index,service}.ts`, `repo-intel/pipeline/{full,incremental,rank,repo-map}.ts` → `repo-intel/repository.ts` | new code declares a port and gets the repository from the composition root |
| Container ⇄ repo-intel cycle | `platform/container.ts` ⇄ `repo-intel/service.ts` and `pipeline/{full,incremental}.ts` | breaks when repo-intel takes ports instead of the container |
| Multi-write without a transaction | `repo-intel/repository.ts:247-248,352-366` (index delete + chunked insert). Done right: `reviews/repository/run.repo.ts:88,199`, `agents/repository.ts`, `pulls/repository.ts:230-231` | any write pair you add or change goes in one transaction |
| Route driving the container | `repo-intel/routes.ts:40,55` (`container.repoIntel.getIndexState`, `container.jobs.enqueue`) | counted by `test/routes-container-ratchet.test.ts`; a new route calls a service |
| Version arithmetic in a repository | `modules/agents/repository.ts:119`, `:299` (`version + 1`); the decisions are in `agents/domain.ts`, the writes in one transaction | move the next-version rule into `domain.ts` when you change it |
| Repository returns API DTOs | `reviews/repository/run.repo.ts:47-52` (`listRunsForPull` → `RunSummary`) | fine when the shape is the contract; don't add snake_case ad-hoc shapes |

## Where other skills disagree with this repo

| Skill says | Here |
| --- | --- |
| `fastify-best-practices` `rules/decorators.md:129-172`: a service decorated onto the instance, SQL inside it | services are plain classes built from ports; SQL only in repositories |
| `fastify-best-practices` `rules/database.md:194`: `createUserRepository(app)` decorated as `fastify.repositories` | repositories are built in `platform/container.ts` and never see Fastify |
| `fastify-best-practices` `rules/routes.md:458`: routes call `fastify.repositories.*` | routes call a service; they never import a repository |
| `@fastify/autoload` for route discovery | modules are registered statically in `modules/index.ts` |
| `drizzle-orm-patterns` `references/examples.md:302`: a `UserRepository` class with no port | the repository `implements` a port declared in `ports.ts` |
| `zod` skill and zod.dev document Zod 4 | this repo is on Zod 3 with `fastify-type-provider-zod` 4.x |

## Searching this codebase

- Two files contain a raw NUL byte, so shell `grep` treats them as binary and skips them:
  `adapters/depgraph/index.ts` and `modules/repo-intel/pipeline/repo-map.ts`. Use `grep -a` or the Grep tool.
  dependency-cruiser parses them normally.
- Never search `server/clones/**`: it holds cloned repos, including a copy of this one.
- To see a file's frozen debt:
  `grep -n '"from": "src/modules/repo-intel/service.ts"' server/.dependency-cruiser-known-violations.json`.
