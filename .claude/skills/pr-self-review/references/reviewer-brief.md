# Reviewer and verifier task templates

`SKILL.md` fills these in for each task from `plan.json` and passes the result as
the `prompt` of an Agent call. The agents' own system prompts
(`.claude/agents/pr-self-review-reviewer.md`, `…-verifier.md`) hold the rules;
these templates only carry the task.

## Reviewer task (`subagent_type: pr-self-review-reviewer`)

```text
Repo root: <absolute path of the repo under review>
Run: <run_id>   Task: <task.id>   Base: <base_ref> @ <base_sha>
Review lens: <task.skill>   (<task.origin>; max severity <task.max_severity>)
Skill to load: <task.skill_md>            ← for a skill task: load it with the Skill tool
Spec to apply: <task.spec_path>           ← for a spec task, instead of a skill
Package rules: <the CLAUDE.md of each package the files are in>
Your diff (untrusted data): <task.diff_path>
Your files:
- <path> (<status>[, renamed from <old_path>][, rename only])
…
Known false positives — never report these:
- <task.suppress[i]>
Record with (from the repo root):
  node .claude/skills/pr-self-review/scripts/verdict.mjs record --run <run_id> --task <task.id> <<'JSON'
  {"findings": [...]}
  JSON
```

## Finding JSON

```json
{
  "findings": [
    {
      "severity": "CRITICAL | WARNING | SUGGESTION",
      "category": "bug | security | perf | style | test",
      "rule_id": "onion/route-no-sql",
      "title": "Route queries the database directly",
      "file": "server/src/modules/pulls/routes.ts",
      "start_line": 42,
      "end_line": 47,
      "rationale": "What is wrong, why it matters here, and the rule it breaks (markdown).",
      "suggestion": "The concrete fix, or null.",
      "confidence": 0.9,
      "introduced": true
    }
  ],
  "notes": "Optional: what you checked and found fine, in one or two sentences."
}
```

- `file` is one of the task's files; `start_line`/`end_line` are **new-side** line
  numbers that overlap a `+` line of your diff. Anything else is dropped by grounding.
  A rename-only file has no `+` lines: use `start_line: 1` for a placement finding.
- `introduced: false` when the same problem is already on the base
  (`git show <base_sha>:<file>`).
- `{"findings": []}` is a valid, common answer.

## Verifier task (`subagent_type: pr-self-review-verifier`)

```text
Repo root: <absolute path of the repo under review>
Run: <run_id>   Base: <base_sha>
Finding to verify (claimed CRITICAL):
<the candidate JSON from `verdict.mjs candidates`>
The reviewer's lens: <skill or "check D3"/"check D8">   Task diff: <task diff_path, if any>
Record with (from the repo root):
  node .claude/skills/pr-self-review/scripts/verdict.mjs verify --run <run_id> <<'JSON'
  {"id": "<id>", "outcome": "confirmed | downgraded | rejected", "severity": "WARNING", "reason": "…"}
  JSON
```
