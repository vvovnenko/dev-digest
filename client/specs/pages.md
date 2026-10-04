# Pages — contract

**Status:** contract — describes shipped behaviour that must stay true. Change the code and this file in the same commit.

This contract covers every route under `src/app/`: what it renders, which hooks and endpoints feed it,
its URL params, and the visible copy the e2e flows depend on. The route ↔ endpoint diagram is in
[`../README.md`](../README.md#ui-route-map); the data layer is in
[`../docs/ui-architecture.md`](../docs/ui-architecture.md). Folded in:
[`01-run-cost-badge.md`](./01-run-cost-badge.md), [`02-findings-by-severity.md`](./02-findings-by-severity.md),
[`03-skills.md`](./03-skills.md).
The flows are described in [`../../e2e/specs/flows.md`](../../e2e/specs/flows.md). Paths are relative to
`client/`; `PR/` = `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/`. There are nine routes and no
others: no `/showcase` (the gallery renders only in `src/test/smoke.test.tsx:4`), no `/settings` or
`/repos/:repoId` index — an unknown URL renders `src/app/not-found.tsx:9-23` ("Page not found", "Go to DevDigest").

Every route except `/onboarding` lives in the `src/app/(shell)/` route group: its layout mounts `AppShell` once
(`src/app/(shell)/layout.tsx:7-9`) and each page sets its breadcrumb with `useShellCrumb`. Every `page.tsx` is a
thin server file: `generateMetadata` sets the tab title from `messages/en/shell.json:46-58` (template
"<page> · DevDigest", `src/app/layout.tsx:13-17`) and the page renders one client view. A page that throws while
rendering shows `src/app/(shell)/error.tsx:10-16` inside the shell. The sidebar comes from the vendored `NAV`
(`src/vendor/ui/nav.ts:21-35`): WORKSPACE → Pull Requests; SKILLS LAB → Skills (`g s`), Agents (`g a`); Settings
at the bottom.

## Routes

### `/`
- `HomeView` (`src/app/(shell)/page.tsx:11-13`): "Welcome to DevDigest" (`HomeView.tsx:26`, `shell.json:61`);
  `useRepos` → `GET /repos` (`src/lib/hooks/core.ts:69-74`).
- ≥ 1 repo: `router.replace` to `/repos/<repos[0].id>/pulls` — the API's first repo, not the stored active
  repo (`HomeView.tsx:19-23`); meanwhile an "Open <full_name>" button (`:42-46`). Loading → skeletons
  (`:27-32`). Zero repos **or a failed fetch** → EmptyState "No repositories yet", CTA "Add repository" → `/onboarding` (`:33-40`).

### `/onboarding`
- Full-screen `AddRepoView`, outside the shell (`src/app/onboarding/page.tsx:12-14`): "Add a repository", field
  "Repository URL" (`AddRepoView.tsx:58,76`, `shell.json:79,81`).
- Button or Enter (`AddRepoView.tsx:82-84,100-108`) → `useAddRepo` → `POST /repos {url}`, invalidates
  `["repos"]` (`core.ts:76-82`); "Cloning…" while pending (`:107`). Success → `/repos/<id>/pulls`
  (`:37-38`); failure → inline error plus the global toast (`:39-41,88-93`). Esc, × and Cancel → `/`
  (`:22-31,55,96-98`).

### `/repos/:repoId/pulls`
- `PullsListView` (`pulls/page.tsx:12-14`). `usePulls` → `GET /repos/:id/pulls`, polled every 60 s here
  (`PullsListView.tsx:28`, `core.ts:112-120`); the GET only reads. On open, with a GitHub token
  configured, `useAutoSyncPulls` imports the PRs once per repo with `POST /repos/:id/poll`, silently
  (`PullsListView.tsx:32`, `core.ts:139-157`). Refresh → `useRefreshRepo` → `POST /repos/:id/refresh`
  and `useSyncPulls` → `POST /repos/:id/poll`, whose failure is toasted (`PullsListView.tsx:91-95`,
  `core.ts:84-93,122-137`).
- `?status=all|needs_review|reviewed|stale`, default `needs_review`, always written explicitly
  (`PullsListView.tsx:35,39-45`, `constants.ts:33-39,57`); merged/closed PRs appear only under `all`
  (`helpers.ts:36`). `?q=` searches title and number; the box filters as you type and writes `?q` after
  300 ms (`PullsListView.tsx:47-57`, `constants.ts:65`, `helpers.ts:33-38`). `?sort=newest|oldest`, default
  `newest`, dropped from the URL when default (`PullsListView.tsx:37,41`, `helpers.ts:41-49`).
- Header "Pull Requests" + "{open} open · {needsReview} need review" (`PullsListView.tsx:71-76`, `helpers.ts:52-57`). Columns
  (`constants.ts:42-51`, `messages/en/prReview.json:105-114`, uppercased by `styles.ts:106`, rendered by
  `PRRow.tsx:43-89`): PULL REQUEST (title, `#N`) · AUTHOR · SIZE (`S|M|L · lines`, cut at 100/400,
  `helpers.ts:13-17`) · SCORE (ring, `—` if never reviewed) · FINDINGS · STATUS · COST · UPDATED (`3h`, `2d`, `helpers.ts:20-30`).
- **COST** = total of **all the PR's `done` runs** (every agent, every re-run), `—` when none is known
  (`PRRow.tsx:85-88`; summed in SQL in `../server/src/modules/pulls/repository.ts:137-147`). SCORE and FINDINGS
  stay the **latest review** (`repository.ts:122-135`).
- **FINDINGS**: chips from `findings_by_severity`; `—` never reviewed, `0` none (`FindingsCell.tsx:17-19`).
  The first hover enables `usePrReviews` → `GET /pulls/:id/reviews` (`FindingsCell.tsx:14-15,30`). The
  popover header reads **"N FINDINGS IN THIS RUN"**: `severityCounts.header` (`prReview.json:130`),
  uppercased by `src/components/severity-counts/styles.ts:52` (`SeverityPopover.tsx:139-142`). A click
  inside it does not open the row (`SeverityPopover.tsx:137`).
- The title is a link to `/repos/:repoId/pulls/:number` (`PRRow.tsx:47-49`); a click anywhere else on the row
  goes there too (`:40`). States: unknown repo → `RepoNotFound`; skeletons; "Couldn’t load pull requests";
  "No pull requests" (`PullsListView.tsx:65,105-122`).

### `/repos/:repoId/pulls/:number`
- `PrDetailView` (`[number]/page.tsx:12-14`; tab title "PR #N", `:7-10`). `usePrDetail` turns `:number` into the
  PR's uuid via the cached `usePulls` list (a number the list lacks triggers one silent import,
  `useAutoSyncPulls`, when a GitHub token is set), then loads `usePullDetail` → `GET /pulls/:id`, `usePrReviews` and
  `usePrRuns` → `GET /pulls/:id/runs` (`[number]/usePrDetail.ts:12-32`). The live runs are the runs with
  status `running` (`[number]/helpers.ts:5-7`). `useDeleteRun` → `DELETE /runs/:id` and `useCancelRun` →
  `POST /runs/:id/cancel` sit in the Agent runs tab (`PR/FindingsTab/FindingsTab.tsx:45-46`).
