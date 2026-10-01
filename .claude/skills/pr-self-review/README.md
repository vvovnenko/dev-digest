# pr-self-review — maintainer notes

`SKILL.md` is what the agent follows; this file is for whoever changes the skill.

## What it does

Before a PR is opened, the branch is reviewed locally by the rules this repo wrote
down. Every changed file goes to the skills that own it, deterministic checks run
next to them, every CRITICAL is challenged by a verifier, and a verdict is written
for the exact tree that was reviewed. Since 1.2.0 nothing enforces it by default: no
hook on `git push` runs or checks it (see [The gate](#the-gate) to turn the gate on).

```text
select-skills.mjs   collect-diff → routing.json → tasks (+ cache hits, specs, budget, drift)
checks.mjs          D1–D11 + small rules, ~20 s                  ┐ in parallel
pr-self-review-reviewer × tasks (one skill or spec each)         ┘
verdict.mjs         record → candidates → pr-self-review-verifier × CRITICALs → verify → finalize
gate.mjs            opt-in pre-push / PreToolUse: PASS verdict for the pushed commit's tree?
```

## Files

| Path | Role |
| --- | --- |
| `SKILL.md` | the orchestration the agent follows |
| `routing.json` | skill → files (globs, added-line triggers), suppress lists, budget, ignored skills |
| `references/severity.md` | the rubric and the hard-rule catalog (`rule_id`s) |
| `references/reviewer-brief.md` | task templates for the two agents, the finding JSON |
| `references/fix-policy.md` | what `--fix` may change |
| `scripts/lib.mjs` | git, store, JSON, globs, args |
| `scripts/collect-diff.mjs` | base, reviewed tree (fingerprint), files, hunks, commits |
| `scripts/select-skills.mjs` | routing, drift check, batching, budget, cache lookup, run files |
| `scripts/specs.mjs` | specs linked to the diff; "Unchanged" zones |
| `scripts/checks.mjs` | D1–D11, small rules; `--ci` for the workflow |
| `scripts/citations.mjs` | D9 stale `path:line`; `--fix` rewrites them |
| `scripts/verdict.mjs` | record, candidates, verify, metrics, finalize, waive, show |
| `scripts/gate.mjs` | the push gate (pre-push, Claude hook, `--check`) |
| `scripts/install-hooks.mjs` | installs the pre-push shim + a copy of the gate |
| `scripts/claude-hook.sh` | Claude Code hook entry (`pre` / `post`), cheap pre-filter |
| `scripts/pr-description.mjs` | PR description + compare URL |
| `scripts/stats.mjs` | precision per rule, reviewer cost |
| `scripts/publish-status.mjs` | the verdict as a GitHub commit status |
| `scripts/devdigest-review.mts` | the product's engine as an extra reviewer (`--with-devdigest`) |
| `../../agents/pr-self-review-{reviewer,verifier}.md` | the two subagents (read-only tools) |
| `../../settings.json` | no hooks by default; the opt-in PreToolUse / PostToolUse block is in [The gate](#the-gate) |
| `../../../.github/workflows/pr-self-review.yml` | the deterministic checks as a CI check |

## Store: `<git-common-dir>/pr-self-review/`

Per clone, shared by all worktrees, never committed.

```text
runs/<tree12>-<base12>/  diff.json plan.json tasks/*.diff checks.json findings/*.json
                         verifications.json metrics.json
verdicts/<tree>.json     what the gate reads
latest-<branch>.json     pointer to the branch's newest verdict
cache/<key>.json         findings per (skill hash, path, old blob, new blob, status)
waivers-<branch>.json    user waivers, matched by (rule_id, file)
feedback.jsonl           fixed / waived / rejected_by_verifier / ignored, for --stats
<tree>.pr.md             the generated PR description
bin/                     the installed gate (copied scripts + routing.json + VERSION)
```

## Adding or changing a skill

A new folder in `.claude/skills/` stops every review (DRIFT) until `routing.json`
says what it reviews, or lists it under `ignored` with a reason. Add rules
(`include`, `exclude`, optional `trigger` regex on added lines), set `origin`
(`local` skills may raise CRITICAL for their hard rules; `third-party` only for a
bug or a vulnerability), and `suppress` for advice that contradicts the repo. If a
local skill gains a hard rule, add it to the catalog in `references/severity.md`.
Changing a skill's files changes its cache key, so its files are reviewed afresh.

A branch that edits this skill, its agents or `.claude/settings.json` is reviewed
with `routing.json` from the merge-base and needs the user's confirmation.

## Waivable or not

| Finding | Waivable | Why |
| --- | --- | --- |
| Model CRITICAL (confirmed) | yes, with the user's reason | models can be wrong |
| D2 do-not-touch, D3 migrations, D8 spec zones, `e2e/ai-chat-command` | yes | a deliberate change exists |
| D1 secrets, D4 contracts, D5 INSIGHTS, D6 arch, D7 build, invalid JSON | no | CI fails anyway, or a key has leaked |

## The gate

**Off by default since 1.2.0** (HW2 criterion 21: no hook on `git push`). Both halves
are opt-in: git's pre-push hook via `install-hooks.mjs` below, and Claude Code's hooks by
adding this block to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "sh \"$CLAUDE_PROJECT_DIR/.claude/skills/pr-self-review/scripts/claude-hook.sh\" pre", "timeout": 120 }] }],
    "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "sh \"$CLAUDE_PROJECT_DIR/.claude/skills/pr-self-review/scripts/claude-hook.sh\" post", "timeout": 60 }] }]
  }
}
```

`gate.mjs` judges the commit being pushed, never HEAD or the working copy. It
passes when the commit adds nothing over the merge-base; or a **full** PASS
verdict exists for its tree, reviewed against a base that is an ancestor of
today's merge-base; or no reviewer skill applies (docs only) and the cheap checks
pass. Secrets are scanned in every commit being pushed. The pre-push shim fails
closed when `node` is missing. With the Claude hook on, `--no-verify` and
`-c core.hooksPath` from Claude are refused; the user can still bypass by hand — the
GitHub check closes that. `node .claude/skills/pr-self-review/scripts/gate.mjs --check`
answers "would this push pass?" without any hook.

Install per clone: `node .claude/skills/pr-self-review/scripts/install-hooks.mjs`
(`--status`, `--uninstall`). Rerun it after changing the scripts; `--status` says
when the installed copy is outdated.

## GitHub merge block (one-time setup by the repo owner)

1. **CI check.** `.github/workflows/pr-self-review.yml` runs `checks.mjs --ci` on every
   PR to `main` — the deterministic half, which no one can skip locally.
2. **Status.** Create a fine-grained PAT for this repository only with
   *Commit statuses: Read and write*; export it as `PR_SELF_REVIEW_GITHUB_TOKEN` in the
   shell that runs Claude Code. After a push, run `/pr-self-review --publish` to publish
   `devdigest/pr-self-review` (the gate's decision for the pushed commit); with the
   opt-in PostToolUse hook on, a push from Claude publishes it by itself. Don't reuse the app's
   `GITHUB_TOKEN` — it is read-only by design.
3. **Ruleset.** Settings → Rules → Rulesets → New branch ruleset → target `main` →
   *Require status checks to pass* → add `deterministic checks` (the workflow job) and
   `devdigest/pr-self-review`. Without a reported status GitHub shows "Expected —
   Waiting for status", and Merge stays disabled.

The status is self-reported: it keeps an honest team honest, it doesn't stop a
determined one. An independent CI reviewer is lesson L06's agent-runner.

## Tests

```sh
node --test '.claude/skills/pr-self-review/scripts/test/*.test.mjs'
```

Node 22's `--test` needs the glob (a directory argument fails). Each test builds
throwaway repos with a bare `origin` and an isolated git config. They cover the
NUL-byte file, rename-only files, the dirty-tree fingerprint, routing and drift,
budgets, every deterministic check, citation remapping, the verdict pipeline
(grounding, caps, verification, waivers, cache), the gate (amend, quick verdicts,
docs-only, a secret in an earlier commit) and a real `git push` through the
installed hook. Model behaviour is evaluated outside the repo: eval executors
grep the repo and would read the expected answers.

## Decisions worth knowing

- **User-invoked only (1.1.0).** `disable-model-invocation: true` keeps Claude from starting
  the review on its own; the user runs `/pr-self-review`. The gate's refusal therefore tells
  Claude to ask the user, not to run the skill.
- **No hook on `git push` (1.2.0).** HW2 criterion 21 asks for no automatic call on push,
  so `.claude/settings.json` has no hooks and the pre-push shim is uninstalled; the gate
  scripts stay for anyone who opts in ([The gate](#the-gate)). The CI check still runs on
  every PR.
- **Cache key = blob pair, not `git patch-id`.** patch-id ignores line numbers, so a
  rebase that moves a hunk would reuse findings with stale lines; the old and new blob
  ids of a file identify its diff exactly.
- **`git cat-file blob`, not `git show <tree>:<path>`.** For a missing path with glob
  characters (`[number]/x.ts`) `git show` falls back to a pathspec and prints HEAD.
- **Diffs use `git diff -a`.** `server/src/adapters/depgraph/index.ts` has a NUL byte;
  without `-a` it has no hunks and no reviewer would see it.
- **D8 binds only an active spec** (the diff edits it or names its slug in the branch or
  a commit). A finished spec that merely names a file a later refactor touches doesn't
  freeze that file; its candidates are grouped per Unchanged item, and the verifier
  reads the Amendments.
- **D6 ratchets** compare with the base version only when the file exists there; a
  ratchet the branch introduces can't have been loosened.
- **Rename-only files** have no `+` lines, so a placement finding about one grounds at
  line 1 — the one file-level exception for model output.
- **Package scripts run without the package manager.** `checks.mjs` runs a script's command
  from `package.json` with `node_modules/.bin` on PATH. Through `pnpm <script>`, pnpm 12 first
  verifies dependencies and, when it thinks they are stale, installs — which failed with
  `ERR_PNPM_IGNORED_BUILDS`, left a `pnpm-workspace.yaml` stub and rewrote node_modules state;
  `npm_config_verify_deps_before_run=false` did not stop it. A review must not change the tree
  it reviews (finalize refuses when the fingerprint moved — that is how this was caught).
- **Several lenses, one problem.** Findings with the same `rule_id`, file and overlapping lines
  merge into one (a local skill's wins), listing the others in `also_from`; it is verified and
  waived once.
- **`devdigest-review.mts`**, not `.ts`: tsx treats a `.ts` file outside a
  `"type": "module"` package as CommonJS, which has no top-level await.
