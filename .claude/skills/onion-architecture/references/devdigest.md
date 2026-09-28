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
| `platform/run-logger.ts`, `price-book.ts`, `resilience.ts`, `trace-builder.ts` | pure platform helpers | application code may import them |
| `platform/grounding.ts`, `prompt.ts`, `structured.ts` | pure platform helpers | re-exports of `@devdigest/reviewer-core` |
| `platform/jobs.ts`, `sse.ts`, `config.ts`, `prompts.ts` | platform infrastructure | DB writes, a process-wide singleton, `dotenv`, file reads — reach them through a port (`JobQueue`, `RunEvents`) |
| `platform/model-router.ts` | platform | unused today; contains a raw NUL byte (see "Searching") |
| `db/**` | persistence edge | `client.ts` (`Db`), `schema/*.ts`, `rows.ts`, seed, migrate; never imports modules or adapters |
| `modules/<m>/routes.ts`, `modules/_shared/context.ts` | HTTP edge | `context.ts` may use `FastifyRequest` and `Container` types |
| `modules/_shared/schemas.ts` | HTTP edge | shared Zod params (`IdParams`) |
| `modules/<m>/repository.ts`, `repository/*.repo.ts` | persistence edge | `reviews/repository.ts` is a facade over `repository/{review,run,pull}.repo.ts` |
| `modules/<m>/service.ts` | application | legacy services still take the `Container` (see deviations) |
| `modules/<m>/helpers.ts`, `constants.ts`, `run-executor.ts`, `diff-loader.ts`, `findings.ts`, `feature-models.ts`, `repo-intel/pipeline/*` | application | every module file that is not routes/repository/domain/ports is checked as application code |
| `modules/pulls/status.ts`, `repo-intel/pipeline/rank.ts` | application (pure) | already pure functions; the natural first `domain.ts` material |
| `adapters/<tech>/*` | external edge | implement the shared ports; `git/diff-parser.ts` is a pure parser |
| `adapters/mocks.ts` | test doubles | deterministic mocks for the 7 shared ports, injected via `ContainerOverrides` |
| `adapters/index.ts`, `modules/repo-intel/index.ts` | barrels | nothing imports them |
| `reviewer-core/src/**` | engine core | pure; `llm/openrouter.ts` is its one adapter |

Ports live in three places today: `vendor/shared/adapters.ts` (`LLMProvider`, `Embedder`,
`GitHubClient`, `GitClient`, `CodeIndex`, `AuthProvider`, `SecretsProvider`), the adapter
files (`adapters/depgraph/index.ts:27`, `adapters/tokenizer/index.ts:16`) and a module
(`modules/repo-intel/types.ts:137`, the `RepoIntel` facade). New ports go in the consuming
module's `ports.ts`, or in `vendor/shared/adapters.ts` when several modules share them.

## Known deviations (don't copy them)

All of these are in the baseline. When a task touches one of these files, don't add
another instance. Fix the listed line if the fix is local and cheap; otherwise mention
it and leave it.

| Deviation | Where | When you touch it |
| --- | --- | --- |
| SQL in routes, incl. other modules' tables | `modules/pulls/routes.ts:3,6` (and `:126-153` reads reviews/findings/runs), `polling/routes.ts:3`, `settings/routes.ts:3`, `workspace/routes.ts:2` | put the new query in a module `repository.ts` behind a port; call it from a service |
| Business rules in a route | `modules/pulls/routes.ts:85-111` (diff-stat backfill), `:113-191` (score/findings/cost roll-ups) | extract the decision into `domain.ts` when you change it |
| Business rule in a repository | `modules/agents/repository.ts:112-146` (version bump + snapshot) | decision → `domain.ts`; the write pair → one transaction |
| Service as service locator | `modules/reviews/service.ts:33-37`, `repos/service.ts:36-37`, `agents/service.ts:55`, `repo-intel/service.ts:105` | new methods take ports; a new service never takes `Container` |
| Unused container getter | `platform/container.ts` `reviewRepo` (services build their own) | wire new repositories through getters and actually use them |
| Drizzle row types in application code | `reviews/service.ts:4`, `reviews/run-executor.ts:5-6`, `reviews/diff-loader.ts:4`, `repos/helpers.ts:2`, `settings/feature-models.ts:8` | new code takes domain/contract types; map in the repository |
| Row types imported from `./repository.js` | `agents/helpers.ts:3`, `reviews/helpers.ts:6`, `reviews/findings.ts:3` | same — also causes the `agents/helpers` ⇄ `agents/repository` cycle |
| Repository returns API DTOs | `reviews/repository/run.repo.ts:40` (`listRunsForPull` → `RunSummary`) | fine when the shape is the contract; don't add snake_case ad-hoc shapes |
| Cross-module deep import | `repos/service.ts:14` (`../repo-intel/constants.js`) | move shared constants to `@devdigest/shared` or pass them through a port |
| Adapters importing a module | `adapters/astgrep/index.ts:25`, `adapters/depgraph/index.ts:20` (`repo-intel/constants`) | pass the constants in as constructor/function arguments |
| Adapter importing db | `adapters/auth/local.ts:2-5` (Drizzle + `db/seed`) | a DB-backed port is a repository; don't extend this |
| Application code using concrete adapters and `node:fs` | `repo-intel/service.ts`, `repo-intel/pipeline/{full,incremental,walk}.ts`, `reviews/diff-loader.ts:3` | repo-intel internals are do-not-touch (`server/CLAUDE.md`); intentional per `server/docs/architecture.md` |
| Container ⇄ repo-intel cycle | `platform/container.ts` ⇄ `repo-intel/service.ts` and `pipeline/{full,incremental}.ts` | breaks when repo-intel takes ports instead of the container |
| Hand-parsed body | `reviews/routes.ts:32` (`RunRequest.parse(req.body ?? {})`) | move the schema into the route options when you change the route |
| No transactions anywhere | `agents/repository.ts:85-146`, `reviews/repository/run.repo.ts`, `repo-intel/repository.ts`, `pulls/routes.ts` upserts | any write pair you add or change goes in one transaction |
| Engine exports an adapter | `reviewer-core/src/index.ts` exports `OpenRouterProvider` | only `platform/container.ts` should use it |

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

- Three files contain a raw NUL byte, so shell `grep` treats them as binary and skips them:
  `platform/model-router.ts`, `adapters/depgraph/index.ts`,
  `modules/repo-intel/pipeline/repo-map.ts`. Use `grep -a` or the Grep tool.
  dependency-cruiser parses them normally.
- Never search `server/clones/**`: it holds cloned repos, including a copy of this one.
- To see a file's frozen debt:
  `grep -n '"from": "src/modules/pulls/routes.ts"' server/.dependency-cruiser-known-violations.json`.