- `?tab=overview|findings|diff`, default `overview`; any other value shows Overview
  (`PrDetailView.tsx:35`, `[number]/helpers.ts:15-17`, `[number]/constants.ts:25-27`). `?trace=<runId>` opens
  `RunTraceDrawer` over any tab (`PrDetailView.tsx:36,113-123`). Both go through `router.replace` (`:38-43`).
- States: `RepoNotFound` (`:56`); skeleton (`:58-66`); full-screen "Couldn't load this pull request",
  also when the number is not in the repo's PR list (`:68-77`).
- Header (`PR/PrDetailHeader/PrDetailHeader.tsx`): `#N` + title (`:35-40`), author, `branch → base`, `+a −d`,
  status with the list's colour and label (`:28,41-61`); "View on GitHub" (`:65-73`); Run Review ▾ (`:74`); a
  merged/closed banner (`:77-82`); tabs **Overview**, **Agent runs** (count = findings of all reviews,
  `PrDetailView.tsx:44,85`), **Files changed** (count = `files_count`) (`:83-97`, `prReview.json:175-179`).
- Run Review ▾ (`PR/RunReviewDropdown/RunReviewDropdown.tsx`): a merged warning on merged/closed PRs (`:58-63`);
  "Run all enabled agents" (`:64-69`); every agent, disabled ones hinted `· disabled` (`:46-52`), or "No agents
  yet — create one" (`:53`); "Configure agents…" → `/agents` (`:73`). A pick sends `POST /pulls/:id/review`
  (`src/lib/hooks/reviews.ts:125-135`, which refreshes the PR's runs and reviews) and switches to
  `tab=findings` (`PrDetailView.tsx:88`).
- Overview: only "Description", the PR body as plain text, nothing when empty (`PR/OverviewTab/OverviewTab.tsx:16-21`).
  Files changed: "Files changed · N files" + `DiffViewer` (`PR/DiffTab/DiffTab.tsx:58-60`); GitHub review
  comments via `GET`/`POST /pulls/:id/comments` (`reviews.ts:91-115`), hidden until "Show comments (N)"
  (`DiffTab.tsx:23,46-55`); posting only on open PRs (`PrDetailView.tsx:109`).

### `/agents`
- `AgentsListView` (`src/app/(shell)/agents/page.tsx:12-14`). `useAgents` → `GET /agents`; card
  toggle → `PUT /agents/:id` (`AgentsListView.tsx:20-21,92`); card delete → confirm modal (`ConfirmDeleteModal`) → `DELETE /agents/:id`
  (`AgentCard.tsx:30,60-71,86-94`). Search is local, over name and description (`helpers.ts:4-8`). Each card shows
  "N skills" from the agent's `skill_count`, its enabled skill links (`AgentsListView.tsx:90`, `AgentCard.tsx:78-82`).
- "Add Agent ▾": "Create from scratch" + five templates, all opening the same `CreateAgentModal`
  (`AgentsListView.tsx:46-64`, `constants.ts:4`) → `POST /agents` → `/agents/:id?tab=config`
  (`CreateAgentModal.tsx:17,25-40`); a card click (or its name, a button) opens the same URL
  (`AgentsListView.tsx:91`, `AgentCard.tsx:40-51`). States: skeletons, "Could not load agents.", "No agents yet"
  (`AgentsListView.tsx:67-83`).

### `/agents/:id`
- `AgentEditorView` (`agents/[id]/page.tsx:12-14`): agent list on the left (`useAgents`), editor for `useAgent` →
  `GET /agents/:id` (`AgentEditorView.tsx:25-27`). `?tab=` accepts `config` or `skills`, else falls back to
  `config` (`AgentEditorView/constants.ts:2-3`, `AgentEditorView.tsx:29-30`). The left cards show "N skills" too
  (`AgentEditorView.tsx:79`). Config stays mounted while Skills shows, so an unsaved draft survives a tab switch
  (`AgentEditor/AgentEditor.tsx:25-28`).
  `ConfigTab` saves only the fields the user changed, with `PUT /agents/:id` and a success toast; the others
  show the cached agent, so the list's enabled toggle is never undone. Switching provider clears the model
  and Save waits for a new one. Models come from `GET /providers/:p/models` (`ConfigTab.tsx:28,47-50,64-84`).
- Failed load or missing agent → full-screen "Couldn’t load this agent" (`AgentEditorView.tsx:43-52`). "Add ▾ →
  Create from scratch" goes to `/agents`, not the modal (`:69`); "Run on a PR…" goes to `/` (`:103-105`).
- **Skills tab** (`AgentEditor/_components/SkillsTab/SkillsTab.tsx`): every workspace skill in one list — the
  agent's links in their saved order, then the skills it never linked, by name and unchecked
  (`SkillsTab/helpers.ts:15-29`); `useSkills` → `GET /skills` and `useAgentSkills` → `GET /agents/:id/skills`.
  A row: drag handle, checkbox (enabled for this agent), mono name, type badge, "disabled globally" when the skill
  itself is off, Open → `/skills/:id`. Header: "{linked} of {total} enabled" (`agents.json:95`) and a filter;
  reordering is off while filtering. Drag and drop, or keyboard on the handle (Space lifts, ↑/↓ move, Space
  drops, Esc cancels). Every tick, drop or keyboard drop sends the whole ordered list once —
  `useSetAgentSkills` → `POST /agents/:id/skills {links}`, optimistic, one agent's saves in order
  (`src/lib/hooks/agents.ts:97-125`); nothing is sent on mount. Each save is a new agent version.

### `/skills`
- `SkillsListView` (`src/app/(shell)/skills/page.tsx:12-14`, title `shell.json:52`). `useSkills` →
  `GET /skills`; a grid of `SkillCard`s: mono name (a button, "Open {name}"), type badge, source, description,
  "{n} agents" (agents with it linked and enabled), a toggle → `PUT /skills/:id {enabled}`, delete → a confirm modal
  (`ConfirmDeleteModal`) that names the agent count → `DELETE /skills/:id` (`SkillCard.tsx:37-43,53-64,73-77,101,104-116`). Search is local
  (`SkillsListView.tsx:22`). A card opens `/skills/:id?tab=preview` (`SkillsListView.tsx:62`). Breadcrumb
  "Skills Lab › Skills". States: skeletons, "Could not load skills.", "No skills yet", "No skill matches …"
  (`SkillsListView.tsx:45-58`).
- **Add Skill ▾** (`_components/AddSkillMenu/AddSkillMenu.tsx:30-33`): "Create from scratch" opens
  `CreateSkillModal` (name, description, type, body → `POST /skills` → `/skills/:id?tab=preview`,
  `CreateSkillModal.tsx:37-49`); "Import file…" opens `ImportSkillDrawer`: a `.md` / `.markdown` / `.zip` up to
  512 KiB, checked before any request (`ImportSkillDrawer/constants.ts:2-5`), sent as base64 to
  `POST /skills/import/preview`, then a preview with a trust warning, editable name / description / type, the
  warnings, the skipped files with their reasons and the rendered block (images as labels); only **Save skill**
  writes, `POST /skills {source: 'imported', imported_from}` (`ImportSkillDrawer.tsx:47-94,140-148`). A taken
  name (409 or `name_taken`) marks the name field and blocks Save.

### `/skills/:id`
- `SkillEditorView` (`src/app/(shell)/skills/[id]/page.tsx:12-14`, title `shell.json:53`): skill cards on the
  left (`useSkills`) with Add Skill ▾, the editor for `useSkill` → `GET /skills/:id`; header: mono name, type
  badge, `vN`, "disabled" (`SkillEditorView.tsx:84-95`). `?tab=config|preview|versions`, default
  `preview`, through `router.replace` (`SkillEditorView/constants.ts:2-4`, `SkillEditorView.tsx:29-35`).
  Failed load or missing skill → full-screen "Could not load this skill" (`:43-52`).
- **Config** stays mounted while another tab shows (`SkillEditor/SkillEditor.tsx:25-27`): enabled, name,
  description with a directive hint (the "When to apply" line), type, and the body in a line-numbered editor
  headed `<name>.md`, "unsaved" and "{n} tokens" — `ceil(chars / 4)` of the rendered block
  (`ConfigTab/ConfigTab.tsx:34-40,101-110`). Save sends only the fields that differ, `PUT /skills/:id`; Cancel
  drops the draft (`:48-70,111-122`).
- **Preview**: "Rendered as the reviewing agent receives it." and the block `### name` / `When to apply:` /
  body, the same format as the engine (`src/app/(shell)/skills/helpers.ts:15-19`), with its tokens
  (`PreviewTab/PreviewTab.tsx:12-29`).
- **Versions**: `useSkillVersions` → `GET /skills/:id/versions`, newest first: `vN`, note, date, "Current" or
  **Diff** (a line diff against the current skill, in a modal) and **Restore** (confirm →
  `POST /skills/:id/versions/:version/restore`, a new version) (`VersionsTab/VersionsTab.tsx:23-27,43-78`).
- **Stats** is hidden until HW8: no tab, and `?tab=stats` falls back to Preview (`SkillEditor/constants.ts:10-19`).
  `StatsTab` ("Used by N agents", `useSkillAgents` → `GET /skills/:id/agents`, `StatsTab/StatsTab.tsx:15-45`) is
  kept for then.

### `/settings/:section`
- `SettingsView` (`src/app/(shell)/settings/[section]/page.tsx:12-14`). Sub-nav from vendored `SETTINGS_SECTIONS`:
  `api-keys` "API Keys", `models` "Feature Models" (`src/vendor/ui/nav.ts:45-48`, `SettingsView.tsx:28-35`).
- `api-keys`: four rows, OpenAI, Anthropic, OpenRouter, GitHub PAT (`SettingsApiKeys/constants.ts:11-16`),
  each with Configured / Not set from `GET /settings/secrets-status` and "Test connection" →
  `POST /settings/test-connection` (`SettingsApiKeys.tsx:39-50,83,93`).
- `models`: one picker per feature, each pick `PUT /settings`, options from
  `GET /providers/openrouter/models` (`SettingsModels.tsx:22-33,39`). Any other section → EmptyState
  titled with the **first** section's label ("API Keys") and `settings.fallbackBody` (`SettingsView.tsx:21,43-47`).

## PR detail — Agent runs tab

`PR/FindingsTab/FindingsTab.tsx`, top to bottom. Section titles and notes are `prReview.findingsTab.*`.

1. **Live review** while any of the PR's runs is `running` (`:63-88`; live ids from the run history,
   `[number]/usePrDetail.ts:30`): "Cancel" (all) and "Open run trace" (first) above `RunStatus`'s SSE log (`:86`).
   When the streams end, `useRunSettled` refreshes the PR's runs, reviews, traces and PR lists
   (`src/lib/hooks/reviews.ts:51-58`).
