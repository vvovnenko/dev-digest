# DevDigest — insights (cross-package)

Things that are true about this repo but not visible in the code. Append-only:
when an entry goes stale, add a dated note under it instead of deleting it.
Package-scoped findings live in [`client`](client/INSIGHTS.md) ·
[`server`](server/INSIGHTS.md) · [`reviewer-core`](reviewer-core/INSIGHTS.md) ·
[`e2e`](e2e/INSIGHTS.md).
repo-intel findings live in [`server/src/modules/repo-intel`](server/src/modules/repo-intel/INSIGHTS.md).
Agents write here only through the `engineering-insights` skill, whose script
inserts lines and never changes existing ones.

Entry format: `- **YYYY-MM-DD** — claim. Evidence: \`path:line\``

## What works

- **2026-10-05** — To audit a doc's `file:line` citations long after they were written, compare each cited range at the commit that last wrote the citing line (`git blame --line-porcelain` → `git cat-file blob <commit>:<path>`) with the same range at HEAD: equal means still right, unequal gives the old text to search for. It needs no diff hunks and catches drift from any later commit. On the onion-architecture references it found 9 stale citations among 45, plus a renamed function (`skillsChanged` → `linksChanged`). Bare `:N` cites still need their file resolved by hand. Evidence: `.claude/skills/onion-architecture/references/persistence-and-transactions.md:111`

## What doesn't work

