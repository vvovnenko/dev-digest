# Hermetic runner

How `npm run e2e:hermetic` works today: `../scripts/e2e.sh` boots a throwaway, seeded
stack on alternate ports, then `run.ts` drives the flows through agent-browser. Flow
format, `{BASE}`, env knobs and coverage are in [`../README.md`](../README.md); this
page covers what happens underneath, how it differs from CI, what it does **not**
isolate, and how to debug a failure. Citations are `path:line`, relative to `e2e/`.

## Entry points

`./scripts/e2e.sh` from the repo root, or `npm run e2e:hermetic` from `e2e/`
(`package.json:12`). Local only: CI boots its own stack and runs `npm test`
(`../scripts/e2e.sh:17-18`). The script installs whatever deps are missing in `server/`,
`client/`, `reviewer-core/` and `e2e/` (`../scripts/e2e.sh:129-142`), and ends with
`npm test` → `tsx run.ts` (`../scripts/e2e.sh:190`, `package.json:11`).

## What is isolated

| Resource | Hermetic | Dev stack (`./scripts/dev.sh`) |
| -------- | -------- | ------------------------------ |
| Postgres | `devdigest-e2e-postgres` on `127.0.0.1:5433`, `pgvector/pgvector:pg16`, no volume (`../scripts/e2e.sh:26-28,110-117`) | `devdigest-postgres` on `127.0.0.1:5432`, volume `devdigest_pgdata` (`../docker-compose.yml:6,15,17`) |
| API | `:3101`, fake LLM, no GitHub token or stored keys (`../scripts/e2e.sh:32,47-56`) | `:3001` (`../server/src/platform/config.ts:29`) |
| Web | `next dev -p 3100` into `client/.next-e2e` (`../scripts/e2e.sh:33,44-46,175`, `../client/next.config.mjs:9`) | `next dev -p 3000` into `client/.next` (`../client/package.json:6`) |

Each default is an `E2E_*` override (`../scripts/e2e.sh:26-33`); besides the README's
five there are `E2E_PG_DB`, `E2E_PG_USER`, `E2E_PG_PASS` (all `devdigest`). The
wiring is exported **before** anything starts (`../scripts/e2e.sh:35-56`):

- `DATABASE_URL` on `127.0.0.1`, not `localhost`, dodging an IPv6 `::1` mismatch (`../scripts/e2e.sh:38-40`).
- `API_PORT`, `WEB_PORT`: the API listens on the first and takes its CORS origin
  from the second (`../server/src/platform/config.ts:32,37,106`).
- `NEXT_PUBLIC_API_BASE=http://localhost:3101`, inlined by `../client/next.config.mjs:11`;
  `E2E_BASE_URL=http://localhost:3100`, read by `run.ts:44`.
- `NEXT_DIST_DIR=.next-e2e`, read as `distDir` by `../client/next.config.mjs:9`: the
  hermetic web never touches the dev web's `client/.next` (`../scripts/e2e.sh:44-46`).
- `DEVDIGEST_FAKE_LLM=1`: the API answers reviews with a deterministic fake model, so a
  flow can run a review without a key (`../scripts/e2e.sh:47-49`).
- `DEVDIGEST_SECRETS_PATH` and `DEVDIGEST_CLONE_DIR` in a throwaway `mktemp -d` dir, and
  `GITHUB_TOKEN` / `GITHUB_PAT` set but empty (`../scripts/e2e.sh:50-56`; the trap removes
  the dir, `:94`). Without them the API used your `~/.devdigest` keys and clones and
  called GitHub for `acme/payments-api` (404 warnings), which CI never does.

The server reads `server/.env` via `import 'dotenv/config'`
(`../server/src/platform/config.ts:1`, `../server/src/db/migrate.ts:1`,
`../server/src/db/seed.ts:1`), which never overrides a set variable: the exports
win, the rest of `server/.env` still applies (`../scripts/e2e.sh:35-37`).

## Boot sequence

1. **Prerequisites.** `docker` and `pnpm` are required; a missing `agent-browser` only
   warns (`../scripts/e2e.sh:62-65`). The check ignores `AGENT_BROWSER_BIN`.
2. **Teardown trap**, before anything starts (`../scripts/e2e.sh:67-105`).
3. **Postgres.** Remove a leftover container, `docker run -d --rm` with a
   `pg_isready` healthcheck, poll up to 60 × 1 s (`../scripts/e2e.sh:107-127`).
4. **Deps**, only where `node_modules` is missing: `pnpm install --frozen-lockfile` in
   `server/` and `client/`, `npm ci` in `reviewer-core/` and `e2e/` (`../scripts/e2e.sh:129-142`).