2. **"Review in progress…"** banner while any run is live (`:90-96`).
3. **"Lethal Trifecta detected"** + "N findings" if a finding has `kind: lethal_trifecta` (`:98-106`, `PrDetailView.tsx:45`).
4. **Timeline**, "runs & commits · newest first", when there are runs or commits (`:108-126`).
5. **Review runs**, "grouped by run · newest first" (`:128-146`): one `ReviewRunAccordion` per review.
   The newest review opens on load, and so does a review that arrives later (a run just finished); what the
   user opened stays open (`FindingsTab/useOpenRuns.ts:23-29`). EmptyState "No findings yet" when there are none
   and nothing runs (`:131-132`).

**Timeline row** (`PR/RunHistory/RunHistory.tsx`), between dashed commit rows (short sha, first message
line, author, time; `:130-159`), newest first (`:118-125`):
- outcome badge `running` / `error` / `cancelled`; a `done` run reads `rejected` (blockers), `reviewed`
  (findings) or `approved` (`:25-39,168-170`); a score ring for `done` (`:171`);
- the agent name, a button that opens and scrolls to its Review run (`:174-192`, `useOpenRuns.ts:41-47`,
  `ReviewRunAccordion.tsx:48-53`); `provider/model` (`:193-195`); the error of a `failed` run (`:197-204`);
