# Agents

Project subagents for Claude Code. The main session delegates to them and is the
only one that talks to the user: a subagent has no `AskUserQuestion`, so it
returns its questions instead. This page is a map — each agent's file holds its
full rules.

## At a glance

| Agent | Responsibility | Model | Can change files | Preloaded skills |
|---|---|---|---|---|
| [`researcher`](researcher.md) | Answers one concrete question about the repo or from external sources, with evidence | `sonnet` | no | — |
| [`planner`](planner.md) | Turns a task or spec into a Development Plan; makes the design decisions | `opus`, effort `high` | no | 3 |
| [`implementer`](implementer.md) | Executes an approved plan; makes the touched packages' tests and typecheck pass | `sonnet` | yes (uncommitted) | 12 |
| [`test-writer-ui`](test-writer-ui.md) | Writes `client/` tests — test-first (red before the code) or cover (for existing code) | `sonnet` | test files only (uncommitted) | 1 |
| [`test-writer-backend`](test-writer-backend.md) | Writes `server/` and `reviewer-core/` tests, same two modes | `sonnet` | test files only (uncommitted) | 1 |
| [`plan-verifier`](plan-verifier.md) | Proves, requirement by requirement, that a change does what its plan or spec asks | `sonnet` | no | — |
| [`architecture-reviewer`](architecture-reviewer.md) | Reviews one change's design in one pass: rings, placement, contracts, the plan's decisions | `opus`, effort `medium` | no | — |
| [`doc-writer`](doc-writer.md) | Writes docs from the code, a plan or other materials, with Mermaid diagrams | `sonnet` | docs only (uncommitted) | 1 |
| [`pr-self-review-reviewer`](pr-self-review-reviewer.md) | Reviews one diff batch through one skill or spec for `/pr-self-review` | `inherit` | no (records findings via the skill's script) | — |
| [`pr-self-review-verifier`](pr-self-review-verifier.md) | Tries to refute one CRITICAL finding for `/pr-self-review` | `inherit` | no (records a verdict via the skill's script) | — |

## How they fit together

```
task / spec ─▶ planner ─▶ Development Plan ─▶ user approves
                 │                                  │
                 └─ Research needed ─▶ researcher   ├─▶ test-writer-ui / -backend  (Mode: test-first, optional)
                    (also on its own: one           │        └─▶ red tests ─┐
                     question → report)             ▼                       ▼
                                               implementer ◀────────────────┘  makes them pass
                                                    │
                       ┌────────────────────────────┴────────────────────────────┐
                       ▼                                                         ▼
                 plan-verifier                                         architecture-reviewer
                 (plan or spec + diff)                                 (diff + plan)
                   gaps ─▶ implementer                                   CRITICAL ─▶ implementer
                   missing tests ─▶ test-writer-* (Mode: cover)
                       └────────────────────────────┬────────────────────────────┘
                                                    ▼
                                    doc-writer (last; citations once)
                                                    ▼
                               /pr-self-review (user) ─▶ commit (user's OK)
```

`plan-verifier` and `architecture-reviewer` only read the same tree, so they can run in
parallel; neither sees the implementer's reasoning.

Test modes are decided in the plan: the planner gives every step a `Test mode:` —
`test-first`, `implementer` or `—` — and the user confirms or changes them when
approving it. The orchestrator then runs `test-writer-*` with `Mode: test-first` for
those steps before the implementer; `Mode: cover` comes later, for the gaps
`plan-verifier` finds.

The main session (orchestrator):
- passes the user's decisions in every brief — a subagent doesn't see the conversation;
- shows the plan to the user before the implementer runs;
- appends the agents' **Insight candidates** to `INSIGHTS.md` through the
  `engineering-insights` script — no agent writes there itself;
- commits and pushes only with the user's OK.

What each brief carries (besides the branch). Every agent that reads the diff also
gets the starting `git status` paths that belong to other work, so it leaves them out:

| Agent | Brief |
|---|---|
| `planner` | the task or spec path, the user's decisions |
| `test-writer-*` | `Mode: test-first` (a plan step marked so, with its `Tests:` line) or `cover` (the gaps `plan-verifier` found); the requirement source (plan step, contract, spec, or code path) |
| `implementer` | the approved plan; the red tests from `test-writer-*`, if any |
| `plan-verifier` | the plan or spec, the base ref — not the implementer's report as evidence (at most a hint where to look) |
| `architecture-reviewer` | scope `uncommitted` or `branch`; the plan, if any |
| `doc-writer` | `Mode: describe`, `from-plan` or `from-materials`; topic or path; audience; the docs whose citations the implementer already remapped |

## researcher

- **Input:** one concrete question and its scope — repo, web or both. A topic
  without a question gets `## Clarification needed` back.
- **Output:** `# Repo research` and/or `# External research` report (Answer,
  Confidence, Conclusions, Evidence with `R`/`W` ids, Links, Not found), plus
  `## Synthesis` when both.
- **Permissions:** `Read, Grep, Glob, Bash, WebSearch, WebFetch`; denies
  `Write, Edit, NotebookEdit, Skill, Agent`. Bash only for read-only `git` and
  file inspection.

## planner

- **Input:** the task or a spec path (`<pkg>/specs/NN-*.md`), the user's
  decisions, the branch.
- **Output:** `# Development Plan` — Status (READY / NEEDS INPUT), §1 Context
  read (rules, *INSIGHTS applied*, specs, *Skills read*), §2 Decisions, §3
  Contracts & data (*Flow* — a Mermaid diagram of how the layers interact, or
  `none — one layer`; API table, Data model table, Migration), §4 Steps (files,
  skills, hard rules, insights, tests, `Test mode:`, `Verify:`), §5 Skill map, §6 Final
  verification, §7 Out of scope / Unchanged, §8 Open questions · Research
  needed, §9 Review hand-off. Or `## Clarification needed`.
- **Decides:** scope, placement of every file, the API contract, the data model
  (tables, columns, types, constraints, indexes, migration effect),
  transactions, client data flow, how the layers interact, step order, what to
  test.
  **Leaves to the implementer:** code, Drizzle / Zod / Fastify syntax, names,
  styles, test code.
- **Permissions:** `Read, Grep, Glob, Bash`; denies `Write, Edit,
  NotebookEdit, Skill, Agent, WebSearch, WebFetch`. External facts go to
  *Research needed*.
- **Skills:** preloads `onion-architecture`, `frontend-ui-architecture`,
  `engineering-insights`; must Read `postgresql-table-design` for any schema
  change, `security` for a new endpoint or untrusted input, and
  `mermaid-diagram` whenever the plan draws a diagram (not preloaded: plans
  inside one layer don't need it); reads `next-best-practices` when needed.
- **Reads:** package `CLAUDE.md`, the full `INSIGHTS.md` of every module in
  scope (it is the implementer's filter), the spec with Amendments,
  `.claude/skills/pr-self-review/routing.json`, the hard-rule catalog in
  `.claude/skills/pr-self-review/references/severity.md`, and `## Limits` of
  `implementer.md`.
- **Cost:** a full-stack plan took ~17 min and ~$6 (2026-10-08, before
  `effort: high` was set; it then inherited the session's effort) — run it in the
  background, and only for changes that span files or layers.

## implementer

- **Input:** an approved plan with `Status: READY` (text or a file path) and the
  branch. No plan, or a worktree / other branch → BLOCKED.
  Red tests that `test-writer-*` wrote first stay as written; it makes them pass.
- **Output:** uncommitted changes in the main checkout and
  `# Implementation report` — Status (DONE / PARTIAL / BLOCKED), Changes,
  Skills applied (`(plan)` or `(routing.json)` per file), Verification
  (command → exit code and counts), Deviations, Not done / open, For reviewers,
  Insight candidates.
- **Permissions:** `Read, Grep, Glob, Edit, Write, Bash`; denies `Agent, Skill,
  WebSearch, WebFetch, NotebookEdit`. Prompt limits: no git history commands,
  files change only through Write / Edit, no do-not-touch paths, no new
  dependencies, no `INSIGHTS.md` writes, no lint / `pnpm arch` / review.
- **Skills:** preloads `onion-architecture`, `frontend-ui-architecture`,
  `engineering-insights`, `fastify-best-practices`, `drizzle-orm-patterns`,
  `postgresql-table-design`, `next-best-practices`, `react-best-practices`,
  `react-testing-library`, `zod`, `typescript-expert`, `security`. Applies the
  plan's Skill map; matches `routing.json` itself only for files outside the
  plan; reads `mermaid-diagram` or a new skill's `SKILL.md` when routed.
- **INSIGHTS:** applies the plan's entries; reads a module's `INSIGHTS.md` only
  for a module outside the plan, or greps it for an error before fixing.
- **Verifies:** the plan's tests, then every touched package's full suite and
  typecheck (`pnpm test:unit` / `test:it` in `server/`, `pnpm test` in
  `client/`, `npm test` in `reviewer-core/`); the same test failing after two
  fixes → PARTIAL.

## test-writer-ui · test-writer-backend

- **Input:** `Mode: test-first` or `cover`, the requirement source (a plan step, a
  contract, a spec, or the code path to cover). No mode → `## Clarification needed`.
- **Output:** uncommitted test files and `# Test report` — Status (RED / DONE /
  BUG FOUND / PARTIAL / BLOCKED), Tests (requirement line, red reason, green ×3,
  assertion live), Verification, Production bugs, Not covered (e2e candidates,
  Docker, helper changes), Insight candidates.
- **Modes:** `test-first` writes tests from the requirement before the code
  exists and proves them red for the right reason (a missing module, export or
  behaviour — not a typo in the test). `cover` ties every assertion to a
  requirement line and proves it can fail by flipping the expected value in the
  test file. **Production code is never edited, not even temporarily** (user's
  decision, 2026-10-08): a test that exposes a bug stays red and the status is
  BUG FOUND.
- **Writes (prompt rule):** ui — `client/src/**/*.test.{ts,tsx}`; backend —
  `server/test/*.test.ts`, `*.it.test.ts`, `reviewer-core/test/*.test.ts`. Never
  helpers, setup, `mocks.ts`, vitest config, messages, `e2e/**`.
- **Permissions:** `Read, Grep, Glob, Edit, Write, Bash`; denies `Agent, Skill,
  WebSearch, WebFetch, NotebookEdit`. The implementer's git and Bash-write limits.
- **Skills:** preloads `react-testing-library` (ui) or `onion-architecture`
  (backend); always reads the package `CLAUDE.md`, `INSIGHTS.md` and `TESTING.md`.
- **Verifies:** each new test 3×, then the package suite and typecheck.

## plan-verifier

- **Input:** the plan (text or path) or a spec path, the base ref (default
  `HEAD`). A plan with `Source: <spec>` is also checked against that spec's
  acceptance criteria and Amendments.
- **Output:** `# Plan verification` — Verdict PASS / GAPS / FAIL with counts;
  a Requirements matrix (`S`/`D`/`C`/`M`/`AC`/`U`/`DW` ids · `met` / `partial` /
  `missing` / `deviated` / `unverifiable` · evidence level exists → substantive →
  wired, strength `ran` > `test` > `code` > `doc` · gap); Checks I ran; Outside the
  plan; For the human; Insight candidates.
- **Judges:** completeness both ways — a requirement without evidence, and a
  changed file without a requirement or a touched Unchanged path. Not style or design.
- **Permissions:** `Read, Grep, Glob, Bash`; denies `Write, Edit, NotebookEdit,
  Skill, Agent, WebSearch, WebFetch`. Runs typecheck and tests through
  `<pkg>/node_modules/.bin`, never `pnpm` / `npm`; `*.it.test.ts` only when
  `docker info` succeeds, else `unverifiable` with the command for a human;
  compares `git status --porcelain` before and after.

## architecture-reviewer

- **Input:** scope `uncommitted` (against `HEAD`) or `branch` (against
  `git merge-base origin/main HEAD`); the plan, if any, for its decisions.
- **Output:** `# Architecture review` — Verdict APPROVE / APPROVE WITH WARNINGS /
  CHANGES REQUESTED, Scope, Read, Tool checks, Findings
  (`A1 · severity · confidence · rule_id · path:line · new`, then What / Why it
  matters here / Suggestion), Plan decisions, Pre-existing (≤ 5, not counted),
  Not reviewed, Insight candidates.
- **Reviews:** one pass over how the pieces fit — rings and ports, module and
  package boundaries, transactions, the contract mirror, client data flow,
  over-engineering, the plan's decisions. Every finding is re-read and checked
  against the base; unsure, pre-existing, style and linter matters are dropped.
- **Permissions:** read-only like `plan-verifier`. Runs depcruise,
  `baseline-diff.mjs` against the merge-base and, when a `routes.ts` changed, the
  routes ratchet test — all through binaries.
- **Skills:** none preloaded; on Opus it Reads `onion-architecture` (server/,
  reviewer-core/), `frontend-ui-architecture` (client/), `postgresql-table-design`
  (schema) and `security` (new route, untrusted input) by what the diff touches,
  and lists them in `Read:`.
- **vs `/pr-self-review`:** that skill is user-invoked, splits the diff into
  batches per skill lens, runs the deterministic checks D1–D11 and stores a
  verdict for the push gate. This agent makes one holistic pass, uses the same
  `rule_id`s from `severity.md`, and writes nothing to the review store.

## doc-writer

- **Input:** `Mode: describe`, `from-plan` or `from-materials`; the topic or
  path; the audience; an optional target file; the docs whose citations the
  implementer already remapped.
- **Output:** uncommitted docs and `# Docs report` — Files (Diátaxis type),
  Diagrams, Planned (not built), Changed existing lines, Open questions, For the
  caller (proposed `CLAUDE.md` lines), Insight candidates.
- **Writes (prompt rule):** `README.md`, `<pkg>/README.md`, `<pkg>/docs/*.md` and
  their index, `TESTING.md`, `e2e/docs/`, contract specs and their citations, a
  feature spec's Amendment when the brief says so. Never code, `*.json`,
  `CLAUDE.md`, `INSIGHTS.md`, `.claude/**`, `docs/plans/**`,
  `docs/agent-prompts/**`, `docs/agent-skills/**`.
- **Rules:** one Diátaxis type per file; every claim from the code with
  `path:line`; what a plan has and the code doesn't goes under **Planned (not
  implemented yet)**; diagrams only where they add something; docs in English.
- **Permissions:** `Read, Grep, Glob, Edit, Write, Bash`; denies `Agent, Skill,
  WebSearch, WebFetch, NotebookEdit`. Preloads `mermaid-diagram`.
- **When:** last, after code and tests are final; the implementer still fixes the
  stale docs its plan's last step names.

## pr-self-review-reviewer · pr-self-review-verifier

Spawned only by the [`pr-self-review`](../skills/pr-self-review/SKILL.md) skill
— input comes in the task message (run id, task id, lens, diff file), findings
and verdicts are recorded with that skill's script, and the final message is one
line. `Read, Grep, Glob, Bash, Skill`; model `inherit`.

## Sources behind planner and implementer

External, checked against the raw pages on 2026-10-08:
**S1** [Create custom subagents](https://code.claude.com/docs/en/sub-agents) ·
**S2** [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) ·
**S3** [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) ·
**S4** [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

| Rule | Where | Source |
|---|---|---|
| One job per agent; descriptions that single out one agent | both: `description`, `## Limits` | S1 Example subagents (best-practices tip) |
| Least privilege: `tools` allowlist, `disallowedTools` denylist; a `Bash(...)` specifier removes all of Bash | both: frontmatter | S1 Write subagent files, Available tools |
| Preload skills with `skills:` (full content injected); `disable-model-invocation` skills can't be preloaded | both: `skills:`; `pr-self-review` excluded | S1 Preload skills into subagents |
| No `memory`, `isolation` or `permissionMode` (memory adds Write / Edit; a worktree branches from the default branch; mode is ignored under auto / acceptEdits) | both: absent fields | S1 Write subagent files, Enable persistent memory, Permission modes |
| Fresh context, no conversation history → the brief carries inputs and decisions | planner `## 1`, implementer `## 1` | S1 What loads at startup |
| No `AskUserQuestion` in subagents → return questions | planner *Clarification needed*, implementer BLOCKED | S1 Available tools |
| Separate planning from implementation; skip the plan for a one-sentence diff | two agents; planner `description` | S2 Explore first, then plan, then code |
| A plan names files and interfaces, scope, and ends with end-to-end verification | planner §3, §4, §6, §7 | S2 Let Claude interview you |
| Give the agent a check it can run; show evidence, not claims | planner `Verify:`; implementer `## 3`, Verification table | S2 Give Claude a way to verify its work |
| The agent doing the work isn't the one grading it | implementer: no review; *For reviewers*, §9 Review hand-off | S2 Give Claude a way to verify its work, Add an adversarial review step |
| Stop after repeated failed corrections; pause at blockers | implementer `## 4` (two fix attempts) | S2 Course-correct early and often; S3 |
| Ground truth from the environment at each step | implementer runs each step's `Verify:` | S3 |
| Context is finite: high-signal tokens, just-in-time retrieval, condensed summaries | planner filters INSIGHTS; implementer reads on triggers; ~1–2K-token reports | S4 |
| Package rules, do-not-touch paths, test commands | both | root and package `CLAUDE.md`, `TESTING.md` |
| Skill routing, `suppress` notes, hard rules | planner `## 3`, implementer `## 2` | `.claude/skills/pr-self-review/routing.json`, `references/severity.md` |
| Language rule stated at the top and bottom; Sonnet needs mandatory steps as concrete actions | both: opening lines, *Rules for every …* | root `INSIGHTS.md`, entries of 2026-10-08 |
| A diagram when the plan crosses layers; its type follows the content; a required `Flow:` line, even when it is `none` | planner `## 5`, plan §3 *Flow* | S22, S23 (below); `mermaid-diagram` skill; root `INSIGHTS.md` 2026-10-08 (a required check fills a report field) |

## Sources behind the test, verifier, review and doc agents

Checked on 2026-10-08; S1/S2 and every quote from S10–S14 against the raw pages.
The digest with the quotes is
[`docs/plans/2026-10-08-review-test-doc-agents-research.md`](../../docs/plans/2026-10-08-review-test-doc-agents-research.md),
the plan [`docs/plans/2026-10-08-review-test-doc-agents.md`](../../docs/plans/2026-10-08-review-test-doc-agents.md).
**S5** [Anthropic `code-review` command](https://raw.githubusercontent.com/anthropics/claude-code/main/plugins/code-review/commands/code-review.md) ·
**S6** [Google — What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) ·
**S7** [Thoughtworks — fitness functions](https://www.thoughtworks.com/insights/articles/fitness-function-driven-development) ·
**S8** [dependency-cruiser CLI](https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/cli.md) ·
**S9** [Nygard — Documenting architecture decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) ·
**S10** [Testing Library — query priority](https://testing-library.com/docs/queries/about/#priority) ·
**S11** [Testing Library — guiding principles](https://testing-library.com/docs/guiding-principles/) ·
**S12** [Kent C. Dodds — Testing implementation details](https://kentcdodds.com/blog/testing-implementation-details) ·
**S13** [Fowler — The practical test pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) ·
**S14** [Vitest — mocking](https://vitest.dev/guide/mocking.html) ·
**S15** [Meta TestGen-LLM](https://arxiv.org/abs/2402.09171) ·
**S16** [Meta ACH (mutation-guided tests)](https://arxiv.org/abs/2501.12862) ·
**S17** [Spec Kit `analyze`](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/analyze.md) ·
**S18** [GSD verifier](https://raw.githubusercontent.com/gsd-build/get-shit-done/main/agents/gsd-verifier.md) (community, secondary) ·
**S19** [Judging LLM-as-a-judge](https://arxiv.org/abs/2306.05685) (abstract only) ·
**S20** [Diátaxis](https://diataxis.fr/compass/) ·
**S21** [Google developer documentation style guide](https://developers.google.com/style/highlights) ·
**S22** [C4 model](https://c4model.com/diagrams) ·
**S23** [Mermaid](https://mermaid.js.org/intro/) ·
**S24** [Write the Docs — docs as code](https://www.writethedocs.org/guide/docs-as-code/)

| Rule | Where | Source |
|---|---|---|
| A reviewer in a fresh context sees only the diff and the criteria; flag gaps against the requirements, not style | `plan-verifier`, `architecture-reviewer` | S2 Add an adversarial review step |
| Only high-signal findings, each validated; nothing pre-existing or a linter catches | `architecture-reviewer` §6 | S5 |
| Design questions: do the pieces interact sensibly, does it belong here, does it integrate; code health; over-engineering | `architecture-reviewer` §5 | S6 |
| Deterministic rules stay with depcruise, the baseline and the ratchet; the model judges what a rule can't express | `architecture-reviewer` §4 | S7, S8 |
| Check the change against the plan's design decisions | `architecture-reviewer` Plan decisions | S9 |
| Trace every requirement to evidence and every change to a requirement; never invent missing sections | `plan-verifier` §2, §5 | S17; S2 "nothing outside the task's scope changed" |
| The implementer's report is no evidence; start from "not done"; exists → substantive → wired | `plan-verifier` §4 | S18 |
| Verdict only after the evidence; a completion percentage is no signal | `plan-verifier` §6 | S19, S18 |
| Package checks through `node_modules/.bin`, never `pnpm` / `npm run` | read-only agents | root `INSIGHTS.md` 2026-10-01 (pnpm may install) |
| Tests from the requirement, proven red before the code | `test-writer-*` test-first | S2 "have one Claude write tests, then another write code to pass them" |
| Observable behaviour, not implementation details; as low on the pyramid as possible | `test-writer-*` §3 | S12, S13 |
| Query priority `getByRole` … `getByTestId` | `test-writer-ui` §2 | S10, S11 |
| Clear or restore mocks between tests | `test-writer-*` | S14 |
| Run each new test 3× (generated tests are often flaky) | `test-writer-*` §4 | S15 |
| No production-code mutation; flip the expected value in the test file instead | `test-writer-*` cover | the user's decision (S16's mutation approach rejected) |
| Classify a doc before writing it; one type per file | `doc-writer` §2 | S20 |
| Present tense only for shipped behaviour; the rest is marked planned | `doc-writer` §4 | S21 |
| A diagram only where it adds value; its type follows the content | `doc-writer` §5 | S22, S23 |
| Docs as code: diagrams as text next to the code, reviewed like code | `doc-writer` | S24 |
| Where each doc lives | `doc-writer` §3 | the `README.md` of each `docs/` and `specs/` folder |

## Working on this folder

- **Every `.md` here with a `name` in its frontmatter is an agent.** This README
  has no frontmatter, so Claude Code treats it as documentation (S1 *Subagent
  files Claude Code skips*); a `name` without a `description` is skipped
  silently — check with `claude --debug`.
- **No hooks yet** (since 2026-10-08, while the harness is assembled): agent
  limits are prompt rules only.
- **Main checkout only:** no `isolation` in frontmatter, and never pass
  `isolation: "worktree"` when delegating — agents work on the current branch.
- **macOS has no Grep / Glob tools:** prompts tell agents to search through Bash
  and exclude `server/clones/**`, `node_modules/`, `.next*/`.
- **Prompts in English, reports in the brief's language** — say so at the top
  and in the closing rules, and name the parts that must be translated.
- **Test a new or changed agent headless:**
  `claude -p "Delegate … to the <name> subagent" --permission-mode auto --output-format stream-json --verbose`.
  The subagent's model is in its own transcript (the `output_file` of the
  `task_notification` event), not in the result's `modelUsage`. A running
  session sees a new agent type only after a delay (15–30 min observed).
- **A new skill** needs a `routing.json` entry; add it to an agent's `skills:`
  only if that agent needs it in every task — the Read-fallback covers the rest.
- **Diagram rules live in the `mermaid-diagram` skill** — type, size, level of
  detail, naming and the checks by reading when nothing renders (*Validation →
  Without a renderer*). `planner` and `doc-writer` keep only when and where to
  draw; change the skill, not the agents (`implementer` and `/pr-self-review`
  read it too).
- **`test-writer-ui` and `test-writer-backend` share `## 1.` and everything from
  `## 3.` on, verbatim** — change both, then check that
  `diff <(sed -n '/^## 3\./,$p' test-writer-ui.md) <(sed -n '/^## 3\./,$p' test-writer-backend.md)`
  prints nothing.
- **Read-only agents run package checks through `<pkg>/node_modules/.bin`**
  (`tsc`, `vitest`, `depcruise`), never `pnpm` / `npm run`: pnpm 12 may install
  before a script and change the tree.
- **Parse the frontmatter after editing a `description`:** a `: ` inside it
  (`Mode: test-first`) is invalid YAML for a strict parser
  (`cd server && node -e 'require("yaml").parse(…)'`). Claude Code still loaded
  such a file on 2026-10-08, but don't rely on it.