5. **Guard.** Refuse unless `DATABASE_URL` has `:<E2E_PG_PORT>/` (`../scripts/e2e.sh:145-149`).
6. **Migrate + seed** the empty DB (`../scripts/e2e.sh:150-153`), so
   `acme/payments-api` is the only repo; data in [`../specs/flows.md`](../specs/flows.md).
7. **API** via `pnpm exec tsx src/server.ts`: no watcher to restart it mid-suite
   (`../scripts/e2e.sh:155-160`). Poll `GET /health`
   (`../server/src/app.ts:184`) up to 60 × 1 s; stop early if the process died
   (`../scripts/e2e.sh:161-168`).
8. **Web.** Copy `client/tsconfig.json` and `client/next-env.d.ts` aside (`next dev`
   rewrites both for its dist dir), then `pnpm exec next dev -p $WEB_PORT` in `client/`,
   polled the same way (`../scripts/e2e.sh:171-185`).
9. **Flows.** `cd e2e && npm test` under `set +e`; the script exits with its code and
   the trap keeps it (`../scripts/e2e.sh:187-193,86,103`).

API and web logs are not redirected, so they interleave with the flow output
(`../scripts/e2e.sh:159,175`).

## Teardown

On `EXIT`, `INT` or `TERM` (`../scripts/e2e.sh:105`): `kill_tree` the web, then the
API, leaves first, because `pnpm exec tsx` and `next dev` run the listener as a
grandchild that a plain `kill` would orphan (`../scripts/e2e.sh:75-89`). Then put back
the `client/tsconfig.json` and `next-env.d.ts` saved before the web started
(`../scripts/e2e.sh:70-74,90-94`). A backstop kills whatever still listens on the two
alternate ports, never `3000`/`3001` (`../scripts/e2e.sh:95-101`), so anything else of
yours on `3100`/`3101` dies too. Last, `docker rm -f` the container (`../scripts/e2e.sh:102`).

## How `run.ts` runs the flows

- **Discovery + validation.** Only `specs/*.flow.json`, in filename order (`run.ts:74`);
  no single-flow filter. Every file is parsed and checked before any runs — valid JSON,
  a non-empty `name`, a non-empty `steps` array, each `cmd` a non-empty array of strings,
  string `label` / `assert.stdoutIncludes` when present (`run.ts:71-91`, `lib/flow.ts:13-48`).
  Any problem lists every bad file with what is wrong, and exits 1 (`run.ts:86-89`). No
  spec at all → exit 1 (`run.ts:134-137`).
- **Step.** One `execFile(AGENT_BROWSER_BIN, ["--session", <flow id>, ...args], { cwd: e2e/,
  timeout: E2E_STEP_TIMEOUT })` with `{BASE}` substituted and its trailing slash trimmed
  (`run.ts:49-56,100`, `lib/assert.ts:37-40`); non-zero exit or timeout fails it. The cwd
  holds `agent-browser.json`, which sets `"headed": false` (`agent-browser.json:3`).
- **`assert.stdoutIncludes`**: a substring check that prints the stdout it searched
  (`run.ts:104-109`); no flow uses it.
- **Failure.** The first failing step ends its flow (`run.ts:108,119`); the next flow
  still runs (`run.ts:140-142`). The output shows the error's first line, then
  agent-browser's whole stderr and stdout, labelled (`run.ts:58-66,113-115`). A failed
  command takes a best-effort `test-results/<flow file without .flow.json>-fail.png`
  (`run.ts:94,116-118`); a failed `stdoutIncludes` check takes none.
- **Session.** One per flow, named after the flow file (`01-app-boot`, …) and closed in
  `finally`, so cookies, storage and the open page never leak into the next flow
  (`run.ts:50,94,122-125`). Every flow starts with `open`.
- **Result.** `PASS`/`FAIL` per flow, then `N/M flows passed` (`lib/assert.ts:46-57`);
  exit 1 if any flow failed (`run.ts:145`).

Commands in use: `open`, `wait --load networkidle`, `wait --url|--text`, `find text … click`,
`find role button click --name …` (flows); `screenshot`, `close` (`run.ts:118,124`); all
with the global `--session <name>` option (agent-browser 0.27: an isolated session).

## Hermetic vs CI

