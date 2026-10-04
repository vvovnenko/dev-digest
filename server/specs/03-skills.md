# Skills Lab

**Status:** in progress

## Problem

An agent carries every rule it reviews by in one system prompt, so a rule two agents
share is copied into both and drifts. The engine already has a `skills` prompt slot
(`../../reviewer-core/src/prompt.ts:183`), and the starter schema already has `skills`,
`skill_versions` and `agent_skills`, but nothing writes them and no run passes a skill.

Goal (lesson L02): **skills** are reusable markdown instruction blocks that the user
creates, edits, versions and imports in the UI. Each agent links skills in an order,
switches each link on or off, and every enabled skill reaches the agent's prompt as its
own block, in that order. A skill is **text only**: it can't call a tool or run a
script, and an imported archive's scripts are never unpacked or executed. The run trace
shows each skill's block and the tokens it added. A new built-in agent, **Test Quality
Reviewer**, ships with three linked skills; a fourth is imported by hand to walk the
import path.

Trust: a skill is an instruction in the agent's prompt, not data — the engine does not
wrap it in `<untrusted>`. The file import shows the whole text and the skipped files and
saves only on confirm; the URL import saves at once. Every skill passes the injection
gate: one that matches injection patterns is blocked ([05](05-skill-url-import.md)).

## Scope

- **Server, new module** `src/modules/skills/` (onion layout): `domain.ts` (name rules,
  version notes, `applySkillPatch`, the import decisions: `classifyEntries`,
  `splitFrontmatter`, `findHiddenChars`, `buildImportDraft`), `import-parser.ts`
  (fflate + yaml, in memory), `ports.ts`, `service.ts`, `repository.ts`, `helpers.ts`,
  `routes.ts`, `constants.ts`. Registered in `src/modules/index.ts:34`; the container
  getter is `src/platform/container.ts:139-141`.
- **Server, changed:** `src/modules/agents/**` — skill links carry a per-agent `enabled`
  flag, `skill_count` on every agent, `enabledSkills(ws, agentId)`
  (`src/modules/agents/repository.ts:222-244`); `src/modules/reviews/**` — the run loads
  the enabled skills and passes them to the engine
  (`src/modules/reviews/run-executor.ts:166-176,219-220`); `src/db/pg-errors.ts`
  (`isUniqueViolation`, moved out of `run.repo.ts`); `ConflictError` (409,
  `src/platform/errors.ts:32-36`).
- **Tables:** migration `src/db/migrations/0015_skills_lab.sql` — `agent_skills.enabled`
  (default true) + an index on `agent_skills.skill_id`; `skill_versions.name`,
  `.description`, `.type`, `.note`; unique `skills(workspace_id, name)`. No DROP.
  `skills.source` gains `'imported'` (a TS-only enum, no SQL).
- **Seed** (`src/db/seed.ts`, `src/db/seed-skills.ts`, `src/db/seed-prompts.ts`): the
  Test Quality Reviewer (`seed.ts:273-284`), three skills with v1 snapshots
  (`seed.ts:299-337`) linked to it only in the run that creates the agent
  (`seed.ts:339-354`), and demo PR #483 "Add partial refunds" with stored patches and no
  review (`seed.ts:189-235`). Canonical copies: `../../docs/agent-skills/*.md`,
  `../../docs/agent-prompts/test-quality-reviewer.md`.
- **Engine** (`../../reviewer-core/src/prompt.ts`): `PromptSkill`, `renderSkill`,
  `skillBlocks`, `estimateTokens`; `skill_blocks` in the trace assembly.
- **Contracts:** `src/vendor/shared/contracts/knowledge.ts` and `trace.ts`, mirrored
  byte-for-byte in `../../client/src/vendor/shared/`.
- **Client** (see [`client/specs/03-skills.md`](../../client/specs/03-skills.md)):

  | Where | What |
  | ----- | ---- |
  | Sidebar | new **SKILLS LAB** section: Skills (`g s`), then Agents (moved out of WORKSPACE) — an approved edit of a vendored file (HW2 adds Conventions there too), `client/src/vendor/ui/nav.ts:28-35` |
  | `/skills` | grid of skill cards: name, type badge, source, description, global enabled toggle, "N agents", delete; search; **Add Skill ▾** → Create from scratch / Import file… |
  | `/skills/:id` | card list on the left; tabs **Config · Preview · Versions** (Stats hidden until HW8), `?tab=`, default `preview` |
  | `/agents/:id?tab=skills` | every workspace skill in the agent's order: drag handle, checkbox (enabled for this agent), type badge; "N of M enabled"; filter |
  | Agent cards | "N skills" badge (`skill_count`) |
  | Run trace → Prompt assembly | "Skills (dynamic) · N skills · +T tokens", then one block per skill: `name · vN`, "+N tokens" |

