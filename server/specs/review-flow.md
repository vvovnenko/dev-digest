# Review flow — contract

**Status:** contract — describes shipped behaviour that must stay true. Change the code and this file in the same commit.

Scope: one review cycle, from `POST /pulls/:id/review` through the background run, its
SSE stream, cancel and delete, to what every read route returns (the PR list included).
The route map and rate-limit tiers are in [`../README.md`](../README.md), and the wiring is in
[`../docs/architecture.md`](../docs/architecture.md). Cost and severity fields are specified in
[`./01-run-cost-badge.md`](./01-run-cost-badge.md) and
[`./02-findings-by-severity.md`](./02-findings-by-severity.md); their Amendments are current. What
happens inside the engine (grounding, score, verdict, blockers, cost) is in
[`../../reviewer-core/specs/grounding-and-scoring.md`](../../reviewer-core/specs/grounding-and-scoring.md).
Paths are relative to `server/`.

## Rules

### R1 — Start request
`POST /pulls/:id/review` takes a uuid `:id` and the body `{ agentId?: uuid, all?: boolean }` (it may be empty), validated by the route's schema (`RunRequest`). A wrong type or an `agentId` that isn't a uuid is a 422 `validation_error`. The route allows 10 requests/min, but the limiter is not registered under `NODE_ENV=test`. Code: `src/modules/reviews/routes.ts:37-57`, `src/vendor/shared/contracts/platform.ts:272-275`, `src/app.ts:169-181`, `:212-224`. Test: `test/reviews.it.test.ts:182-187` (200), `test/error-envelope.test.ts:82-88` (422 on a non-uuid `agentId`). The 429 is **untested**.

### R2 — Target agents
`all: true` picks every `enabled` agent in the workspace. Otherwise `agentId` picks that agent, or it is a 404 `not_found`. With neither, it is a 422 `validation_error` (`Provide agentId or all:true`). The agents are resolved before the PR is read. Code: `src/modules/reviews/service.ts:41-52`, `src/modules/agents/repository.ts:40-53`. Test: `test/reviews.it.test.ts:602-610` (`all`), `:182-189` (`agentId`), `test/error-envelope.test.ts:82-88` (neither). The 404 is **untested**.

### R3 — Workspace scope
The PR must be in the caller's workspace and its repo must exist. Otherwise it is a 404, and nothing is written. Code: `src/modules/reviews/service.ts:103-106`, `src/modules/reviews/repository/pull.repo.ts:9-19`. Test: **untested**.

### R4 — One `running` row per agent, before the response
For each target, in order, the server inserts an `agent_runs` row: `status='running'`, `source='local'`, and the agent's provider and model. Its id is the `run_id`. The rows are written in one transaction, all or none. `status` is text limited by the check `agent_runs_status_ck` to `running | done | failed | cancelled`. An agent can have only one `running` row per PR (the partial unique index `agent_runs_one_running_uq`): starting it again while its review runs is a 409 `run_in_progress` for the whole request, and no row is written. Code: `src/modules/reviews/service.ts:108-126`, `src/modules/reviews/repository/run.repo.ts:146-191`, `src/db/schema/runs.ts:28`, `:42-46`. Test: `test/reviews.it.test.ts:189` (one run per agent), `test/run-lifecycle.it.test.ts:274-291` (the 409). The `running` status at response time is **untested**.

### R5 — Response
`200 { pr_id, runs: [{ run_id, agent_id, agent_name }], reviews: [] }`. `reviews` is always empty; results are read later (R15–R18), as the contract comment says. Code: `src/modules/reviews/routes.ts:56`, `src/modules/reviews/service.ts:145`, `src/vendor/shared/contracts/review-api.ts:44-61`. Test: `test/reviews.it.test.ts:187-189`. `reviews: []` is **untested**.

### R6 — Fire-and-forget
Runs execute in the background, through the review queue: at most `REVIEW_CONCURRENCY` requests (default 2) run at once, and a request that has to wait says so in each of its runs' live logs ("Waiting for a free review slot …"). The runs are claimed on the bus before they wait, so a cancel or a shutdown reaches them too (R14, R23). The request never waits, and if the whole batch crashes, the error is only logged. The JobRunner is not used. Code: `src/modules/reviews/service.ts:130-143`, `src/platform/container.ts:78`, `src/platform/config.ts:49-51`. Test: `test/run-lifecycle.it.test.ts:217-245` (a second request waits for the first). Test: every DB test polls with `waitForPrRuns` (`test/helpers/runs.ts:12-34`).