- a `done` run with findings: severity chips + hover popover, else "N findings" (`:205-220`); time and
  **cost for every run**, `$0.0013 · 8.2K→1.3K`, `—` when none (`:222-226`);
- the FileText icon opens `?trace=` (`:227-235`), and the row itself has no click (`:167`); the Trash icon
  (not while running) → confirm → `DELETE /runs/:id` (`:236-246`, `FindingsTab.tsx:121-123`).

**Review run card** (`PR/ReviewRunAccordion/ReviewRunAccordion.tsx`):
- header: one toggle button, `aria-expanded` (`:64-93`): agent; verdict label, e.g. `request changes`
  (`:67-71`, `prReview.json:161-165`), coloured by `VERDICT_META` (`[number]/constants.ts:10-22`; `comment` is
  `--info`, as in the VerdictBanner); "N findings · N blockers" (blockers = CRITICAL not rejected, `:56,72-75`);
  detailed cost (`:77-83`); score (`:84-88`); time (`:89-91`). Beside it, Trash → confirm → `DELETE /reviews/:id` (`:94-107`).
- expanded, top to bottom: `VerdictBanner` (verdict, "N findings", agent, summary, score ring + "PR SCORE";
  `VerdictBanner.tsx:36-54`), then `FindingsPanel`:
  - pill row **"N CRITICAL · N WARNING · N SUGGESTION"**, present severities only, counting accepted and
    rejected findings too (`FindingsPanel.tsx:73-88`, `prReview.json:36-40`, `severity-counts/helpers.ts:10-16`);
  - filter buttons **Critical / Warning / Suggestion**, one at a time, second click clears (`FindingsPanel.tsx:48-51,90-103`);
    "Hide low confidence" hides < 0.65 (`:104-107`, `FindingsPanel/constants.ts:12`); none left → "No findings match" (`:111-112`);
  - cards sorted by severity, the first expanded (`FindingsPanel/helpers.ts:5-16`, `FindingsPanel.tsx:114-125`).
