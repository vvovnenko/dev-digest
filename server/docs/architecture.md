# Server architecture — DI, adapters, boot

How the API is wired **today**: boot order, the container, test overrides, modules,
errors, secrets and jobs. [`../README.md`](../README.md#request--di-flow) has the
request/DI diagram, API map, env table and rate limits; [`../CLAUDE.md`](../CLAUDE.md)
has the conventions. The review run is specified in
[`../specs/review-flow.md`](../specs/review-flow.md). Paths are relative to `server/`.

## Boot sequence

1. `src/server.ts:6-7` — `loadConfig()` then `buildApp({ config })`, then it listens on
   `API_HOST:API_PORT` — loopback (`localhost`: 127.0.0.1 and ::1) unless `API_HOST` opts out, because the API has
   no auth (`:42`). An `unhandledRejection` handler logs instead of letting Node exit (`:11-13`).
   SIGTERM/SIGINT run `app.close()` once (`:18-39`); if it has not finished after
   2 × `SHUTDOWN_GRACE_MS` (20 s), the process exits with 1 (`:26-31`, `src/app.ts:41`).
2. `loadConfig` (`src/platform/config.ts:87-113`) imports `dotenv/config` (`:1`) and
   zod-parses env (`:15-54`). API keys are **not** in `AppConfig` (`:9-13`). The
   secrets path defaults to `~/.devdigest/secrets.json`; `DEVDIGEST_SECRETS_PATH` overrides it
   (the test config does) (`:101-103`).
3. `buildApp` (`src/app.ts:63-270`), in this order:
   - DB via `createDb` unless `opts.db` is passed (`:64-66`); Fastify with a 1 MiB
     `bodyLimit`, a 30 s `requestTimeout` — the time a client gets to send its whole request,
     so SSE responses stay open — and a pino logger that redacts request auth headers and
     the ones SDK errors carry (`:68-96`); zod compilers (`:100-101`);
     `new Container(config, db, overrides)` decorated as `app.container` (`:103-104`).
   - **Reaper**, awaited before any plugin: every `agent_runs` row still `running`
     becomes `failed` with the error `The API restarted while this run was in progress`
     and no duration, and every `jobs` row still `queued` or `running` becomes `failed`
     (`:106-124`, `src/modules/reviews/repository/run.repo.ts:119-126`,
     `src/platform/jobs.ts:227-234`). If it throws, boot only logs a warning. It assumes
     one API instance per DB (`src/app.ts:114-115`).
   - **Trace retention**, `TRACE_RETENTION_DAYS` (default 90, `0` turns it off): the traces of finished runs
     that started before the cutoff are deleted at boot and then daily; the run rows stay
     (`src/app.ts:126-144`, `src/modules/reviews/repository/run.repo.ts:132-142`).
   - A `preClose` hook for shutdown (`src/app.ts:146-149`): `runBus.shutdown()` aborts every live
     run and ends every open event stream, which `close()` would otherwise wait on
     forever; then it waits up to `SHUTDOWN_GRACE_MS` (10 s, `:41`) for the runs to
     record how they ended and for `jobs.close()`. The DB closes later, in `onClose`.
   - helmet; cors with `origin: http://localhost:${WEB_PORT}`; the SSE plugin (`:153-155`).
   - While `API_HOST` is loopback, a request whose `Host` is not a loopback name is a 403
     `forbidden_host` — the DNS-rebinding guard for this unauthenticated API (`:157-167`).
     The global rate limit (120/min; a hit is a 429 `rate_limited`) is **not registered**
     under `NODE_ENV=test` (`:169-181`), so per-route `config.rateLimit` caps do nothing in
     tests. The reads the UI polls opt out with `config.rateLimit: false`: the SSE stream,
     `/pulls/:id/runs/active`, `/pulls/:id/runs` (`src/modules/reviews/routes.ts:63`,
     `:158`, `:165`) and `/repos/:id/index-state` (`src/modules/repo-intel/routes.ts:35`).
   - `/health` and `/health/ready` (`src/app.ts:183-205`): the latter is a 503 with
     `reason: 'db_unreachable'` when the DB ping fails, and a 503 with
     `reason: 'migrations_pending'` and the count when the DB has applied fewer migrations
     than this build ships in its drizzle journal (`src/db/migration-status.ts:9-23`;
     test `test/integration.it.test.ts:357-375`). Then the error handler (`src/app.ts:207-253`),
     a not-found handler with the same envelope (`:255-258`), the modules (`:262-264`), and
     an `onClose` that closes the pool only if `buildApp` created it (`:267`).

The reaper runs on **every** `buildApp`, tests included. The server's vitest config points
`DATABASE_URL` at an unreachable port (`vitest.config.ts:29`), so an app built without a
`db` (`test/routes-smoke.test.ts:15`) never reaches the dev DB — its reaper only logs a
warning. A second app built while a run of the first is in flight marks that run
`failed`; the first app's final write only lands on a `running` row, so the run stays
`failed` and saves no review (`src/modules/reviews/repository/run.repo.ts:211-216`). A
job row has no such guard: the first app's JobRunner writes its final status over the reap.

## The container (`src/platform/container.ts`)

One per app, and the composition root: it builds the adapters and repositories. Each
module's `routes.ts` builds its service once from them, as a `deps` object of that module's
ports (e.g. `src/modules/reviews/routes.ts:24-32`). Only repo-intel's service still takes
the whole container (`src/modules/repo-intel/routes.ts:29`); repo-intel is do-not-touch.

| Member | Built | Override |
| ------ | ----- | -------- |
| `config`, `db` | passed in by `buildApp` | `buildApp({ config, db })` |
| `secrets` | eager: `LocalSecretsProvider(config.secretsPath)` (`:99`) | `secrets` |
| `auth` | eager: `LocalNoAuthProvider(workspaceRepo, { email, workspaceName })` with the seeded identity (`:100-102`) | `auth` |
| `runBus` | eager: `new RunBus()`, one per app (`:103-104`) | `runBus` |
| `jobs` | eager: `new JobRunner(db)` (`:105`) | — |
| `git`, `codeIndex` | lazy getters (`:108-112`, `:158-162`) | `git`, `codeIndex` |
| `agentsRepo`, `skillsRepo`, `reviewRepo`, `pullsRepo`, `settingsRepo`, `workspaceRepo`, `reposRepo` | lazy getters (`:114-132`, `:142-144`; `skillsRepo` `:131-133`) | — |
| `prDiffs` | lazy: `PrDiffSource` over `git` and the stored `pr_files` patches (`:134-140`) | through `git` |
| `repoIndexing` | a fresh object per access whose `index`/`refresh` enqueue repo-intel's `INDEX_JOB_KIND`/`REFRESH_JOB_KIND`, so the repos module never names them (`:146-156`) | — |
| `repoIntel`, `depgraph`, `tokenizer` | lazy getters (`:164-187`) | same names |
| `priceBook` | lazy; lists OpenRouter models if a key exists, else `[]` (`:189-206`) | — |
| `github()` | async, cached; `ConfigError` without `GITHUB_TOKEN` (`:208-215`) | `github` |
| `llm(id)` | async, cached **per id** (`:217-226`) | `llm[id]` |
| `checkCredentials(provider, key?)` | async; tries a candidate key on a fresh, uncached client, else the stored key (`:254-267`) | `github`, `llm[id]` |
| `embedder()` | async; `ConfigError` unless `EMBEDDINGS_ENABLED=true` (`:269-282`) | `embedder` |

- `llm('openai' | 'anthropic')` builds `src/adapters/llm/openai.ts` / `anthropic.ts`.
  `llm('openrouter')` builds reviewer-core's `OpenRouterProvider`. Each gets
  `priceBook.estimatorFor(id)` as its cost estimator (`src/platform/container.ts:272,280,285`, in `buildLlm`, `:265-286`);
  OpenAI/Anthropic return tokens only, so their models are priced under the catalog alias (`src/platform/price-book.ts:17-22`).
  The container imports it from the `@devdigest/reviewer-core/llm/openrouter.js` subpath
  (`:26`): the package index does not export it, and `pnpm arch` allows that import here only.
- With `DEVDIGEST_FAKE_LLM=1` (`config.fakeLlm`) every agent gets `FakeReviewLlm` instead
  (`:240`, `src/adapters/llm/fake.ts:45`): one WARNING on the diff's first added line, no key,
  no network. It is for the e2e review flow; `loadConfig` refuses it under
  `NODE_ENV=production` (`src/platform/config.ts:89-91`).
- The overridable set is `ContainerOverrides` (`:52-68`). You cannot override
  `priceBook`, the repositories, `prDiffs`, `repoIndexing` or `jobs`. Getters check the override
  before the cache, so an override always wins (`:122`, `:226`, `:236-237`, `:291`).
- `runBus` is one per app, so closing one app never ends another app's streams (`:115-116`).
  Tests pass their own bus through `overrides.runBus` (`test/run-lifecycle.it.test.ts:168-179`).
- `invalidateSecretCaches()` drops the cached LLM clients, the GitHub client and the
  embedder (`src/platform/container.ts:322-326`). Its only caller is `SettingsService.testConnection`, right
  after it saves a key that passed the test (`src/modules/settings/service.ts:57-60`).
- A service's dependencies are its module's ports: `AgentDeps`, `SkillsDeps`, `RepoDeps` (with the
  `RepoIndexing` port), `PullsDeps`, `PollingDeps`, `SettingsDeps`, `WorkspaceDeps` and
  `ReviewDeps` — store, agents (whose `enabledSkills` feeds a run's prompt), run bus, diff source,
  repo context, LLM (`src/modules/agents/ports.ts:56`, `src/modules/skills/ports.ts:52-55`,
  `src/modules/repos/ports.ts:40-57`,
  `src/modules/pulls/ports.ts:22`, `src/modules/polling/ports.ts:20`,
  `src/modules/settings/ports.ts:15`, `src/modules/workspace/ports.ts:13`,
  `src/modules/reviews/ports.ts:113`). The container's repositories and adapters satisfy
  them structurally; secrets-backed adapters go in as functions
  (`github: () => container.github()`), so a missing key still surfaces on first use.
  Tests pass in-memory fakes (`test/repos-service.test.ts`, `test/pulls-service.test.ts`,
  `test/settings-service.test.ts`).
- Most adapter interfaces come from `@devdigest/shared` (`src/platform/container.ts:1-12`, `src/vendor/shared/adapters.ts:10-12`).
  Exceptions: `DepGraph` and `Tokenizer` live in their adapter files
  (`src/adapters/depgraph/index.ts:27`, `src/adapters/tokenizer/index.ts:16`), and
  `RepoIntel` in `src/modules/repo-intel/types.ts:137`. repo-intel imports ast-grep
  directly and never gets it from the container (`src/modules/repo-intel/pipeline/full.ts:29`).

## How tests swap adapters

- Pass `buildApp({ config, db, overrides })` (`src/app.ts:50-54`). Examples: `appWith`
  and `appWithLlm` in `test/reviews.it.test.ts:119-135`, `:227-238`.
- `src/adapters/mocks.ts`:
  - `MockLLMProvider` parses its fixture with the request's schema and **throws** on
    a mismatch (`:91-97`). A `{}` fixture is how tests produce a failed run
    (`test/reviews.it.test.ts:301-303`). Every call reports 100/50 tokens and $0.001
    (`:78-86`, `:96-104`). `structuredBySchema` picks a fixture per `schemaName` (`:53`, `:91`).
  - `MockGitClient` returns a default one-file diff (`:281-286`); `MockGitHubClient`
    records what it posts (`:130-135`). `MockSecretsProvider` has no `set()` (`:325-330`),
    so saving a key returns "Secrets backend is read-only" (`src/modules/settings/service.ts:46`).
- Anything you do not override is the real adapter, but no test can reach a real key or
  the dev DB: the vitest config blanks every provider key and `GITHUB_TOKEN`, and points
  `DEVDIGEST_SECRETS_PATH` at a throwaway file and `DATABASE_URL` at an unreachable port
  (`vitest.config.ts:18-30`); `dotenv` never overrides a variable that is already set.
  `appWith` also overrides `secrets` and `openrouter` (`test/reviews.it.test.ts:126-130`),
  because "run all enabled agents reviews with each enabled agent"
  (`test/reviews.it.test.ts:602-611`) runs the seeded OpenRouter agents
  (`src/db/seed.ts:15`, `src/platform/container.ts:280`).

## Modules and request context

- The registry is static: `settings, repos, pulls, polling, workspace, agents, skills, reviews,
  repoIntel` (`src/modules/index.ts:27-38`); `:16-19` says why there is no autoload.
  `@fastify/autoload` is still a dependency (`package.json:22`) that nothing imports.
- Each module is a plain async plugin registered with `await` (`src/app.ts:262-264`), so
  it is encapsulated and inherits `app.container` and the root error handler. Eight of
  the nine call `withTypeProvider<ZodTypeProvider>()` (e.g. `src/modules/reviews/routes.ts:22`).
  `workspace` declares no schema at all (`src/modules/workspace/routes.ts:12`).
- Job handlers are registered when their module registers (`src/modules/repos/routes.ts:32`,
  `src/modules/repo-intel/routes.ts:30`). The main GET routes (repos, the PR list and detail,
  runs, reviews, a trace, agents, settings) declare a `response` schema from `@devdigest/shared`;
  a reply that fails it takes the response-serialization branch, a logged 500
  (`src/app.ts:224-229`; test `test/error-envelope.test.ts:36-37,54-55`).
- `settings` has a service and a repository behind ports (`src/modules/settings/ports.ts`);
  its routes are transport only (`src/modules/settings/routes.ts:23-59`). `PUT /settings`
  accepts only the known preference keys, so an unknown key is a 422, not a new stored row
  (`src/vendor/shared/contracts/platform.ts:102-103`).
- `getContext` resolves the user and the workspace (`src/modules/_shared/context.ts:15-24`).
  `LocalNoAuthProvider` looks up the seeded `you@local` / `default` (`src/db/seed.ts:44-45`,
  passed in by the container) through its `IdentityStore` port — the workspace repository
  (`src/adapters/auth/local.ts:4-14`, `src/modules/workspace/repository.ts:26-40`) — once,
  and caches them for the process lifetime (`src/adapters/auth/local.ts:23-47`): after a
  DB reset and reseed, a running API keeps the old workspace id. A missing seed throws
  `ConfigError` (`:35`, `:43`) → a 500 `config_error`; test `test/auth-local.test.ts:25-44`.
  `IdParams` requires a uuid (`src/modules/_shared/schemas.ts:11`), so a bad `:id` is a
  422 before the handler.
- Every id in a path is checked against the caller's workspace: an id from another
  workspace is a 404, as if it didn't exist. Services do it in their queries; repo-intel's
  routes, which address repos they don't own, call `requireRepoInWorkspace`
  (`src/modules/_shared/context.ts:26-36`, `src/modules/repo-intel/routes.ts:39`, `:49`). Test:
  `test/tenant-scoping.it.test.ts:57-88` (runs, repos and PRs of another workspace).

## Error model

Classes are in `src/platform/errors.ts`. Every mapped body is `{ error: { code, message, details } }`.

| Thrown | Status · `code` | Where |
| ------ | --------------- | ----- |
| route schema failure | 422 · `validation_error` (`details` = issues) | `src/app.ts:214-223` |
| `AppError` (default 400), `NotFoundError`, `ValidationError`, `ConflictError`, `ExternalServiceError`, `ConfigError` | own status: 400, 404, 422, 409, 502, 500; a 5xx one is also logged | `src/app.ts:231-237`, `src/platform/errors.ts:7-48` |
| a 4xx that Fastify or a plugin raises: malformed JSON, a body over 1 MiB, an unsupported content type, the rate limit | its status · `bad_request`, `payload_too_large`, `unsupported_media_type`, `rate_limited`, …, with Fastify's message | `src/app.ts:24-36`, `:244-250` |
| anything else, a `ZodError` from our own data (a stored snapshot, a provider's answer) included | 500 · `internal_error`, message `Internal error`; the error itself only goes to the log | `src/app.ts:238-243`, `:251-252` |
| unknown route | 404 · `not_found` | `src/app.ts:255-258` |

- A 500's raw message never reaches the client: it can carry SQL, a constraint name or a
  file path. Tests: `test/error-envelope.test.ts:48-80`.
- Every route validates its body by schema, `POST /pulls/:id/review` included (`RunRequest`,
  whose `agentId` must be a uuid; `src/modules/reviews/routes.ts:40`), so a bad body is a 422
  (`test/error-envelope.test.ts:82-88`).
- Statuses that are easy to miss: `invalid_repo_url` is a 422 (`src/modules/repos/helpers.ts:29`);
  an enqueue after shutdown began is a 503 `shutting_down` (`src/platform/jobs.ts:96`).

## Secrets read path (`src/adapters/secrets/local.ts`)

- The file is read once, on first use, and cached. A missing file counts as `{}`; a file
  that is not JSON, or not a map of strings, throws `ConfigError` instead of silently
  dropping every stored key (`:29-52`).
- `get` returns a non-empty stored value first (`:55-56`). Otherwise `GITHUB_TOKEN` falls
  back to env `GITHUB_TOKEN`, then env `GITHUB_PAT` (`:57`), and every other key reads env (`:58`).
- `set` writes the whole map to a temp file with mode `0600` (`chmod`ed too, for an
  existing file), renames it over the real one, and updates the cache; a directory it has to
  create gets `0700` (`:61-71`). A key saved in the UI works at once
  (with `invalidateSecretCaches()`); a hand edit of the file or env needs a restart.
  Tests: `test/secrets-local.test.ts:16-40`.
- `POST /settings/test-connection` with a key checks that key first and saves it only when the
  check passes; a failed check keeps the old key and says `— the key was not saved`
  (`src/modules/settings/service.ts:44-62`; tests `test/settings-service.test.ts:48-72`).
- A missing key makes the container getters throw `ConfigError`, which is a 500 `config_error`
  (`src/platform/container.ts:248`, `:271`, `:279`, `:283`). Inside a review it fails the run instead.

## JobRunner (`src/platform/jobs.ts`)

- p-queue: concurrency 3, a 120 s timeout, 2 retries (`:84-86`). Each job has a `jobs` row that
  goes `queued` → `running` → `done`/`failed` (`:123-173`). An unknown kind throws (`:95`),
  and any `enqueue` after `close()` is a 503 `shutting_down` (`:96`).
- A job whose payload has a `repoId` runs alone for that repo, whatever its kind: it enters
  the queue only once the previous job for the repo has let go (`:176-189`), because clone,
  index, refresh and resync rewrite the same clone and index tables. A request for the same
  kind and repo while such a job has not started yet returns that job instead of a second one
  (`:98-112`). Tests: `test/jobs.test.ts:77-121`.
- Only 429, 5xx and network errors are retried (`src/platform/resilience.ts:36-45`). A
  `TimeoutError` is not. `withTimeout` does not stop the handler, which keeps running after
  its row says `failed` (`src/platform/resilience.ts:13-23`); the repo stays locked until
  that handler settles, or one more timeout at most (`src/platform/jobs.ts:47-59`, `:180-189`;
  test `test/jobs.test.ts:123-140`).
- GitHub writes are never retried: `postReview`, `createReviewComment`, `openPullRequest` and
  `commitFiles` pass `NO_RETRY` (`src/adapters/github/octokit.ts:24,272,354,374,443`), since a
  retry after a lost response would post a second review or comment. Reads keep the retries.
- Users: clone (`src/modules/repos/service.ts:32-36`; it also records the branch the remote's
  HEAD names, so a resync fetches `master` or `develop` rather than a guessed `main`,
  `:46-54`) and index/refresh/resync
  (`src/modules/repo-intel/service.ts:173-181`). The queue lives in memory: boot fails the
  rows a dead process left `queued` or `running` (`src/platform/jobs.ts:227-234`) and nothing resumes them.
  On shutdown `close()` fails the jobs that have not started with `The API shut down before
  this job finished` and waits up to the grace period for the running ones (`src/platform/jobs.ts:209-221`;
  test `test/jobs.test.ts:144-165`). Tests wait with `app.container.jobs.onIdle()`
  (`test/integration.it.test.ts:196`), which also waits for jobs queued behind their repo (`src/platform/jobs.ts:199-202`).
- **Reviews do not use it.** They are fire-and-forget into their own queue: `container.reviewQueue`, a
  p-queue that runs `REVIEW_CONCURRENCY` review requests at once (default 2) while the rest wait
  (`src/platform/container.ts:85`, `src/modules/reviews/service.ts:130-143`); see
  [`../specs/review-flow.md`](../specs/review-flow.md).

## Writes that must stay consistent

- The PR list sync (`POST /repos/:id/poll`; `GET /repos/:id/pulls` only reads) is incremental: the
  first poll reads every page, later ones only the PRs updated since `repos.pulls_synced_through`,
  the newest `updated_at` the last poll imported (migration `0014`; `src/adapters/github/octokit.ts:64-110`,
  `src/modules/polling/service.ts:21-48`). The watermark moves only after the PRs are stored. The
  import is one transaction, `PullsRepository.upsertFromGitHub`, in 500-row statements so a big repo
  stays under Postgres's parameter limit: it refreshes title, author, branch, base, head, status
  and `updated_at`, keeps `opened_at` when GitHub sends none, and keeps the diff stats the
  list payload lacks (`src/modules/pulls/repository.ts:173-223`). Those come from
  `getDiffStats`: 100 PRs per GraphQL query, else up to 30 by REST when GraphQL refuses the token
  (a warning in the log says so: the container hands the adapter `app.log`, `src/app.ts:103`),
  for up to 1000 PRs a poll — first the ones this poll saw change, then those still without
  (`src/adapters/github/octokit.ts:112-179`, `src/modules/polling/domain.ts`). A detail refresh
  replaces the PR's files and commits and updates its body and stats in one transaction, on
  the unique `(pr_id, path)` and `(pr_id, sha)` indexes (`src/modules/pulls/repository.ts:225-274`,
  `src/db/schema/pulls.ts:51`, `:64`); the GitHub adapter reads every page of both
  (`src/adapters/github/octokit.ts:190-203`). Tests: `test/integration.it.test.ts:313-337`, `:339-354`;
  all pages, the incremental stop, batched stats and the chunked upsert: `test/octokit-pulls.test.ts`,
  `test/pulls-service.test.ts`, `test/integration.it.test.ts:206-248`, `:264-291`.
- Adding a repo is one insert that ignores a conflict on `(workspace_id, lower(full_name))`,
  so the same repo in another letter case, or added twice at once, stays one repo
  (`src/modules/repos/repository.ts:38-59`, `src/db/schema/repos.ts:26`;
  test `test/integration.it.test.ts:301-311`).
- An agent's config edit and a change to its skill links — the set, the order or a per-agent
  `enabled` flag — each bump `version` and write that version's snapshot in one transaction that
  locks the agent row (`src/modules/agents/repository.ts:99-144`, `:268-305`). The snapshot's
  `skills` lists the enabled links' ids in prompt order and `skill_links` every link with its flag
  (`:144-160`); tests `test/agents-versions.it.test.ts:200-260`, `:262-317`. Linking a skill that
  isn't in the agent's workspace is a 404 `Skill not found`, checked before that transaction
  (`src/modules/agents/service.ts:129-134`; test `test/agents-versions.it.test.ts:333-349`).
- A skill's content edit (name, description, type or body) bumps `skills.version` and writes a
  `skill_versions` snapshot with a note in one transaction that locks the skill row; toggling
  `enabled` alone writes no version, and a restore is a new version (`src/modules/skills/domain.ts:91-114`,
  `src/modules/skills/repository.ts:57-113`). A name taken in the workspace hits the unique
  `skills_ws_name_uq` index and is a 409 `conflict` (`src/db/pg-errors.ts:8-15`). Deleting a skill
  cascades its versions and its agent links (`src/db/schema/skills.ts`, `src/db/schema/agents.ts`),
  without bumping those agents' versions; tests `test/skills.it.test.ts`. The injection gate stores
  nothing: every `Skill` DTO computes `injection_detected` from the description and body
  (`src/modules/_shared/prompt-injection.ts`). `PUT {enabled: true}` on flagged text is a 422,
  thrown inside the same row-lock callback so nothing is written, and a run drops a flagged skill
  (`splitInjectedSkills`, `src/modules/reviews/helpers.ts`;
  [`../specs/05-skill-url-import.md`](../specs/05-skill-url-import.md)).
- Money (`cost_usd` on `agent_runs`, `eval_runs`, `ci_runs`) is `numeric` since migration
  `0013`: exact in the database, a `number` in JS (`src/db/schema/runs.ts:27`); the PR list's
  COST is summed in SQL (`src/modules/pulls/repository.ts:137-147`).
- Migrations `0011` (removes the rows the new constraints would reject) and `0012` (the
  constraints) back these writes. `test/migrations-safety.test.ts:31-41` fails on a
  `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA` or `TRUNCATE` in a migration outside its allowlist.

## Adding an adapter

1. Interface in `src/vendor/shared/adapters.ts` (a contract change: mirror it in
   `../client/src/vendor/shared/adapters.ts`); implementation in `src/adapters/<name>/`.
   There is no `src/adapters/index.ts` barrel: the container imports the file.
   When one module is the only user, skip the shared interface: declare the port in that
   module's `ports.ts` and let the adapter class match it structurally, with no import
   between them — `DiffSource` (`src/modules/reviews/ports.ts:87`) ↔ `PrDiffSource`
   (`src/adapters/git/pr-diff.ts:12`), `SkillFileFetcher` (`src/modules/skills/ports.ts`) ↔
   `SafeHttpsFetcher` (`src/adapters/http/safe-fetch.ts`).
2. A private field and a lazy getter in the container. Make it async if it needs a secret,
   throw `ConfigError` when the secret is missing, and clear it in `invalidateSecretCaches()`.
3. A `ContainerOverrides` key, checked first in the getter, and a deterministic mock in
   `src/adapters/mocks.ts` that tests inject through `overrides`.
4. Services never see the container or import the class: the service's module declares
   the interface it needs in `ports.ts`, and its `routes.ts` passes `container.<name>`
   into the service's `deps`.
5. `pnpm arch` must pass: an adapter imports no `src/modules/**`, `src/db/**` or Fastify
   (rule `onion-adapters-outer-ring`).
6. Anything from a PR, a user or a repo is data, never a flag or a path outside the clone.
   The git adapter puts `--end-of-options` (or `--`) before refs and paths
   (`src/adapters/git/simple-git.ts:134,166,180,188`) and `readFile` resolves symlinks and
   refuses a path outside the clone with a 400 `invalid_repo_path` (`:207-214`; test
   `test/git-adapter.test.ts:100-116`); ripgrep takes the pattern after `-e` and the root
   after `--` (`src/adapters/codeindex/ripgrep.ts:61`).
   An outbound fetch of a URL a user typed goes through `SafeHttpsFetcher`'s SSRF guard: https
   on the default port, every resolved address checked at connect time against private and
   loopback ranges, each redirect re-validated, a timeout and a byte cap
   ([`../specs/05-skill-url-import.md`](../specs/05-skill-url-import.md)).

## Layers and import rules

Where code goes and which way imports may point is the `onion-architecture` skill
(`../../.claude/skills/onion-architecture/SKILL.md`): `domain.ts` ← `ports.ts` ←
`service.ts` ← `routes.ts` / `repository.ts` / `src/adapters/`, wired only in the
container. `pnpm arch` (dependency-cruiser, `.dependency-cruiser.cjs`) checks `src/` and
`../reviewer-core/src/`. The 64 violations that existed on 2026-09-27 are frozen in
`.dependency-cruiser-known-violations.json`; the file may only shrink (`pnpm arch:stale`).
After the 2026-09-28 refactor 26 remained, and 25 since the unused repo-intel barrel was
deleted on 2026-09-29, all inside `src/modules/repo-intel/` (do-not-touch). Dead code is a
failure too: `no-orphans` and `no-unreachable-from-entry` flag a file nothing reaches from
`src/server.ts` or the db scripts (tests aren't cruised).
`onion-core-public-api-only` lets `src/` import only reviewer-core's `src/index.ts` and its
provider subpath, and `onion-core-provider-in-root-only` lets only `platform/container.ts`
import the provider.
The parse-scope constants the ast-grep and dependency-graph adapters share with repo-intel
live in `src/platform/code-scope.ts:7-11` (`src/modules/repo-intel/constants.ts:15` re-exports
them), so no adapter imports a module. `pnpm arch` can't see a route reaching into the
container — `app.container.db` is a property, not an import — so
`test/routes-container-ratchet.test.ts:17-39` counts `container.db` and method calls on
container members in every `routes.ts`; only repo-intel's 2 are allowed, and the count may
only go down.