### R7 — One diff per request
All agents share one diff, loaded once through the diff source (`PrDiffSource`, a git adapter the container wires as `prDiffs`): `git diff base...head` through the git client. If that throws or is empty, the diff is rebuilt from the stored `pr_files` patches. If loading still throws, every run of the request fails with `Failed to load PR diff: …`. A diff with no reviewable text fails the run in the engine (`The diff has no reviewable text — nothing was sent to the model`) instead of approving an unreviewed PR (`../reviewer-core/src/review/run.ts:246`). Code: `src/adapters/git/pr-diff.ts:12-44`, `src/platform/container.ts:152-157`, `src/modules/reviews/run-executor.ts:75-100`. Test: the git path via `MockGitClient` (`test/reviews.it.test.ts:125`). The empty diff: `test/run-lifecycle.it.test.ts:345-358`. The fallback and the fail-all are **untested**.

### R8 — Agents run in sequence, isolated
Runs execute one after another, in target order. A failed or cancelled run saves its own result, and the loop moves on to the next. Before its first `await` the executor claims every run of the request on the bus (`runBus.claim`), so a cancel or a shutdown also reaches the runs still waiting their turn (R14, R23). Code: `src/modules/reviews/run-executor.ts:61-63`, `:103-130`. Test: **untested**.

### R9 — Per-agent execution
Each run:
1. resolves the agent's provider client (the `llm` port, `container.llm` in the wiring). A missing key fails the run, not the request.
2. loads the agent's skills in a `Loading skills` step: its enabled links to enabled skills, in link order (`AgentLookup.enabledSkills`), and logs `skills: N attached (+T tokens)`, 0 included. A DB failure here fails the run ([`./03-skills.md`](./03-skills.md)).
3. adds repo-intel context only when `agent.repoIntel !== false`. If an enrichment fails, its section is left out.
4. calls reviewer-core `reviewPullRequest` with the agent's prompt, its model, `strategy ?? 'single-pass'`, the agent's `ciFailOn` as `failOn`, its skills when there is at least one, and the run's abort signal.

Code: `src/modules/reviews/run-executor.ts:158-233` (skills `:166-176`, `:219-220`), `src/modules/agents/repository.ts:222-244`, `src/modules/reviews/constants.ts:12`. Test: `test/reviews.it.test.ts:525-543` (anthropic), `:402-448` (only enabled links of enabled skills, in order, each traced; none → no section and `0 attached`). A missing key is **untested**.

