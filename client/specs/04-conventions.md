# Conventions Extractor

**Status:** in progress

The feature spans the API and the UI, so its single spec lives in
[`server/specs/04-conventions.md`](../../server/specs/04-conventions.md). The route's
contract is in [`pages.md`](./pages.md#reposrepoidconventions).

UI summary (design: two screenshots, "Conventions" and "Create skill (merged from
accepted)"; where they disagree with the HW2 criteria, the criteria win):

- **Sidebar.** SKILLS LAB → **Conventions**, after Agents. Its href is
  `/repos/:repoId/conventions`. This is the second approved edit of the vendored
  `src/vendor/ui/nav.ts`.
- **Page** `/repos/:repoId/conventions`:
  - "Conventions in <repo>" and "Detected from N sample files · last scan …".
  - A scan runs in the background: the button creates it (or finds the active one)
    and the page polls every 2 s while it is queued or running. A status line says
    "Scan queued…", "Scanning… started …" or "Last scan failed: …", and the state
    survives a reload or a second tab.
  - **Run scan** in the empty state; **Re-scan** in the header once a scan exists.
    These are two separate buttons (criterion 45).
  - **Deselect all**, "N of M accepted", and **Create skill**, shown only when at
    least one candidate is accepted (criterion 50).
- **Candidate card:**
  - The rule, `path:start-end` with a copy-snippet button, the real snippet, and a
    Confidence bar with % (green ≥ 85, amber ≥ 65, red below).
  - **Accept** ⇄ **Accepted**, **Reject** and **Edit**. The design has no Edit; the
    criteria (47, 49) require it. Edit is an inline input: Enter or Save sends it,
    Escape or Cancel restores the rule.
  - A rejected card leaves the list and doesn't come back after a reload or a
    re-scan (criterion 48).
- **Create skill modal** (criteria 41, 51):
  - A banner, "Merged from N accepted conventions in <repo>. Everything below is
    editable before you save."
  - Fields: **Name\*** (default `<repo-name>-conventions`), **Description**,
    **Type** (default `convention`), **Enabled** with its hint, and **Skill body\***
    in the shared line-numbered editor with "unsaved" and "{n} tokens".
  - Footer: "Saved as v1 · added to Skills Lab", **Cancel**, **Create skill**.
  - On success it opens `/skills/:id?tab=preview`, and `/skills` lists the new skill
    (criterion 52). Link it to an agent on that agent's Skills tab.
- **Settings → Models → Conventions** already exists: a searchable OpenRouter model
  picker. The default is now `deepseek/deepseek-v4-flash` (`src/lib/feature-models.ts`),
  and the scan uses the picked model (criterion 53).

**Shared code this feature promoted** (a second route now uses it):
- `LineNumberedEditor` moved from the skill ConfigTab to `src/components/line-numbered-editor/`.
- The skill name rules, `SKILL_TYPES`, `renderSkillBlock` and `estimateTokens` moved
  from `src/app/(shell)/skills/{constants,helpers}.ts` to `src/lib/skills.ts`. Their
  golden test is now `src/lib/skills.test.ts`.
- The skills route files changed only their import lines.

**Hooks:** `src/lib/hooks/conventions.ts` (`conventionKeys` in `src/lib/hooks/keys.ts`). See
the table in [`../docs/ui-architecture.md`](../docs/ui-architecture.md).

**Out of scope:**
- category labels on cards;
- syntax highlighting in the body editor;
- choosing an agent in the modal;
- an e2e flow (the fake LLM answers only the Review schema, and the seeded repo has no clone).
