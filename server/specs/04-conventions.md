# Conventions Extractor

**Status:** in progress

## Problem

A reviewer agent knows generic rules, not the house rules of the repo it reviews.
Those rules already live in the code, scattered across config files and the most
central source files. Nobody has written them down, so nothing enforces them.

Goal (lesson L02, HW2): Skills Lab → **Conventions** scans one repo and proposes
its house conventions. Each one is backed by a `file:line` that code has checked
against the real file. The user accepts, rejects or edits each candidate in
place, then turns the accepted ones into **one skill**: a draft they can edit,
saved with `source: extracted`. Linking that skill to an agent uses the existing
Skills Lab mechanism (`POST /agents/:id/skills`, the agent's Skills tab); this
feature doesn't link it on its own.

The model only proposes. Code samples the files without any model call, and
code verifies the evidence. A candidate whose citation doesn't match the file is
dropped before anyone sees it.

## Scope

- **Server, new module** `src/modules/conventions/` (onion layout):
  - `domain.ts`: the LLM schema `ConventionExtraction`; `configCandidatePaths`,
    `normalizeEvidencePath`, `verifyCandidates`, `finalizeCandidates`; `ruleSlug`,
    `skillNameFor`, `buildSkillDraft`.
  - `prompt.ts`: the system prompt and line-numbered, `<untrusted>`-wrapped files.
  - `ports.ts`, `service.ts`, `repository.ts`, `routes.ts`, `helpers.ts`
    (row → DTO), `constants.ts` (caps, timeout, rate limit).
  - Registered in `src/modules/index.ts:35`.
- **Server, changed:**
  - `src/platform/container.ts:168-175`: the `conventionsRepo` getter, and
    `featureModel(ws, id)` → `resolveFeatureModel(settingsRepo, …)`. That gives
    `settings/feature-models.ts` its first production caller, so its
    `no-unreachable-from-entry` exemption in `.dependency-cruiser.cjs` is gone.
  - `src/modules/skills/ports.ts:9`: `NewSkill.evidenceFiles?`.
- **Tables:** migration `src/db/migrations/0016_conventions.sql`, generated, no DROP.
  - `conventions` gains:
    - `category`, `evidence_start_line`, `evidence_end_line`;
    - `status` (`pending | accepted | rejected`, CHECK);
    - `fingerprint`, `created_at`, `updated_at`;
    - a CHECK on `confidence` 0..1;
    - index `(workspace_id, repo_id)` and unique `(repo_id, fingerprint)`.
  - New `convention_scans` (`src/db/schema/knowledge.ts:101-137`); `conventions` is `:65-94`.
  - Migration `0017_conventions_scan_status.sql`: a scan row carries its lifecycle —
    `status` (`queued | running | done | failed`, default `done` for older rows, CHECK),
    `error`, `job_id`, `started_at`, `finished_at` — and the partial unique index
    `convention_scans_repo_active_uq ON (repo_id) WHERE status IN ('queued','running')`
    allows one active scan per repo.
  - The legacy `accepted` column stays and is written in sync with `status`,
    because the plugin export contract reads it (`PluginConvention`).
- **Contracts** (`src/vendor/shared/contracts/knowledge.ts`, mirrored byte-for-byte
  in `../../client/src/vendor/shared/`):
  - new: `ConventionCategory`, `ConventionStatus`, `ConventionScan`,
    `ConventionsState`, `ConventionUpdate`, `ConventionSkillDraft`,
    `ConventionSkillCreate`;
  - `ConventionCandidate` gains category, line range and status;
  - `platform.ts`: the `conventions` feature-model default is now `openrouter` /
    `deepseek/deepseek-v4-flash`.
- **Client:** see [`client/specs/04-conventions.md`](../../client/specs/04-conventions.md).

**Unchanged (no diff at all):**
- `server/src/modules/repo-intel/service.ts`, `server/src/modules/repo-intel/routes.ts`,
  `server/src/modules/reviews/**`, `server/src/modules/agents/**`,
  `server/src/modules/pulls/**`, `server/src/modules/polling/**`,
  `server/src/modules/repos/**`, `server/src/modules/workspace/**`;
- `server/src/modules/skills/service.ts`, `server/src/modules/skills/repository.ts`,
  `server/src/modules/skills/routes.ts`, `server/src/modules/skills/domain.ts`;
- `server/src/adapters/**` (the fake LLM included), `server/src/app.ts`;
- `reviewer-core/src/**`, `e2e/**`.

**Out of scope:**
- linking the skill to an agent automatically, or a new built-in agent — the user
  links it on the agent's Skills tab;
- several skills per scan;
- category labels in the UI;
- an e2e flow: `FakeReviewLlm` answers only the Review schema, and the seeded repo
  has no clone.

## API / Data

**Routes** — `src/modules/conventions/routes.ts`

| Method | Path | Body → reply | Errors |
| ------ | ---- | ------------ | ------ |
| GET | `/repos/:id/conventions` (`:56`) | → `ConventionsState { scan, latest_scan, candidates }`: `scan` = the latest **done** scan, `latest_scan` = the newest of any status (poll while it is `queued`/`running`), every non-rejected candidate, most confident first. No rate limit (the UI polls it every 2 s) | 404 |
| POST | `/repos/:id/conventions/extract` (`:67`) | → **202** `ConventionsState` at once: queues a scan and its job, or — when the repo already has a `queued`/`running` scan — returns the state unchanged (no new scan, no error); rate limit 5/min | 404 · 409 `not_cloned` \| `not_indexed` · 503 `shutting_down` |
| PUT | `/conventions/:id` (`:81`) | `ConventionUpdate { status?, rule? }` → `ConventionCandidate` | 404 · 422 |
| POST | `/repos/:id/conventions/deselect-all` (`:90`) | → `{ updated }`, accepted → pending | 404 |
| GET | `/repos/:id/conventions/skill-draft` (`:99`) | → `ConventionSkillDraft { name, description, type: convention, body, accepted_count, name_taken }`; writes nothing | 404 · 422 `no_accepted_conventions` |
| POST | `/repos/:id/conventions/skill` (`:108`) | `ConventionSkillCreate` (name, description?, type?, body, enabled?) → **201** `Skill` at v1, `source: extracted` | 404 · 409 (`details.field = 'name'`) · 422 |

Every repository query is scoped by `workspace_id`. Another workspace's repo or
candidate is a 404.

**Scan** — a background job (`src/modules/conventions/service.ts`):

0. **Start** (`startScan`, `service.ts:70`; the POST), fast, with no model call:
   - The repo must be in the workspace (else 404), cloned (else 409 `not_cloned`;
     the seeded demo repo has no clone) and indexed (else 409 `not_indexed`).
   - A repo with a `queued`/`running` scan gets the state back unchanged. Otherwise
     the Settings model is resolved, a `queued` row is inserted with its
     provider/model, and a `conventions-scan` job is enqueued with
     `{ scanId, repoId, workspaceId }`. A concurrent insert that loses to the partial
     unique index also just returns the state. If enqueueing fails (503
     `shutting_down`), the row is marked `failed`.
   - The payload's `repoId` makes the JobRunner run the scan after, never during,
     the same repo's clone / index / refresh / resync jobs; a resync waits for a
     running scan.
1. **Run** (`runScan`, `service.ts:115`; the job handler): marks the row `running`
   (a row that is gone or no longer active is left alone), then steps 2–7. It
   **never throws** once the row is running: every failure — a model error, a
   timeout, a missing key, an index that vanished — is written to the row as
   `failed` + `error`, with the tokens and cost the call billed. A thrown 5xx
   would be retried twice by the JobRunner, paying for the model call three
   times. Only a malformed payload throws (422, not retried).
2. **Sample, by code only.**
   - Top files: `repoIntel.getConventionSamples(repoId, 12)`. None → `not_indexed`
     (a 409 from the POST; inside the job, a failed scan); the same when repo-intel
     is disabled.
   - Configs: that facade filters config files out, so they are looked up
     separately — `tsconfig*.json`, `.eslintrc*`, `eslint.config.*`, `.prettierrc*`,
     `prettier.config.*`, `.editorconfig`.
     - Searched at the root and in every ancestor directory of the top files
       (`configCandidatePaths`, `domain.ts:194`).
     - At most 6; a missing or empty file is skipped.
   - Files are read with `GitClient.readFile`, which stays inside the clone.
3. **Prompt** (`prompt.ts:74`).
   - Each file is line-numbered (`  23| …`) inside `wrapUntrusted`.
   - Caps: 250 lines and 12,000 chars per file, ~90,000 chars in total.
   - Already accepted or rejected rules (at most 30) are listed as "don't repeat".
4. **Model.**
   - `completeStructured` with `schemaName: 'ConventionExtraction'` (`domain.ts:143`):
     `{ candidates: [{ category, rule, evidence: { file, line, end_line | null, snippet }, confidence }] }`.
   - Options: `maxTokens` 12000, `maxRetries` 1, a 110 s abort.
     The default model reasons before it answers, and that hidden reasoning counts
     against `maxTokens`: scans measured 4.8K–8.9K completion tokens (~2.5K of them
     the JSON for 15 candidates), so 6000 cut scans off (`finish_reason: length`).
     It ignores OpenRouter's `reasoning.effort`, so the only lever is the cap
     (`src/modules/conventions/constants.ts:30-37`). The abort stays under the
     JobRunner's 120 s job timeout, which would otherwise stop waiting while the
     call keeps running (`constants.ts:40-45`).
   - The model is `container.featureModel(ws, 'conventions')`: the Settings →
     Models pick, else the registry default.
   - Errors (a provider failure, the timeout, a missing key) fail the scan with
     their message; the UI shows it under the subtitle.
5. **Verify evidence** (`verifyCandidates`, `domain.ts:306`). For each candidate:
   - The path must normalise (no absolute path, no `..`): else `bad_path`.
   - The file must exist and be non-empty: else `file_missing`.
   - The cited line must exist: else `line_out_of_range`.
   - The snippet must match, else `snippet_not_found`:
     - whitespace-normalised, with a copied `NN|` gutter stripped;
     - first at the cited line ±3, then anywhere in the file (the candidate moves
       there);
     - a single line of fewer than 8 characters never matches.
   - The stored snippet is the file's real lines, at most 15.
   - A failure drops the candidate, with its reason, into the scan's `dropped`.
6. **Finalize** (`finalizeCandidates`, `domain.ts:384`).
   - Confidence is clamped to 0..1, and candidates below 0.5 go.
   - Rules are kept one per fingerprint (the normalised rule as the model wrote it).
   - A fingerprint the user already decided is skipped.
   - At most 20, most confident first.
7. **Persist** (`completeScan`, `src/modules/conventions/repository.ts:119`), one
   transaction that applies only while the row is still `running`:
   - the repo's `pending` candidates are deleted;
   - the new ones are inserted with `ON CONFLICT (repo_id, fingerprint) DO NOTHING`;
   - the scan row becomes `done` with the sample files, tokens, cost, found/kept
     counts and `dropped`.

**Interrupted scans.** Jobs live in the process's memory. When the conventions
plugin registers (boot), every `queued`/`running` scan is marked `failed` with
"The API restarted while this scan was running" (`reapInterrupted`, `service.ts:131`),
like the JobRunner's own boot reaper; a reaper failure is logged, not fatal. A
shutdown mid-scan leaves the row active until the next boot.

   So a **Re-scan keeps accepted and rejected candidates**, and a rejected rule
   never comes back, even after an inline edit (the fingerprint doesn't change).

**Skill draft** (`buildSkillDraft`). These are the defaults the modal shows; the
user can edit every field:
- `name`: `<repo-name>-conventions`, slugified to the `SkillName` rule, ≤ 64 chars.
- `description`: "N house conventions extracted from <repo>".
- `type`: `convention`.
- `body`:
  ```
  # <name>

  House conventions for `<repo>`. Flag changes that violate any rule below and cite the offending `file:line`.

  ## <rule-slug>
  <rule>

  Detected in `<path>:<start>-<end>`:
  ```<lang>
  <snippet>
  ```
  ```
  Snippets shrink until the body fits 40,000 chars. A line starting `+++ b/` is
  defused (the fake LLM anchors on it).

`POST …/skill` inserts the edited fields through the skills repository:
- version 1, `source: extracted`;
- `evidence_files` = the accepted candidates' paths;
- v1 note "Created from N conventions in <repo>".

Only accepted candidates feed the draft and the evidence. Rejected ones never do.

## Acceptance criteria

These are `hw2-criteria.md` rows 38–41 and 44–53. Row 42 (the skill linked to an
agent) is done by hand in the UI.

1. `POST /repos/:id/conventions/extract` answers 202 at once and queues a job that
   runs the scan; its candidates and scan row survive a new app instance
   (`test/conventions.it.test.ts:181`). A second POST while a scan is active returns
   that scan and creates no second row (`:384`); the partial unique index holds one
   active scan per repo (`:441`); a restart fails the scans it interrupted (`:454`);
   a failed model call fails the scan with its billed usage and calls the model
   once (`:420`).
2. Sampling is code only: configs + top-12 via `getConventionSamples`
   (`test/conventions-domain.test.ts`, `test/conventions-service.test.ts`).
3. The model answers `{category, rule, evidence: {file, line, end_line, snippet},
   confidence}`. A hallucinated file, a wrong line or a snippet that isn't in the
   file is dropped (`test/conventions-domain.test.ts`, `test/conventions-service.test.ts`).
4. Reject is stored: the candidate is gone after a reload and after a re-scan, and
   it never reaches the draft (`test/conventions.it.test.ts:232`).
5. The draft merges only accepted candidates. Create returns 201, the skill shows in
   `GET /skills` with `source: extracted`, a taken name is a 409, and nothing
   accepted is a 422 (`test/conventions.it.test.ts:268`).
6. The scan uses the model chosen in Settings → Models → Conventions
   (`test/conventions.it.test.ts:353`). The default is `deepseek/deepseek-v4-flash`
   on OpenRouter (`test/settings-models.it.test.ts`).
7. Tenant isolation: another workspace's repo or candidate is a 404
   (`test/conventions.it.test.ts:314`).
8. Live: in a real cloned and indexed repo, Run scan → accept / reject / edit →
   reload → Create skill → the skill on `/skills` → link it on the agent's Skills
   tab. Needs `OPENROUTER_API_KEY`, about one cheap call per scan.

## Open questions

- ~~A scan is synchronous~~ — answered 2026-10-04: a scan is a background job with
  a status the UI polls (see **Scan** above). A running scan can't be cancelled yet.
- A scan that needs more than ~90 s hits the OpenRouter client's per-attempt
  timeout (`reviewer-core/src/llm/openrouter.ts:57`); one live scan took 84 s with
  8.9K completion tokens. It then fails at the 110 s abort. Lower the candidate
  count, or let a request set its own per-attempt timeout?
- Accepted candidates from an old scan keep their old snippet when the file has
  changed since. Should a re-scan re-verify accepted evidence?
