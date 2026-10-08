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
| [`pr-self-review-reviewer`](pr-self-review-reviewer.md) | Reviews one diff batch through one skill or spec for `/pr-self-review` | `inherit` | no (records findings via the skill's script) | — |
| [`pr-self-review-verifier`](pr-self-review-verifier.md) | Tries to refute one CRITICAL finding for `/pr-self-review` | `inherit` | no (records a verdict via the skill's script) | — |

## How they fit together

```
task / spec ─▶ planner ─▶ Development Plan ─▶ user approves ─▶ implementer ─▶ Implementation report
                 │                                                               │
                 └─ Research needed ─▶ researcher                                └─▶ architecture / security
                                       (also on its own: one question → report)      review (separate agents),
                                                                                     /pr-self-review
```

The main session (orchestrator):
- passes the user's decisions in every brief — a subagent doesn't see the conversation;
- shows the plan to the user before the implementer runs;
- appends the agents' **Insight candidates** to `INSIGHTS.md` through the
  `engineering-insights` script — no agent writes there itself;
- commits and pushes only with the user's OK.

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
  Contracts & data (API table, Data model table, Migration), §4 Steps (files,
  skills, hard rules, insights, tests, `Verify:`), §5 Skill map, §6 Final
  verification, §7 Out of scope / Unchanged, §8 Open questions · Research
  needed, §9 Review hand-off. Or `## Clarification needed`.
- **Decides:** scope, placement of every file, the API contract, the data model
  (tables, columns, types, constraints, indexes, migration effect),
  transactions, client data flow, step order, what to test.
  **Leaves to the implementer:** code, Drizzle / Zod / Fastify syntax, names,
  styles, test code.
- **Permissions:** `Read, Grep, Glob, Bash`; denies `Write, Edit,
  NotebookEdit, Skill, Agent, WebSearch, WebFetch`. External facts go to
  *Research needed*.
- **Skills:** preloads `onion-architecture`, `frontend-ui-architecture`,
  `engineering-insights`; must Read `postgresql-table-design` for any schema
  change and `security` for a new endpoint or untrusted input; reads
  `next-best-practices` when needed.
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