### R10 — A `done` run
The executor writes, in ONE transaction (`completeRunWithReview`) that commits only while the row is still `running`:
1. `agent_runs` → `done`, with duration, tokens, `cost_usd` (the engine's `costUsd`, NULL if any call was unpriced), `findings_count`, `grounding` (`"k/n passed"`), `score`, `blockers = countBlockers(kept, agent.ciFailOn)` and `error = NULL`;
2. a `reviews` row: `kind='review'`, `run_id`, the verdict the engine derives from the kept findings under `failOn`, the engine's summary, the score the engine recomputes, and the agent's model;
3. the grounded findings only;
4. `pull_requests.last_reviewed_sha = head_sha`;
5. one `run_traces` document (an upsert);

and then the bus completes. When the row is no longer `running` (cancelled, reaped or deleted meanwhile), nothing is written and the run ends as cancelled (R12, R14).

Code: `src/modules/reviews/run-executor.ts:234-311`, `src/modules/reviews/repository/run.repo.ts:193-223`, `../reviewer-core/src/review/run.ts:264-269`. Test: `test/reviews.it.test.ts:193-220` (score 65 instead of the model's 42, 1 of 2 findings kept, `1/2 passed`, a trace), `:256-284` (cost), `:333-349` (an unpriced model stores NULL), `test/run-lifecycle.it.test.ts:314-329` (verdict, `last_reviewed_sha` and trace), `:293-312` (a cancelled row saves nothing). `blockers` is **untested**.

### R11 — `done` and the trace commit together
The trace is saved in the same transaction as `status='done'` (R10), so a client that sees `done` can read `GET /runs/:id/trace` at once. It used to be written after `done`, and an early read got a 404 ([`../INSIGHTS.md`](../INSIGHTS.md), Open questions). Code: `src/modules/reviews/repository/run.repo.ts:210-222`. Test: `test/run-lifecycle.it.test.ts:314-329`; `test/reviews.it.test.ts:211` and `:266` read the trace right after `waitForPrRuns`.

### R12 — A `failed` or `cancelled` run
The row gets `failed` with the error message, `cancelled` with `Cancelled by user`, or — when a shutdown stopped it — `failed` with `The API shut down while this run was in progress` (R23). It keeps the duration so far and what the calls cost: tokens and `cost_usd` from the error's usage (`usageOf`), or tokens 0 and `cost_usd` NULL when the error reports none. `findings_count` is 0, `grounding` `'0/0 passed'`, and `score` and `blockers` are NULL. The trace is built from the event buffer, carries the same usage in its stats, and — when the run got as far as loading its skills — the skills block and `skill_blocks` in its prompt assembly; it is written in the same transaction as the row (`finishRunUnsuccessfully`); a failure lands only on a `running` row, a cancel also on a `cancelled` one. No `reviews` row is written. An error while writing all of this goes to the run log and is otherwise swallowed. Code: `src/modules/reviews/run-executor.ts:312-340`, `:431-476`, `src/modules/reviews/repository/run.repo.ts:225-248`. Test: `test/reviews.it.test.ts:351-362`, `:301-310` (failed, cost NULL), `:450-459` (a failed run's trace keeps its skills), `test/run-lifecycle.it.test.ts:331-343` (failed: error text and billed usage), `:425-435` (the trace's usage), `:247-272` (cancelled: usage and trace).

### R13 — Live events (SSE)
`GET /runs/:id/events` sends frames with `id = seq`, `event = kind` and `data` = the `RunEvent` JSON. It has no rate limit. It first reads the run's status in the caller's workspace: a run that isn't there (unknown, or another workspace's) is a 404 `not_found`.
- A run this app's bus knows (queued, started, or completed less than 5 minutes ago): the buffered events first, then live ones; when the run completes the stream sends a last `event: done` (`data: {"runId": …}`, `SSE_DONE_EVENT`) and ends. While nothing happens it sends a `:keepalive` comment every 15 s (`SSE_HEARTBEAT_MS`). A client that disconnects releases its subscription at once; it gets no `done`.
- Any other run: the DB status decides. A row still `running` is subscribed to as above; any other status replays the stored `run_traces` log as events (`seq` from 1), then `done`, and the stream ends.

`done` is how a client tells a finished run from a cut connection: a stream that ends without it was dropped (network, restart), so the web client lets EventSource reconnect and drops replayed events it already has by run + `seq` (`../client/src/lib/hooks/reviews.ts:218-251`). The bus is one per app and drops a completed run's buffer 5 minutes after it completes, so the stored trace is the source after that and after a restart. Code: `src/modules/reviews/routes.ts:59-153` (`done` at `:85`, `:137`), `src/modules/reviews/constants.ts:14-26`, `src/platform/sse.ts:19-20`, `:109-115`, `:122-159`, `:194-204`, `src/vendor/shared/contracts/trace.ts:21-28`. Test: `test/reviews.it.test.ts:576-600`, `test/run-lifecycle.it.test.ts:359-382` (after a restart: replay ending in `done`, and the 404), `:384-407` (disconnect), `test/run-bus.test.ts:17-36` (eviction), `test/tenant-scoping.it.test.ts:57-88` (another workspace's run). The heartbeat, and `done` at the end of a live stream, are **untested** here (the client's handling of both is tested in `../client/src/lib/hooks/reviews.test.tsx`).

### R14 — Cancel
`POST /runs/:id/cancel`:
- publishes an info event and sets the bus's cancel flag, which also aborts a started run's in-flight LLM call through its `AbortSignal`;
- sets `status='cancelled'`, but only on a row still `running`;
- completes the bus (ending open streams) only when no executor is working on the run — a run still queued behind other agents, or an orphan after a restart; a started run's executor completes it once it has recorded the cancel;
- is a 404 `not_found` for a run that isn't in the caller's workspace, and returns `{ ok: true }` otherwise, whatever the run's status.

A cancel is final. The executor checks the flag before it starts a run and before it saves, and the engine before each LLM call; the final write lands only on a `running` row, so a late answer never overwrites `cancelled` and saves no review (R10). A run cancelled while queued is skipped without an LLM call: the flag outlives `complete()` until the buffer is evicted. Either way the executor then adds the duration, usage and trace to the `cancelled` row (R12).

Code: `src/modules/reviews/service.ts:83-89`, `src/modules/reviews/repository/run.repo.ts:105-115`, `:225-248`, `src/platform/sse.ts:46-82`, `:144-147`, `src/modules/reviews/run-executor.ts:148-157`, `:229-235`, `:317-318`, `../reviewer-core/src/review/run.ts:207-208`. Test: `test/run-lifecycle.it.test.ts:247-272` (aborts the call; a late answer changes nothing), `:293-312` (cancelled before the save), `test/run-bus.test.ts:7-15`, `:47-55` (cancelled while queued), `test/tenant-scoping.it.test.ts:57-88` (another workspace's run: 404, left `running`).

### R15 — Run reads
`GET /pulls/:id/runs` returns the PR's `agent_runs` rows in the workspace, of any status, newest `ran_at` first, with the agent name, `cost_usd`, `score` and `blockers` — one page: `?limit=` (default 500, at most 1000) and `?offset=`, a 422 outside those bounds. `GET /pulls/:id/runs/active` returns only the `running` rows, in no set order. For an unknown PR, both return `[]`, not a 404. The UI polls both every 4 s while a run is live, so neither counts against the global rate limit. Code: `src/modules/reviews/repository/run.repo.ts:17-79`, `src/modules/reviews/routes.ts:158-174`, `src/modules/_shared/schemas.ts:14-26`. Test: `test/reviews.it.test.ts:269-270`, `:319-323`, `:358-359`, paging `test/api-contracts.it.test.ts:75-85`. `/active` is **untested**.

### R16 — Review reads
`GET /pulls/:id/reviews` is a 404 unless the PR is in the workspace. Otherwise it returns the PR's reviews, of both kinds, newest `created_at` first, one page like the runs (default 500). Each review comes with all its findings, dismissed ones included, and with its run's `cost_usd`, `tokens_in` and `tokens_out` from a LEFT JOIN; these are null when the review has no run. The agent name comes from a LEFT JOIN too, and the findings are grouped in one pass. Code: `src/modules/reviews/service.ts:168-173`, `src/modules/reviews/routes.ts:199-206`, `src/modules/reviews/repository/review.repo.ts:61-97`. Test: `test/reviews.it.test.ts:194-207`, `:272-275`.

### R17 — Trace read
`GET /runs/:id/trace` returns the stored document, or a 404 `not_found` when there is none or the run isn't in the caller's workspace. Code: `src/modules/reviews/routes.ts:191-196`, `src/modules/reviews/repository/run.repo.ts:267-275`. Test: `test/reviews.it.test.ts:211-214`, `:266-267`, `test/tenant-scoping.it.test.ts:57-88` (another workspace's run).

### R18 — PR list
In `GET /repos/:id/pulls`, which only reads (the import is `POST /repos/:id/poll`) and returns one page, newest number first (`?limit=` up to 1000, the default, and `?offset=`):
- `score` and `findings_by_severity` come from the PR's latest `kind='review'` review. Summaries are ignored and dismissed findings count. A review with no findings gives all zeros, and a PR never reviewed gives `null`.
- `cost_usd` is the sum, in SQL over the `numeric` column, of `agent_runs.cost_usd` over the PR's `status='done'` runs. NULL costs are skipped, and the value is `null` when no done run has a known cost. It does not depend on reviews, so a run whose review was deleted still counts.

Code: `src/modules/pulls/repository.ts:104-165` (the roll-ups), `src/modules/pulls/service.ts:34-36`, `src/modules/pulls/domain.ts:115-141`, `src/vendor/shared/contracts/platform.ts:172-185`. Test: `test/reviews.it.test.ts:256-284`, `:286-331`, `:333-349`, `:462-523`.

### R19 — Finding actions
`POST /findings/:id/accept` sets `accepted_at` and clears `dismissed_at`, and `/dismiss` does the reverse. Both return `{ finding }`. A finding outside the workspace is a 404. The UI labels dismiss "Reject", but that is only copy (`../client/messages/en/prReview.json:7`). Code: `src/modules/reviews/findings.ts:11-34`, `src/modules/reviews/repository/review.repo.ts:142-166`. Test: `test/reviews.it.test.ts:545-574` (accept, then a dismiss that clears `accepted_at`). The reverse and the 404 are **untested**.

### R20 — Delete a run
`DELETE /runs/:id` deletes the workspace's reviews with that `run_id` (their findings cascade), then the `agent_runs` row (its trace cascades), in one transaction; the FK `reviews.run_id` also cascades from the run. When nothing matches, it returns `{ ok: false }` with a 200. Code: `src/modules/reviews/repository/run.repo.ts:88-103`, `src/modules/reviews/routes.ts:177-181`, `src/db/schema/runs.ts:52-54`, `src/db/schema/reviews.ts:23`. Test: **untested**.

### R21 — Delete a review
`DELETE /reviews/:id` deletes the review and its findings, but keeps the `agent_runs` row and its trace: the FK `reviews.run_id` cascades only from the run to the review. The run therefore still shows in the Timeline and still counts in the PR list's `cost_usd`. It is a 404 when the review is not in the workspace. Code: `src/modules/reviews/repository/review.repo.ts:106-116`, `src/modules/reviews/routes.ts:209-214`, `src/db/schema/reviews.ts:23`, `:42-44`. Test: **untested**.

### R22 — Boot reaper
Every `buildApp`, before it serves anything, sets `status='failed'` with the error `The API restarted while this run was in progress` on every `running` row in the DB, across all workspaces; it also fails every `queued` or `running` job. If that fails, boot only logs a warning. This assumes one API instance per DB. Code: `src/app.ts:106-124`, `src/modules/reviews/repository/run.repo.ts:117-126`, `src/platform/jobs.ts:227-234`. Test: **untested**.

### R23 — Shutdown
`app.close()` first runs a `preClose` hook. The bus aborts every started run's LLM call and ends every open event stream; queued runs stop before their first call. Each run is recorded `failed` with `The API shut down while this run was in progress`, not `Cancelled by user`, together with its usage and trace (R12). The hook waits up to `SHUTDOWN_GRACE_MS` (10 s) for those writes, and for the JobRunner, before the DB closes. `src/server.ts` exits with 1 when `close()` takes more than twice that. Code: `src/app.ts:41`, `:143-149`, `src/platform/sse.ts:61-65`, `:161-187`, `src/modules/reviews/run-executor.ts:18`, `:317-321`, `src/server.ts:26-31`. Test: `test/run-lifecycle.it.test.ts:408-424`, `test/run-bus.test.ts:38-46`, `:57-75`.

## Not covered by tests

- The 422 on `:id`, the 404 for an unknown agent or PR, and the
  10/min cap (the limiter is off under `NODE_ENV=test`, `src/app.ts:169-181`).
- The `pr_files` fallback and the fail-all on a diff error (R7), per-agent isolation (R8), and a missing provider key (R9).
- `blockers` (R10) and the SSE heartbeat (R13).
- `/pulls/:id/runs/active`, and the trace 404 for a run of this workspace that has no trace.
- `dismiss` → `accept` clearing `dismissed_at`, and the cross-workspace finding 404 (R19).
- Both deletes (R20, R21) and the reaper (R22).
- The "run all" test (`test/reviews.it.test.ts:602-611`) asserts only `runs.length ≥ 2` and does not wait for the
  runs. It also starts the seeded OpenRouter agents with no mock (see `../docs/architecture.md`).
- `waitForPrRuns` returns silently on timeout (`test/helpers/runs.ts:31`), so a stuck run fails a later assertion
  instead of reporting a timeout.

## When you change this

- Change the rule and the code in one commit; cite the new lines and the test that checks them.
- A response field is a contract change: edit `src/vendor/shared/contracts/` first, then the hand copy in
  `../client/src/vendor/shared/`.
- R10–R14 and R23 rest on two things: every final write of a run lands only on a row in the expected status
  (`running`, or `running`/`cancelled` for a cancel), and the bus keeps the cancel flag until the run stops.
  A new write path to `agent_runs` keeps both.
- Score, grounding, verdict and cost come from reviewer-core. Change its contract first.
- A new DB-backed test goes in a `*.it.test.ts` file and awaits `waitForPrRuns` before it asserts.