- **Claude Code:** `.claude/skills/pr-self-review` 1.2.0 is user-invoked only
  (`disable-model-invocation: true`) and no hook on `git push` runs or enforces it; the
  user runs `/pr-self-review`.

**Unchanged (no diff at all):**
- `server/src/modules/pulls/**`, `server/src/modules/polling/**`, `server/src/modules/repos/**`,
  `server/src/modules/repo-intel/**`, `server/src/modules/settings/**`, `server/src/modules/workspace/**`;
- `server/src/adapters/**` (the fake LLM included), `server/src/app.ts`, `server/src/db/schema.ts`;
- `reviewer-core/src/grounding.ts`, `reviewer-core/src/output/**`, `reviewer-core/src/llm/**`,
  `reviewer-core/src/review/reduce.ts`;
- `client/src/app/(shell)/agents/[id]/_components/AgentEditor/_components/ConfigTab/**`,
  `client/src/app/(shell)/agents/_components/AgentCard/**`,
  `client/src/app/(shell)/agents/_components/AgentsListView/_components/CreateAgentModal/**`;
- `client/src/app/(shell)/repos/[repoId]/pulls/_components/**` (the PR list);
- on the PR page: `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsTab/**`,
  `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/**`,
  `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsPanel/**`,
  `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/**`,
  `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunHistory/**`;
- `client/src/vendor/ui/shell/**`, `client/src/vendor/ui/kit/**`, `client/src/vendor/ui/primitives/**`,
  `client/src/lib/api.ts`, `client/src/components/app-shell/helpers.ts`,
  `client/src/components/app-shell/hooks/useGlobalShortcuts.ts`;
- `e2e/run.ts`, `.github/**`.