- **2026-09-28** — Remapping `file:line` citations in docs by script after a code change mis-attributes bare `:N` shorthand: it means whatever file the writer had in mind, not the last one cited — `server/docs/architecture.md` cites `mocks.ts` lines right after a `reviews.it.test.ts` cite, and a sub-bullet inherits its parent's file — so an automated pass shifted correct `mocks.ts` numbers → remap only full-path citations automatically (from `git diff -U0` hunks) and check every bare `:N` near a changed file by hand; a final pass that every cited line exists catches only out-of-range ones. Evidence: `server/docs/architecture.md:79`
- **2026-10-03** — Remapping `file:line` citations only near the lines you edited misses shifts from edits elsewhere in the file: a 2-line header comment added to `reviewer-core/src/prompt.ts` moved `wrapUntrusted` from `:31` to `:33`, and a region-only remap of `pipeline.md` kept the old number. `citations.mjs` can't help before a self-review (it needs `--run <id>`) → map every citation of a changed file through its `git diff -U0` hunks. Evidence: `.claude/skills/pr-self-review/scripts/citations.mjs:4`, `reviewer-core/docs/pipeline.md:94`
  - **2026-10-04** — A citation that names only a basename is ambiguous to a remap script: in the Conventions change `knowledge.ts` was both `vendor/shared` contract copies and the DB schema, and `helpers.ts` / `constants.ts` matched files of other routes, so a basename match proposed wrong remaps (e.g. the contract lines above the edit in `server/specs/03-skills.md`, which hadn't moved) → resolve a bare-basename citation from its section's context, and before writing compare the old line (`git cat-file blob HEAD:<file>`) with the new one. Evidence: `server/specs/03-skills.md:98`
  - **2026-10-04** — With parallel agents, a remap that maps citations through `git diff -U0 HEAD` cannot tell a citation already hand-updated to the new code from a stale one, so re-running it over a doc remapped earlier in the session shifts those citations twice (it proposed `SkillsTab.tsx:218-232` → `:222-242`) → remap each doc once, after every agent has finished, or exclude the citations you already set. Evidence: `client/specs/pages.md:124`

## Codebase patterns

- **2026-09-23** — Severity has 3 levels in the contract (`CRITICAL`, `WARNING`,
  `SUGGESTION`), but 4 in the client UI kit (`SEV`, `Severity`) and in
  `FindingsPanel`'s sort order, which add `INFO` → iterate the contract's three
  levels when rendering per-severity counts; a finding is never `INFO`. Evidence:
  `server/src/vendor/shared/contracts/findings.ts:11`,
  `client/src/vendor/ui/primitives/tokens.ts:3`.
- **2026-09-23** — Every CLAUDE.md must stay under 100 lines (the user's rule; the repo doesn't state it, and `5a759d1` shortened the root from 102 to 94 for it). After HW1 block D the root is at 99 → put new rules in a package `CLAUDE.md` (all are under 85) or a linked doc; merging or shortening existing root lines needs the user's OK, and the structure (headings, block types) must stay. Evidence: `CLAUDE.md:62-66` (Naming conventions, the last 5 lines added).
  - **2026-09-23** — superseded: "all are under 85" no longer holds — `server/CLAUDE.md` grew to 86 lines in `faa6678` (packages are now 61–86, root still 99). Evidence: `server/CLAUDE.md:86`.
  - **2026-09-28** — After `f3f0358` (onion-architecture pointers) `server/CLAUDE.md` is 92 lines and `reviewer-core/CLAUDE.md` 65; root still 99 → server has 7 lines of headroom left, so the next server rule should go in a linked doc or a skill. Evidence: `server/CLAUDE.md:92`, `reviewer-core/CLAUDE.md:65`.
- **2026-10-03** — A skill's prompt block (`### <name>` / `When to apply: <description>` / body) is rendered twice: `renderSkill` in the engine and `renderSkillBlock` in the client's Preview tab and token counter (the client can't import reviewer-core at runtime) → change both together; the same golden string is pinned on each side. Evidence: `reviewer-core/src/prompt.ts:82`, `client/src/app/(shell)/skills/helpers.ts:15`, `client/src/app/(shell)/skills/helpers.test.ts:5`
  - **2026-10-04** — The client copy moved: `renderSkillBlock` and `estimateTokens` now live in `client/src/lib/skills.ts` (a second route, the Conventions create-skill modal, counts tokens too) and the golden test in `client/src/lib/skills.test.ts`; `skills/helpers.ts` keeps only `withoutImages`. Evidence: `client/src/lib/skills.ts:26`, `client/src/lib/skills.test.ts:4`
- **2026-10-05** — pr-self-review's version lives in two places: `metadata.version` in its `SKILL.md` and `TOOL_VERSION` in `scripts/lib.mjs`, which is stamped into runs and verdicts and is part of every reviewer cache key → bump both together, and expect a bump (even for a docs-only change) to drop every cached finding, so the next review re-runs all tasks. Evidence: `.claude/skills/pr-self-review/scripts/lib.mjs:24`, `.claude/skills/pr-self-review/scripts/select-skills.mjs:98`

## Tool & library notes

- **2026-09-23** — `append-insight.mjs` checks only the `**YYYY-MM-DD** —` prefix and never the evidence, so entries without a `path:line` go in unnoticed (4 so far: two in root Open questions, two in `client/INSIGHTS.md`) → before appending, make sure the Evidence has a `path:line`, not a command or a bare file. Evidence: `.claude/skills/engineering-insights/scripts/append-insight.mjs:22`, `client/INSIGHTS.md:18,46`.
  - **2026-09-23** — superseded: the script now refuses any entry outside Session notes without a backticked `file.ext:line` (a bare file, a command, `localhost:3101` or an IP:port don't count), and the four entries it had let through got line-evidence sub-bullets. Evidence: `.claude/skills/engineering-insights/scripts/append-insight.mjs:76-82`.
- **2026-09-23** — The machine's pnpm is 12.5.1 (`CLAUDE.md` only asks for ≥10), and it rejects the short `-s` flag with `error: unexpected argument '-s' found`: `pnpm -s typecheck` runs nothing → use `pnpm --silent <script>` or plain `pnpm <script>` in `server/` and `client/`. `npm run -s` in `reviewer-core/` and `e2e/` is fine. Evidence: `CLAUDE.md:22`.
  - **2026-09-23** — Narrower than it reads: only the shorthand `pnpm -s <script>` fails; `pnpm -s run <script>` works (`pnpm -s run typecheck` in `server/` exits 0), and no file in the repo uses `pnpm -s`. Evidence: `INSIGHTS.md:32`, `server/package.json:6`.
- **2026-09-23** — A `path:line` that points *into* an `INSIGHTS.md` goes stale on the next append: the script splices lines in mid-file, so every later entry shifts. The `append-insight.mjs` entry's `client/INSIGHTS.md:46` is now a blank line, and a citation of root `:32` written in this session was one line off a minute later → cite the code (or quote the entry's text), never an INSIGHTS line. Evidence: `.claude/skills/engineering-insights/scripts/append-insight.mjs:149`, `client/INSIGHTS.md:46`.
- **2026-09-27** — A skill's `evals/evals.json` inside the repo leaks the expected answers to eval subagents: in the frontend-ui-architecture round 3, 3 of 10 runs (a told-not-to-read baseline included) printed it through a repo-root `grep -rn` that didn't exclude `.claude/` → tell every eval executor to search with `grep --exclude-dir=.claude` / `rg -g '!.claude'`, or keep eval sets outside the repo, and discard tainted runs. Evidence: `.claude/skills/frontend-ui-architecture/README.md:222`
  - **2026-09-27** — Line evidence moved and the fix landed: the warning is now `.claude/skills/frontend-ui-architecture/README.md:224`, and the executor prompt template that excludes `.claude/` from every search is at `.claude/skills/frontend-ui-architecture/README.md:238` — start eval executor prompts from it.
- **2026-09-28** — Adding a dependency on this machine: `pnpm add` with the local pnpm 12.5.1 leaves an untracked `pnpm-workspace.yaml` stub (`allowBuilds: <pkg>: set this to true or false`) in the package dir and exits 1 with `ERR_PNPM_IGNORED_BUILDS`, and `npx pnpm@10 add` refuses the pnpm-12 `node_modules` → add with pnpm 12, delete the stub, then prove CI's pnpm 10 takes the lockfile with `npx -y pnpm@10 install --frozen-lockfile --lockfile-only`. Evidence: `client/pnpm-workspace.yaml:1-3` (the same stub, committed earlier), `.github/workflows/server-unit.yml:50`.
  - **2026-10-01** — `pnpm <script>` can install too: pnpm 12 checks dependencies before every `pnpm run`/`pnpm <script>` and, when it judges node_modules stale, installs — failing with the same `ERR_PNPM_IGNORED_BUILDS`, leaving the `pnpm-workspace.yaml` stub (server/ got one) and rewriting `node_modules/.pnpm-workspace-state-v1.json`. A clone with node_modules symlinked to this checkout triggered it and made the original look stale too (the next run in the original healed it); `npm_config_verify_deps_before_run=false` did not prevent it → tooling that must not change the tree runs the script's command with `node_modules/.bin` on PATH, and never symlinks node_modules into a clone. Evidence: `.claude/skills/pr-self-review/scripts/checks.mjs:364`
- **2026-10-01** — A grown onion baseline that is already committed passes every documented check: `pnpm arch` uses `--ignore-known`, `pnpm arch:stale` only proves the file equals the current violations, and `baseline-diff.mjs` compares with `HEAD` unless given a ref (the skill tells you to run it without one), while no CI job runs it → to check a branch, run `node .claude/skills/onion-architecture/scripts/baseline-diff.mjs $(git merge-base origin/main HEAD)`; making CI run it against the PR base would close the gap. Evidence: `.claude/skills/onion-architecture/scripts/baseline-diff.mjs:21`, `.claude/skills/onion-architecture/SKILL.md:205`, `server/package.json:19-21`
- **2026-10-01** — `git show <tree>:<path>` for a path that doesn't exist there but contains glob characters (Next.js `[number]/x.ts`, `(shell)`) doesn't fail: git falls back to treating the argument as a pathspec and prints the HEAD commit, exit 0 — a citation checker read it as a 14-line file → read blobs with `git cat-file blob <tree>:<path>` (or `--batch`), which fails cleanly. Evidence: `.claude/skills/pr-self-review/scripts/lib.mjs:141`
- **2026-10-01** — A subagent type added in `.claude/agents/` during a running Claude Code session is not usable at once: the Agent tool answered "Agent type 'pr-self-review-reviewer' not found" while a skill added in the same session was already listed; the agents appeared about half an hour later → fall back to `general-purpose` with "read `.claude/agents/<name>.md` and follow it" (the pr-self-review skill says so). Evidence: `.claude/skills/pr-self-review/SKILL.md:71`
- **2026-10-03** — pr-self-review's D8 reads every backticked token in a spec's **Unchanged** zone as an item, and a token with no `/` or `.` matches any path segment of that name — `ConfigTab` there would also freeze `skills/[id]/…/ConfigTab/**` → list full paths in an Unchanged zone. Evidence: `.claude/skills/pr-self-review/scripts/specs.mjs:94-97`
- **2026-10-04** — `deepseek/deepseek-v4-flash` on OpenRouter (served by AtlasCloud) reasons before it answers, and its hidden reasoning counts against `max_tokens`: the same conventions prompt cost 4.8K–6.8K completion tokens, of which 2.2K–4.7K were `reasoning_tokens`, for ~2.5K tokens of JSON. Past the cap it ends `finish_reason: length` (the provider throws "output was cut off at the token limit"), still billed. `reasoning: { effort: "low" | "none" }` did not reduce it (4649 / 4716 reasoning tokens) → size `maxTokens` for reasoning + output (conventions: 12000), and measure `usage.completion_tokens_details.reasoning_tokens` before trusting an effort knob. Evidence: `server/src/modules/conventions/constants.ts:30-36`, `reviewer-core/src/llm/openrouter.ts:130-137`
  - **2026-10-04** — Wider than measured: a later live scan took 84 s and 8920 completion tokens (13 of 15 kept), close to the OpenRouter client's 90 s per-attempt timeout; the cap comment moved to `server/src/modules/conventions/constants.ts:30-37`. Evidence: `server/src/modules/conventions/constants.ts:30-37`, `reviewer-core/src/llm/openrouter.ts:57`
- **2026-10-05** — Running pr-self-review on a long-lived branch against its default base goes far over budget: `module/L02` vs `origin/main` is 703 files and ~180 reviewer tasks, while `max_tasks` is 24, so the plan comes out INCOMPLETE. `select-skills.mjs` diffs the base against the working tree, uncommitted edits included, so `--base HEAD` plus a small uncommitted change in `client/src` and `server/src` gives a mixed diff that routes to both the ui and backend skill groups → check the size first with `node .claude/skills/pr-self-review/scripts/select-skills.mjs --base <ref> --summary` (it only prints). Evidence: `.claude/skills/pr-self-review/routing.json:7`
- **2026-10-05** — A DevDigest skill file ships as a Claude Code plugin skill unchanged: `claude plugin validate --strict` (CLI 2.1.289) passes a SKILL.md whose frontmatter has DevDigest's `type:` key, and the runtime ignores unknown keys. The same raw file then feeds both `/plugin install` and Skills → Import from URL → keep `name`/`description`/`type` frontmatter in plugin skills; no second copy is needed. Evidence: `plugins/devdigest-review-skills/skills/error-handling-review/SKILL.md:4`, `server/src/modules/skills/domain.ts:150`

## Recurring errors & fixes

- **2026-09-23** — Following the root README's manual steps crashes the API:
  they never install `reviewer-core` deps, but the API imports its raw source and
  resolves `openai`/`zod` from `reviewer-core/node_modules`. `dev.sh` does it;
  by hand run `cd reviewer-core && npm ci`. Evidence: `scripts/dev.sh:78-80`,
  `README.md:118-127`.
- **2026-09-23** — Running `e2e:hermetic` while the dev web is up breaks the dev
  web: `e2e.sh` runs its own `next dev` in `client/`, which shares `client/.next`,
  and bakes in `NEXT_PUBLIC_API_BASE=http://localhost:3101`. Afterwards `:3000`
  shows "Cannot reach the DevDigest engine at http://localhost:3101" → restart the
  dev web after a hermetic run (touching a route's file only rebuilds that route).
  A separate `distDir` for the e2e web would fix it for good. Evidence:
  `scripts/e2e.sh:42,148`, `e2e/README.md:43-44`.
  - **2026-09-23** — It can also take the whole dev stack down: during a hermetic run (7/7 passed) the dev web on :3000 exited, and because `dev.sh` runs the client in the foreground, its EXIT trap then killed the API on :3001 (Postgres stayed up). The exact reason the dev web exited was not traced → after a hermetic run, check `lsof -iTCP:3000 -sTCP:LISTEN` and `:3001`, and restart with `./scripts/dev.sh --no-seed`. Evidence: `scripts/dev.sh:98-110`, `scripts/e2e.sh:148`.
  - **2026-09-23** — A third form: the dev web stays up but every route returns HTTP 404 and the page shows "missing required error components, refreshing..." (the hermetic `next dev` rewrote the shared `client/.next`); reloading doesn't help, only a restart. Check `lsof -iTCP:3000 -sTCP:LISTEN` *before* a hermetic run, not only after — the dev stack may have been restarted since you last looked. Evidence: `scripts/e2e.sh:148`, `scripts/dev.sh:108-110`.
  - **2026-09-28** — Fixed: the hermetic web builds into `client/.next-e2e`, and the script restores the `tsconfig.json` / `next-env.d.ts` that `next dev` rewrites; after six hermetic runs today the dev web on :3000 still answered 200. Evidence: `scripts/e2e.sh:44-46`, `client/next.config.mjs:9`.

## Doc drift

- **2026-09-23** — The docs disagree on resetting the DB: the root README
  recommends `docker compose down -v`, `e2e/README.md` forbids it because it
  wipes every imported repo and review. Evidence: `README.md:160`,
  `e2e/README.md:46`.
  - **2026-09-29** — Fixed in place: the root README's "Reset everything" now says `down -v` deletes every imported repo, review and agent edit, and points to `./scripts/e2e.sh` for a throwaway DB. Evidence: `README.md:162-165`.
- **2026-09-23** — README says "two built-in reviewers (General + Security)" and
  lists only OpenAI/Anthropic keys; the seed creates three agents (+ Performance),
  all on `openrouter` / `deepseek/deepseek-v4-flash`. Evidence: `README.md:73,113`,
  `server/src/db/seed.ts:12-13,22`.
  - **2026-09-29** — Fixed in place: the README lists three reviewers on OpenRouter and the OpenRouter key first. Evidence: `README.md:69,73`.
- **2026-09-23** — `.claude/skills/README.md` says skills reach Cursor through a
  `.cursor/skills → ../.claude/skills` symlink, but the repo has no `.cursor/`,
  so Cursor sees none of them → create the symlink if Cursor needs the skills.
  Evidence: `.claude/skills/README.md:3`, `ls .cursor` (missing).
  - **2026-09-29** — Doc fixed, no symlink created: `.claude/skills/README.md` now says the repo has no `.cursor/` and gives the `ln -s` command. Evidence: `.claude/skills/README.md:3`.
- **2026-09-23** — Three prices for `deepseek/deepseek-v4-flash` disagree: the
  model guide says 0.09/0.18 $/M, the server's fallback table 0.14/0.28, and a
  real OpenRouter run billed $0.000173 for 1,642→62 tokens (guide ⇒ $0.000159,
  table ⇒ $0.000247) → for real spend use `agent_runs.cost_usd`, not either
  table. Evidence: `docs/agent-prompts/choosing-a-model.md:33`,
  `server/src/adapters/llm/pricing.ts:31`.
  - **2026-09-29** — Documented, not reconciled (no source matches the billed cost): the model guide now names the fallback table's 0.14 / 0.28, says a cached live price wins, and points to the run's recorded cost. Evidence: `docs/agent-prompts/choosing-a-model.md:30-33`.
- **2026-09-27** — `server-unit.yml` says `server/package.json` is skip-worktree ("a local variant"), so committed scripts may be missing; `git ls-files -v server/package.json` prints `H` (tracked normally) → edit `server/package.json` scripts as usual — they are committed (the `arch*` scripts were added this way). Evidence: `.github/workflows/server-unit.yml:106`
  - **2026-09-28** — TESTING.md no longer claims it: CI calls the committed `pnpm test:unit` / `pnpm test:it` scripts (Vitest workspace projects). Evidence: `TESTING.md:86-90`, `.github/workflows/server-unit.yml:114`.
- **2026-09-27** — `react-best-practices` tells agents to style with Tailwind utilities and "no inline `style={}`", to put shared code in `utils/` or `components/ui/`, and to use `useApiQuery`/`useApiMutation` and Axios; none of that exists in `client/`, which uses `style={s.x}`, `src/lib/<purpose>.ts` and named TanStack hooks over `fetch` → for structure and placement follow `client/CLAUDE.md` and the `frontend-ui-architecture` skill, which lists these conflicts. Evidence: `.claude/skills/react-best-practices/SKILL.md:111,117,171`, `client/CLAUDE.md:27`
- **2026-09-28** — `TESTING.md` says the server `typecheck` job also runs on Windows as the `@ast-grep/napi` prebuilt gate, but `server-unit.yml` runs it on Linux only and its header says Windows is deliberately not matrixed → there is no Windows gate; don't rely on one. Evidence: `TESTING.md:42-44`, `.github/workflows/server-unit.yml:4-8`
  - **2026-09-28** — Fixed in place: TESTING.md now says both server-unit jobs run on Ubuntu only. Evidence: `TESTING.md:42`.

## Session notes

- **2026-09-23** — Added the engineering-insights skill and the fixed sections: +2 (Doc drift, Open questions)
- **2026-09-23** — Run Cost Badge (lab task 3): +1 (Doc drift)
- **2026-09-23** — Findings-by-severity spec + plan: +1 (Codebase patterns)
- **2026-09-23** — Findings-by-severity implementation: +1 (Recurring errors & fixes)
- **2026-09-23** — HW1 check against the grading criteria: +1 (Tool & library notes)
- **2026-09-23** — HW1 fixes, block B (hermetic e2e vs the dev stack): +1 (Recurring errors & fixes, nuance)
- **2026-09-23** — HW1 fixes, block D (naming sections + per-package stack): +1 (Codebase patterns)
- **2026-09-23** — HW1 fixes, block E (path:line in every entry + script check): +3 (Open questions ×2 line evidence, Tool & library notes superseded)
- **2026-09-23** — HW1 re-check against the 24 grading criteria: +1 (Tool & library notes)
- **2026-09-23** — PR description + insights audit: +3 (Codebase patterns superseded, Tool & library notes ×2 incl. nuance)
- **2026-09-27** — onion-architecture skill + dependency-cruiser boundaries (`pnpm arch`): +1 (Doc drift)
- **2026-09-27** — frontend-ui-architecture skill (research, SKILL.md, two eval rounds): +1 (Doc drift)
- **2026-09-27** — frontend-ui-architecture 1.2.0 (round-3 evals): +1 (Tool & library notes)
- **2026-09-27** — frontend-ui-architecture 1.2.0 final (softened deviations rule, eval exclude template): +1 (Tool & library notes, nuance)
- **2026-09-28** — onion-architecture follow-up (CI-layout check, stale `package.json` citation): +1 (Codebase patterns nuance)
- **2026-09-28** — Whole-project audit (improvement plan): +1 (Doc drift)
- **2026-09-28** — Wave 0 fixes + doc citation pass: +2 (What doesn't work, Open questions)
- **2026-09-28** — Wave 4 (tooling, CI pinning/timeouts/lint, e2e flow 08, contract sync, docs pass): +5 (Tool & library notes, Recurring errors & fixes fix note, Open questions answer, Doc drift ×2 fix notes)
- **2026-09-29** — Wave 5 (docs: stale README/TESTING/spec claims fixed in place): +4 (Doc drift fix notes)
- **2026-09-29** — Wave 6 (dependency bumps, behaviour changes, cleanup, docs): +1 (Open questions answer)
- **2026-09-29** — Docs pass after wave 6 (poll page limit, detail refresh, skills-lock note, stale service example): +1 (Open questions nuance)
- **2026-10-01** — PR Self Review skill plan (no code): +1 (Tool & library notes)
- **2026-10-01** — PR Self Review skill implemented (scripts, gate, hooks, CI check, fixture run): +3 (Tool & library notes ×2, nuance)
- **2026-10-03** — L02 Skills Lab (multi-agent build; docs + citations pass): +3 (Codebase patterns, Tool & library notes, What doesn't work)
- **2026-10-04** — HW2 Conventions Extractor (contracts in both copies, shared skill helpers promoted, ~50 doc citations remapped): +2 (Codebase patterns nuance, What doesn't work nuance)
- **2026-10-04** — Conventions scan "cut off at the token limit (6000)" fix (cap 12000; reasoning.effort probed and dropped): +1 (Tool & library notes)
- **2026-10-04** — Conventions scan as a background job (contracts: scan status + latest_scan): +1 nuance (Tool & library notes)
- **2026-10-04** — Skill URL import + injection gate (contract, parallel server/client/docs agents, citation remap across specs/docs/skills): +1 nuance (What doesn't work)
- **2026-10-05** — HW2 check against the 53 grading criteria (audit + small client fixes): +1 (Tool & library notes)
- **2026-10-05** — HW2 #21: push-gate hooks removed, pr-self-review 1.2.0 (manual run only): +1 (Codebase patterns)
- **2026-10-05** — HW2 URL-import demo: `devdigest-review-skills` 1.0.0 plugin + root marketplace, injected `dependency-hygiene` fixture: +1 (Tool & library notes)
- **2026-10-05** — onion-architecture references: 9 stale `server/` citations + 1 renamed function fixed in place: +1 (What works)

## Open questions

- **2026-09-23** — `e2e-web.yml` and `server-integration.yml` have no
  `reviewer-core/**` path filter, yet the API they boot loads `reviewer-core` at
  runtime — an engine-only change skips both suites. Intentional? Evidence:
  `.github/workflows/e2e-web.yml`, `.github/workflows/server-integration.yml`
  (`paths:`).
  - **2026-09-23** — Line evidence: the `paths:` filters are `.github/workflows/e2e-web.yml:14-24` and `.github/workflows/server-integration.yml:16-22`, and neither lists `reviewer-core/**`, although `.github/workflows/server-integration.yml:53-55` itself says the server source imports reviewer-core.
  - **2026-09-28** — Answered: both workflows now list `reviewer-core/**` (and e2e-web also `docker-compose.yml`). Evidence: `.github/workflows/e2e-web.yml:18,26`, `.github/workflows/server-integration.yml:19,24`.
- **2026-09-23** — `skills-lock.json` is not the skill inventory: it lists
  `architecture-patterns` and `github-workflow-automation`, which are not in
  `.claude/skills/`, and omits five that are (`engineering-insights`,
  `mermaid-diagram`, `react-*`, `security`) → use `ls .claude/skills` for what is
  installed. Maintained by a tool, or stale? Evidence: `skills-lock.json`.
  - **2026-09-23** — Line evidence: `skills-lock.json:4` (`architecture-patterns`) and `skills-lock.json:22` (`github-workflow-automation`); neither folder exists under `.claude/skills/`.
  - **2026-09-29** — Documented, still open: `.claude/skills/README.md` now says the file is not the inventory (`ls .claude/skills` is); whether to regenerate or drop `skills-lock.json` is the owner's call. Evidence: `.claude/skills/README.md:5-6`.
  - **2026-09-29** — Answered: the file belongs to the `skills` CLI (vercel-labs/skills), which tracks only skills added from a source; `npx skills remove architecture-patterns github-workflow-automation -y` dropped the two stale entries, and the lock now lists the six third-party skills installed, while `npx skills list -p` shows the seven written here as `local`. Evidence: `skills-lock.json:3-40`, `.claude/skills/README.md:5-7`.
- **2026-09-28** — Publish Postgres on loopback only (its dev password is public; `docker-compose.yml` publishes `5432:5432` on every interface)? It was reverted from the wave-0 fixes: `server/.env` and CI `e2e-web.yml` connect to `localhost:5432`, and `scripts/e2e.sh` already avoids `localhost` because it can resolve to `::1` while a container publishes IPv4 only → switch `DATABASE_URL` to `127.0.0.1` together with `"127.0.0.1:5432:5432"`, then recreate the container. Evidence: `docker-compose.yml:13`, `scripts/e2e.sh:38-39`, `.github/workflows/e2e-web.yml:34`
  - **2026-09-29** — Answered: both compose files publish `127.0.0.1:5432:5432` and nothing else changed — Node 22 falls back from `::1` to 127.0.0.1 for `localhost` (a probe container connected via `localhost`, `127.0.0.1`, not from the LAN address), while Docker Desktop silently dropped an extra `[::1]:5432` mapping. The running container keeps its old binding until compose recreates it. Evidence: `docker-compose.yml:15`, `scripts/e2e.sh:114`.
