# Agent skills

A **skill** is a reusable block of review instructions written in markdown. You attach
it to any number of reviewer agents in **Skills Lab → Agents → Skills**. A skill is
text and nothing else: DevDigest never runs a tool, a script or a command for it.
Its only effect is the text it adds to the agent's prompt.

These files are the human-readable originals of the skills the seed creates, plus one
skill folder for practising the import flow. The DB is the source of truth at run
time: editing a file here changes nothing in an existing workspace, and editing a
skill in the UI does not change these files.

| File | Type | Seeded | Linked to |
| ---- | ---- | ------ | --------- |
| [`branch-coverage.md`](branch-coverage.md) | rubric | yes | Test Quality Reviewer |
| [`edge-case-checklist.md`](edge-case-checklist.md) | rubric | yes | Test Quality Reviewer |
| [`mocking-discipline.md`](mocking-discipline.md) | convention | yes | Test Quality Reviewer |
| [`api-breaking-change.md`](api-breaking-change.md) | rubric | yes | API Contract Reviewer |
| [`api-response-schema.md`](api-response-schema.md) | rubric | yes | API Contract Reviewer |
| [`api-semver-discipline.md`](api-semver-discipline.md) | convention | yes | API Contract Reviewer |
| [`api-deprecation-policy.md`](api-deprecation-policy.md) | convention | yes | API Contract Reviewer |
| [`flaky-test-patterns/`](flaky-test-patterns/SKILL.md) | custom | no — import it | — |

## File format

```markdown
---
name: branch-coverage          # kebab-case, unique per workspace
description: Apply when …      # the skill's interface — phrase it as a directive
type: rubric                   # rubric | convention | security | custom
---
<markdown body: the rules>
```

Only `name`, `description` and `type` are read. Any other frontmatter key, such as
`allowed-tools` or `license`, is ignored and shown as a warning in the import preview.

## How a skill reaches the model

The run executor loads the agent's enabled links of enabled skills, in the agent's
order. It renders each skill as its own block in the user message, under
`## Skills / rules`:

```markdown
### branch-coverage
When to apply: Apply when the diff adds or changes production code that branches …

<body>
```

The description becomes the `When to apply:` line, which is why it should read as an
instruction. The run trace shows one block per skill with its estimated token count
(`ceil(chars / 4)`), and the live log prints `skills: N attached (+T tokens)`. A
disabled skill or link sends nothing.

## Keeping the seed in sync

`server/src/db/seed-skills.ts` holds the seven seeded skills as constants.
`server/test/seed-docs-sync.test.ts` fails when a constant differs from its file
here, so edit both together. The seed creates a skill only when no skill with that
name exists in the workspace. It links three skills to the Test Quality Reviewer and
four to the API Contract Reviewer, each set only in the seed run that creates that
agent, so a reseed never relinks a skill you removed.

## Practising an import: `flaky-test-patterns`

The folder has the shape of a skill shared outside DevDigest: a `SKILL.md` plus a
`scripts/` helper. To import it:

```sh
cd docs/agent-skills && zip -r "${TMPDIR:-/tmp}/flaky-test-patterns.zip" flaky-test-patterns
```

Then go to **Skills → Add Skill → Import file…** and choose the zip. The preview
shows:

- the draft built from `SKILL.md`, ready to edit before saving;
- `scripts/find-sleeps.sh`, skipped as a script — it is never written to disk or
  executed;
- warnings for the ignored `license` and `allowed-tools` keys, and for the body
  referring to a skipped file.

Nothing is saved until you confirm.

**Trust:** an imported skill is someone else's instructions inside your agent's
prompt. Read the whole body before saving, just as you would review a pull request.

A skill can also be imported from a raw `https://` URL (**Skills → Add Skill → Import from
URL**): the server fetches the file and saves it at once, with no preview, so read it on its
page afterwards. Every skill is checked for prompt-injection patterns: one that matches is
saved but blocked (it can't be enabled, and runs leave it out) until an edit makes it clean.