**Out of scope, though in the mockups:** the skill editor's Context tab (project docs)
and Evals tab, "Run on evals", pull % / accept % on cards and in Stats, the
findings-by-category donut, syntax highlighting in the body editor, community import (URL
import: [05](05-skill-url-import.md)), the conventions extractor, and an **API Contract**
agent with its control experiment (the user's decision, 2026-10-03: one new agent only).

## API / Data

**Contracts** (`src/vendor/shared/contracts/knowledge.ts`, `trace.ts`)

| Contract | Shape |
| -------- | ----- |
| `SkillName` (`knowledge.ts:124`) | kebab-case slug, 1–64 chars, unique per workspace |
| `Skill` (`knowledge.ts:137`) | `id, name, description, type, source, body, enabled, version, evidence_files?`, `agent_count?` (agents with it linked **and** enabled), `injection_detected` (computed on read, [05](05-skill-url-import.md)) |
| `SkillCreate` (`knowledge.ts:159`) | `name, description?, type? (default custom), body (non-blank, ≤ 40,000), enabled?, source?: manual \| imported, imported_from?` |
| `SkillUpdate` (`knowledge.ts:175`) | any subset of `name, description, type, body, enabled` |
| `SkillVersion` (`knowledge.ts:185`) | `skill_id, version, name, description, type, body, note, created_at` |
| `SkillAgentUse` (`knowledge.ts:199`) | `agent_id, agent_name, agent_enabled, order` |
| `SkillImportRequest` (`knowledge.ts:211`) | `filename, content_base64` (≤ 699,052 chars ⇒ ≤ 512 KiB raw, inside the 1 MiB body limit) |
| `SkillImportPreview` (`knowledge.ts:245`) | `draft {name, description, type, body}, source_file, skipped [{path, reason}], warnings [{code, detail?}], name_taken` |
| `Agent.skill_count` (`knowledge.ts:443`) | enabled links |
| `AgentSkillLink` (`knowledge.ts:466`) | `agent_id, skill_id, order, enabled` |
| `AgentSkillsUpdate` (`knowledge.ts:487`) | `links: [{skill_id, enabled}]` (array order = prompt order) \| `skill_ids` (all enabled) \| `skill_id` + `order?`; duplicates in `links` are a 422 |
| `AgentVersionConfig` (`knowledge.ts:510`) | `skills` = ids of the **enabled** links in order; `skill_links` (optional) = every link with its flag |
| `PromptSkillBlock` (`trace.ts:43`) | `id, name, version?, tokens, text?`; `PromptAssembly.skill_blocks` (`trace.ts:57`), nullish so older traces parse |

**Routes** — new, `src/modules/skills/routes.ts`

| Method | Path | Body → reply | Errors |
| ------ | ---- | ------------ | ------ |
| GET | `/skills` | → `Skill[]` by name, with `agent_count` | — |
| POST | `/skills` | `SkillCreate` → **201** `Skill` at v1, snapshot note "Created" or "Imported from &lt;file&gt;" | 409 `conflict` (name, `details.field = 'name'`) · 422 |
| GET | `/skills/:id` | → `Skill` | 404 |
| PUT | `/skills/:id` | `SkillUpdate` → `Skill`. A change to name / description / type / body bumps `version` and snapshots it ("Edited body, description"); `enabled` alone writes no version | 404 · 409 · 422 |
| DELETE | `/skills/:id` | → `{ ok: true }`; its links and versions cascade | 404 |
| GET | `/skills/:id/versions?limit&offset` | → `SkillVersion[]`, newest first (page 100) | 404 |
| POST | `/skills/:id/versions/:version/restore` | → `Skill`: a **new** version with vN's content, note "Restored vN"; restoring the current content changes nothing | 404 · 409 |
| GET | `/skills/:id/agents` | → `SkillAgentUse[]` (links that are enabled) | 404 |
| POST | `/skills/import/preview` | `SkillImportRequest` → `SkillImportPreview`; **writes nothing**; rate limit 20/min | 422 · 429 |

Every repository query is scoped by `workspace_id`; another workspace's skill is a 404 on
every route. A duplicate name surfaces as a unique violation on `skills_ws_name_uq`,
which `isUniqueViolation` finds through Drizzle's `cause` chain (`src/db/pg-errors.ts:8-15`).

**Routes** — changed, `src/modules/agents/routes.ts`

| Method | Path | Change |
| ------ | ---- | ------ |
| GET | `/agents`, `/agents/:id` | `skill_count` |
| GET | `/agents/:id/skills` | `AgentSkillLink[]` with `enabled` (`routes.ts:119-128`) |
| POST | `/agents/:id/skills` | body `AgentSkillsUpdate` (`routes.ts:130-145`). Any change to the list — set, order or a flag — bumps the agent's version and snapshots `skills` + `skill_links` in one transaction (`repository.ts:144-160,267-298`); the same list again writes nothing. A skill outside the workspace is a 404 |

`POST /pulls/:id/review` is unchanged: a run reads the agent's skills when it executes.

**Import** (`src/modules/skills/import-parser.ts`, `domain.ts`). A `.md` (optional YAML
frontmatter `name`, `description`, `type`) or a `.zip` skill folder; nothing is written to
disk or executed.
- Caps (`constants.ts:4-19`): upload 512 KiB; ≤ 100 archive entries; ≤ 2 MiB declared
  uncompressed in total; the core markdown ≤ 256 KiB; frontmatter ≤ 8 KiB; ≤ 10 YAML aliases.
- Two passes over a zip (`import-parser.ts:69-112`): the first lists names and declared
  sizes and inflates nothing; the second inflates only the core file, into a buffer of its
  declared size.
- The core is the shallowest `SKILL.md`, else the only markdown file
  (`domain.ts:200-245`); several at one level, or none, is a 422.
- Every other entry is listed in `skipped` with a reason: `script` (under `scripts/` or a
  script / binary extension), `not_markdown`, `extra_markdown`, `os_metadata`,
  `unsafe_path` (absolute or `..`). `too_large` is reserved.
- Warnings: `unknown_frontmatter_key` (e.g. `allowed-tools`, ignored — skills can't use
  tools), `invalid_frontmatter`, `invalid_type` (→ `custom`), `missing_description`,
  `name_derived` (no frontmatter name → folder, file, then upload name, slugified),
  `hidden_characters` (zero-width, bidi or tag characters, with their lines),
  `large_body` (> 4000 tokens), `skipped_file_referenced` (the body names a skipped file).
- Refusals are a 422 with `details.reason`: `empty_file`, `too_large`, `not_zip`,
  `unsupported_type`, `too_many_entries`, `corrupt_archive`, `not_text`, `no_skill`,
  `ambiguous_skill`, `empty_body`, `body_too_long`.

**Prompt.** The engine renders each enabled skill (`renderSkill`,
`../../reviewer-core/src/prompt.ts:82-86`) as

```
### <name>
When to apply: <description, whitespace collapsed>     ← omitted when blank

<body, trimmed>
```

and joins them, in the agent's order, under `## Skills / rules` in the user message,
after the PR description and before memory and the repo skeleton, unwrapped
(`prompt.ts:157-159,183`). No enabled skill ⇒ no section, and the prompt is byte-identical
to a run without skills. The description is the skill's interface — the UI asks for it
phrased as a directive ("Apply when …").

**Run.** After resolving the provider, the run executes a `Loading skills` step:
enabled links of enabled skills, in link order (`run-executor.ts:166-176`). It logs
`skills: N attached (+T tokens)` (also for 0), with each skill's name, version and tokens
in the event data, and passes `skills` only when there is one (`run-executor.ts:219-220`).
A DB failure here fails the run. Tokens are an estimate, `ceil(chars / 4)`
(`prompt.ts:66-69`); in map-reduce every per-file call carries the whole block.

**Trace.** `prompt_assembly.skills` is the joined block; `prompt_assembly.skill_blocks`
holds each skill's `id`, `name`, `version`, `tokens` and rendered `text`. A run that fails
after loading its skills keeps both in its trace (`run-executor.ts:335,462-469`). A
disabled skill — off globally or off for the agent — appears in neither, nor in the log; a skill
blocked by the injection gate appears in neither and is counted in `skills: N blocked …` ([05](05-skill-url-import.md)).

## Acceptance criteria

1. `.claude/skills/pr-self-review/SKILL.md` has `disable-model-invocation: true`; Claude
   can't start it, and running `/pr-self-review` by hand on this branch routes changed files
   to both the `ui` skills (client) and the `backend` skills (server, reviewer-core).
2. A skill is created (Add Skill ▾ → Create from scratch) and edited on its Config tab;
   each content save adds a version with a note; Versions shows Diff and Restore, and a
   restore adds a version instead of rewriting one.
3. The Test Quality Reviewer is seeded with `branch-coverage`, `edge-case-checklist` and
   `mocking-discipline` linked and enabled; a reseed creates nothing twice and never relinks
   a skill the user unlinked.
4. An enabled skill shows as its own block in the run trace's Prompt assembly with
   "+N tokens", and the run log says `skills: N attached (+T tokens)`; a skill switched off
   (on its card or on the agent's Skills tab) is in neither.
5. Import: Add Skill ▾ → Import file… with `docs/agent-skills/flaky-test-patterns` zipped
   shows the draft, the trust warning, `scripts/find-sleeps.sh` as skipped (`script`) and
   `allowed-tools` as ignored; nothing is saved until Save skill, and nothing from the
   archive is written or run.
6. Control experiment on PR #483 (needs `OPENROUTER_API_KEY`; two paid runs):
   1. Agents → Test Quality Reviewer → Skills tab → untick every skill.
   2. PR #483 → Run Review ▾ → **Test Quality Reviewer** (one agent only) → open the run's
      trace: no Skills block; the log says `skills: 0 attached (+0 tokens)`.
   3. Tick the skills again → Run Review ▾ → Test Quality Reviewer → the trace shows
      "Skills (dynamic) · 3 skills · +T tokens" and one block per skill; compare the
      findings (expected: the uncovered branches and boundary cases in `src/refunds.ts`
      are flagged only with skills — model output varies run to run).
7. Tests:
   - engine: `../../reviewer-core/test/prompt.test.ts:114` (format, order, unwrapped,
     tokens, no-skill prompt unchanged), `../../reviewer-core/test/run.test.ts:138`;
   - server, unit: `test/skills-domain.test.ts`, `test/skills-import-parser.test.ts`,
     `test/skills-service.test.ts`, `test/agents-domain.test.ts`, `test/seed-docs-sync.test.ts`;
   - server, DB: `test/skills.it.test.ts` (CRUD, 409, versions, restore, tenant 404s,
     cascade, preview writes nothing), `test/agents-versions.it.test.ts:262-349`,
     `test/reviews.it.test.ts:402-459`, `test/integration.it.test.ts:77-165`,
     `test/api-contracts.it.test.ts`;
   - client: the `/skills` components' tests, `SkillsTab.test.tsx`,
     `RunTraceDrawer.test.tsx`; e2e flow `08-skills-lab` (read-only).

## Open questions

- Deleting a skill that agents use cascades its links away without bumping those agents'
  versions; the confirm dialog names the agent count. Refuse with 409 instead?
- An agent's version snapshot pins skill ids, not skill versions, so replaying an old
  agent version uses today's skill text. Record `{skill_id, version}` in the snapshot?
- A queued run reads skills when it executes, not when it is requested, so an edit made
  while it waits reaches it.