- finding card (`PR/FindingCard/FindingCard.tsx`): severity, title, category, `accepted` / `rejected` tag
  (`:64-65`), `file:line` linked to GitHub (`:68-70`), confidence, an expand button (`:75-86`); expanded:
  rationale, "Suggested fix", **Accept** / **Reject** (`:103-123`). A click changes the card at once and rolls
  back if the server refuses; only that card's buttons wait (`reviews.ts:158-194`, `FindingsPanel.tsx:120`).
  Reject is copy only; it posts `/findings/:id/dismiss` (`reviews.ts:163-167`, `prReview.json:6-7`).
  `j`/`k`/`a`/`d` act on the focused card of one run only — the last one opened (`FindingsPanel.tsx:54-69`,
  `FindingsTab.tsx:140`).

## Copy that e2e flows assert

No `data-testid`s: flows match visible text and URLs. "Seed" = `../server/src/db/seed.ts`.

| Flow | Asserts | Lives in |
| --- | --- | --- |
| `01-app-boot` | URL `/pulls`; "Pull Requests" | Redirect `src/app/(shell)/_components/HomeView/HomeView.tsx:21`; heading `prReview.json:81`. The sidebar item reads the same (`src/vendor/ui/nav.ts:25`), so the text alone proves little |
| `02`, `04`, `05` | "Add rate limiting to public API endpoints"; URL `/pulls/482` | Seed `:116-117`; the row's title link `PRRow.tsx:47-49`; `PrDetailHeader.tsx:39`. The row is under the default `needs_review` filter because the seed PR was never reviewed (`../server/src/modules/pulls/domain.ts:55`) |
| `03-agents` | "Security Reviewer" | Seed `:253`, via `AgentCard` |
| `04-pr-findings` | button "Agent runs"; `tab=findings`; "request changes"; "2 findings"; "Hardcoded Stripe secret key in commit" | `PrDetailHeader.tsx:91`, `prReview.json:177` (a plain `<button>` whose name includes the count, `src/vendor/ui/kit/Tabs.tsx:25-49`); `PrDetailView.tsx:37-42,87`; `ReviewRunAccordion.tsx:69` and `prReview.json:162` (seed `:153`); `ReviewRunAccordion.tsx:73` and `prReview.json:166` (seed `:161-186`); seed `:169`, visible because the newest run opens on load (`useOpenRuns.ts:23-29`) |
| `05-pr-diff` | button "Files changed"; `tab=diff`; "src/config.ts" | `PrDetailHeader.tsx:95`, `prReview.json:178`; seed `:134` via `DiffViewer` |
| `06-onboarding` | "Add a repository"; "Repository URL" | `AddRepoView.tsx:58,76` → `messages/en/shell.json:79,81` |
| `07-settings` | URLs `/settings/api-keys`, `/settings/models`; "API Keys"; "Feature Models" | `nav.ts:46-47` (sub-nav, crumb) and `messages/en/settings.json:6,24` (section titles) |
| `08-skills-lab` | URL `/skills`; "branch-coverage"; button "Open branch-coverage"; `tab=preview`; "Rendered as the reviewing agent receives it."; "When to apply:"; button "Open Test Quality Reviewer"; `tab=config`; button "Skills" (exact); `tab=skills`; "3 of 3 enabled" | Seeded skill `../server/src/db/seed-skills.ts:21`; the card's name button `SkillCard.tsx:53-64` with `skills.json:109`; `SkillsListView.tsx:62`; `skills.json:209`; `src/app/(shell)/skills/helpers.ts:17`; `AgentCard.tsx:39` with `agents.json:7` (agent seed `:273-284`); the Skills tab `agents.json:51` (the sidebar "Skills" is a link, so `--exact` button finds the tab); `agents.json:95`, three skills linked by seed `:339-354` |

## When you change this

- **Copy in the table:** update the flow in `../../e2e/specs/` in the same commit and run
  `cd e2e && npm run e2e:hermetic`. Moving copy between message files is fine if the text is identical.
- **Routes, hooks, URL:** a new route or tab goes here and into the route map in `../README.md`; a new
  hook or query key into the table in `../docs/ui-architecture.md`. The `?tab` keys, the `?status`
  default and `?trace` are contract: flows wait on `tab=findings` and `tab=diff`.
- **Semantics:** PR-list COST, SCORE and FINDINGS are computed on the server; amend `../../server/specs/`
  first. `dismiss` stays the API action, the `d` shortcut and `dismissed_at`; only the copy says Reject.
