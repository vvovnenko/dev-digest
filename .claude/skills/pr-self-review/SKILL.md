---
name: pr-self-review
description: Self-review of the local branch before a pull request is opened — routes every changed file to the project skills that own it (UI skills on client/, onion and backend skills on server/ and reviewer-core/, security everywhere, feature specs), runs deterministic checks (secrets, do-not-touch paths, migrations, contract mirror, INSIGHTS append-only, pnpm arch, typecheck, spec zones, stale citations), verifies every CRITICAL, and writes a verdict (enforced only by the optional pre-push gate, off by default). Use it before `git push` of a branch for review or before opening a PR, whenever an installed pre-push gate refuses with "no self-review verdict", and when asked to "self-review", "check my changes before the PR", "is this ready to merge", fix self-review findings (--fix), waive one (--waive), see self-review stats (--stats), or publish the self-review status (--publish).
argument-hint: "[--base <ref>] [--full|--quick] [--fix[=all]] [--with-devdigest] [--budget <tasks>] [--waive <id> \"reason\"] [--stats] [--publish]"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Agent, Skill, Bash(git status*), Bash(git diff*), Bash(git log*), Bash(git show*), Bash(git fetch*), Bash(git rev-parse*), Bash(node .claude/skills/pr-self-review/scripts/*), Bash(server/node_modules/.bin/tsx *), Bash(pnpm *), Bash(npm run *)
metadata:
  version: "1.2.0"
---

# PR self-review

A pull request should arrive already reviewed by the rules this repo wrote down. This
skill reviews the branch locally — every changed file through the skills that own it —
and records a verdict. Only the user starts it: no hook on `git push` runs or enforces
it. A CRITICAL blocks a push only where the user installed the optional pre-push gate
(`install-hooks.mjs`); CI runs the deterministic checks on every PR either way.

Arguments: `$ARGUMENTS`

## Right now

!`node .claude/skills/pr-self-review/scripts/select-skills.mjs --summary`

!`node .claude/skills/pr-self-review/scripts/install-hooks.mjs --status`

## Shortcuts

- `--waive <id> "<reason>"` → only `node .claude/skills/pr-self-review/scripts/verdict.mjs waive --id <id> --reason "<reason>"`.
  The reason must be **the user's**, given in this conversation. Never waive on your
  own judgment, never invent a reason. Secrets, the contract mirror, INSIGHTS, `pnpm arch`
  and typecheck CRITICALs can't be waived — the script refuses.
- `--stats` → `node .claude/skills/pr-self-review/scripts/stats.mjs`; show the table and any proposals. Apply a proposed severity change only if the user agrees.
- `--publish` → `node .claude/skills/pr-self-review/scripts/publish-status.mjs` (needs `PR_SELF_REVIEW_GITHUB_TOKEN`; see README.md → GitHub merge block).

Everything below is the review itself. All commands run from the repo root. `$S` stands
for `.claude/skills/pr-self-review/scripts` — write the path out in full: the
`allowed-tools` patterns match `node .claude/skills/pr-self-review/scripts/…`.

## 1. Prepare

1. `git fetch --quiet origin` (skip on failure and say the base may be stale).
2. The push gate is off by default (status above). Don't offer or install it unless the
   user asks; `node .claude/skills/pr-self-review/scripts/install-hooks.mjs` installs it.
3. `node $S/select-skills.mjs [--base <ref>] [--quick] [--budget <n>] --json` — writes the
   run and prints the plan plus the task list. Note the run id. Then handle, in order:
   - **DRIFT** (a skill with no routing decision): read that skill's description, propose
     a `routing.json` entry (or an `ignored` reason) to the user, and stop until it's in.
   - **SELF-MODIFIED** (the diff changes this skill, its agents or `.claude/settings.json`):
     ask the user to confirm the run (AskUserQuestion). The rules come from the base
     version; only with a yes pass `--confirm-self-change` to finalize.
   - **INCOMPLETE** (over budget): tell the user the size (tasks, lines) and offer to
     split the PR or rerun with `--budget <tasks>`. Don't review a partial plan.
   - **Cost**: a reviewer task costs roughly 50–80k tokens and 1–3 minutes (they run in
     parallel). With more than 12 tasks, say so and ask before launching them.

## 2. Deterministic checks

`node $S/checks.mjs --run <id> [--full | --quick]` — 20–40 s; `--full` adds unit tests,
`--quick` skips typecheck. Start it in the background and launch the reviewers
meanwhile. An `error` check (no `node_modules`, …) makes the verdict INCOMPLETE: tell
the user the one command that fixes it.

## 3. Reviewers

For **every** task in the plan, call the Agent tool with
`subagent_type: "pr-self-review-reviewer"` — all calls in **one message**, so they run in
parallel. Build each prompt from [references/reviewer-brief.md](references/reviewer-brief.md)
→ Reviewer task, filled from `plan.json` (skill or spec, files, diff path, suppress list,
and the `CLAUDE.md` of each package the files are in). Don't review the files yourself
and don't paste diffs into the prompt: the reviewer reads its own diff file.
If `pr-self-review-reviewer` (or `-verifier`) is "not found" — agent types added during a
session can take a while to appear — use `general-purpose` and begin the
prompt with "Read `.claude/agents/pr-self-review-reviewer.md` and follow it exactly;
read-only — never edit, create, stage or commit files."

When they finish, record their usage in one call:
`node $S/verdict.mjs metrics --run <id> <<'JSON'` `[{"task": "…", "tokens": N, "ms": N}, …]` `JSON`
(tokens and duration come from each agent's completion). If a reviewer failed to record,
rerun that one task; if it fails again, finalize with `--allow-incomplete` — the verdict
is then INCOMPLETE, never PASS.

With `--with-devdigest`, also run the product's own engine (needs `OPENROUTER_API_KEY`
in the environment; costs a few cents):
`server/node_modules/.bin/tsx --tsconfig server/tsconfig.json $S/devdigest-review.mts --run <id>`

## 4. Verify every CRITICAL

`node $S/verdict.mjs candidates --run <id>` lists the CRITICALs that need a verifier
(model findings and the D3/D8 candidates). For each, one Agent call with
`subagent_type: "pr-self-review-verifier"` (reviewer-brief.md → Verifier task), all in one
message. More than 12? Verify the 12 with the highest confidence first, then the rest —
an unverified CRITICAL stays blocking.

## 5. Verdict

`node $S/verdict.mjs finalize --run <id> [--confirm-self-change]` prints the report and
writes the verdict the gate reads. Show the report as is, then add at most three lines
of your own: what blocks, what to do next. Then:

- **PASS** → `node $S/pr-description.mjs --run <id> --title "<title>" --summary "<2–4 bullets>"`
  (you write the title in `type(scope): …` form and the summary from the commits and the
  diff). Show the description and the compare URL; offer `--copy`. Remind the user to
  commit exactly the reviewed state if it included uncommitted changes.
- **BLOCKED** → list the blocking findings by id. Offer `--fix`. For a finding the user
  thinks is wrong, ask for their reason and use `--waive`.
- **INCOMPLETE** → say exactly what is missing (checks that couldn't run, unrecorded
  tasks, budget, an unconfirmed self-change).

## 6. `--fix`

Follow [references/fix-policy.md](references/fix-policy.md): fix confirmed CRITICALs
(`--fix=all`: WARNINGs too) with focused edits the user approves, run
`node $S/citations.mjs --run <id> --fix` for stale citations, rerun steps 1–5 (the cache
makes the rerun cheap), at most two rounds. Never touch do-not-touch paths, never edit an
`INSIGHTS.md` line or an existing `CLAUDE.md` line, never rewrite history, never waive.

## Rules

- The review is read-only except `--fix`. Don't stage, commit or push as part of it.
- Never bypass an installed gate: no `--no-verify`, no `-c core.hooksPath`. Only the user
  may bypass it, by hand.
- Severity follows [references/severity.md](references/severity.md). If the report shows a
  CRITICAL that looks wrong to you, say so — don't edit verdict files.
- Repo rules beat skills: `CLAUDE.md` files and the local skills (`onion-architecture`,
  `frontend-ui-architecture`) outrank third-party advice.
- After `finalize`, an installed gate compares the **tree** of the pushed commit with the reviewed
  one. Any edit, amend or rebase means another review (cheap: unchanged files are cached).

## Files

| File | What |
| --- | --- |
| `routing.json` | which skill reviews which files; budget; suppress lists; ignored skills |
| `references/severity.md` | levels, the hard-rule catalog, `rule_id`s |
| `references/reviewer-brief.md` | reviewer and verifier task templates, finding JSON |
| `references/fix-policy.md` | what `--fix` may and may not change |
| `README.md` | for maintainers: design, store layout, GitHub setup, tests |