| | `../scripts/e2e.sh` | `../.github/workflows/e2e-web.yml` |
| - | ------------------- | ---------------------------------- |
| Ports | 5433 / 3101 / 3100 | 5432 / 3001 / 3000 (`e2e-web.yml:38-41`) |
| Postgres | own `docker run --rm` | `docker compose up -d` on a fresh runner (`e2e-web.yml:61-70`) |
| Web | `next dev` into `client/.next-e2e` | `pnpm build` + `pnpm start`, a production build (`e2e-web.yml:102-113`) |
| Installs | `--frozen-lockfile` / `npm ci`, only where `node_modules` is missing | `--frozen-lockfile` and `npm ci` every run (`e2e-web.yml:76,87,105,118-119`) |
| agent-browser | must already be installed | `npm i -g` + `agent-browser install --with-deps` (`e2e-web.yml:116-119`) |
| Failure screenshots | stay in `e2e/test-results/`, git-ignored (`../.gitignore:22`) | uploaded as artifact `e2e-failure` (`e2e-web.yml:127-134`) |
| Server logs | your terminal | `$RUNNER_TEMP/api.log`, `web.log`, printed only if boot fails (`e2e-web.yml:93,99,107,113`) |

CI runs on push to `main` or a PR touching `client/**`, `server/**`, `reviewer-core/**`
(the API runs its source, `e2e-web.yml:80-84`), `e2e/**`, `docker-compose.yml` or the
workflow (`e2e-web.yml:12-29`). `scripts/**` is not in the list: CI never runs
`../scripts/e2e.sh`, so a change to it alone does not run the suite.

## Not isolated

- **Secrets and GitHub are isolated now** (see the exports above, `../scripts/e2e.sh:50-56`): no stored
  key and no token, so the studio never imports PRs (`../client/src/lib/hooks/core.ts:139-157` waits for a
  GitHub token), and a PR detail read logs a warning and serves the seeded rows
  (`../server/src/modules/pulls/service.ts:40-57`).
- **`client/tsconfig.json` and `client/next-env.d.ts`.** `next dev` rewrites both for its
  dist dir; the trap restores them (`../scripts/e2e.sh:90-94`), but a `kill -9` of the
  script leaves them modified — `git checkout` them if `git status` shows them.

## Pitfalls

- **Shared `client/.next` (fixed 2026-09-28).** Both webs used to build into `client/.next`,
  so a hermetic run left the dev web pointing at `:3101` ("Cannot reach the DevDigest
  engine at http://localhost:3101", `../client/src/lib/api.ts:37`) or serving 404s. The
  hermetic web now builds into `client/.next-e2e` (`../scripts/e2e.sh:44-46`,
  `../client/next.config.mjs:9`); if you still see this, restart the dev web.
- **The dev stack can go down.** Observed 2026-09-23 (before the separate dist dir; cause
  not traced): the dev web on `:3000` exited during a hermetic run. `dev.sh` runs the client
  in the foreground, so the script then ends and its `EXIT` trap kills the API tree; Postgres
  stays up (`../scripts/dev.sh:109-113,121`; root `INSIGHTS.md` → Recurring errors & fixes).
  Afterwards check `lsof -iTCP:3000 -sTCP:LISTEN` and `:3001`; restart with `./scripts/dev.sh --no-seed`.
- **No global agent-browser.** Use any install and the system Chrome (7/7 passed; `INSIGHTS.md` → Tool & library notes):
  `AGENT_BROWSER_BIN=<path>/agent-browser AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e:hermetic`.
  `run.ts` reads only the first (`run.ts:45`) and passes no `env` to `execFile`
  (`run.ts:49-56`), so agent-browser inherits the second.

## Debugging a failing step

1. Read the `✗` line and the block under it: the step's label (or joined args), the
   error's first line, then agent-browser's whole stderr and stdout (`run.ts:58-66,113-115`);
   a killed command reads "timed out after N ms" (`run.ts:62`).
2. Open `test-results/<flow>-fail.png`, the page at the moment of failure (`run.ts:116-118`).
3. Scroll up for API errors in the shared terminal (`../scripts/e2e.sh:159,175`), e.g.
   the GitHub fallback warnings (`../server/src/modules/pulls/service.ts:48,66`).
4. Replay by hand against a live stack (the hermetic one is gone on exit,
   `../scripts/e2e.sh:105`): `agent-browser --session <flow id> open http://localhost:3000/…`,
   then the failing `wait` or `find`. A dev DB with other repos breaks 02/04/05 (`README.md:49-55`).
5. Slow machine: raise `E2E_STEP_TIMEOUT` (`run.ts:46`); the web is `next dev`, not a build.
6. After a copy or route change, check the table in [`../specs/flows.md`](../specs/flows.md).
