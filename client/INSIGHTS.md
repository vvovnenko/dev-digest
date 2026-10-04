# client — insights

Things that are true about `client/` but not visible in the code. Append-only:
when an entry goes stale, add a dated note under it instead of deleting it.
Cross-package findings go in the [root file](../INSIGHTS.md).
Agents write here only through the `engineering-insights` skill, whose script
inserts lines and never changes existing ones.

Entry format: `- **YYYY-MM-DD** — claim. Evidence: \`path:line\``

## What works

## What doesn't work

- **2026-09-23** — `src/vendor/shared/` has drifted from the canonical server
  copy: 5 files differ, and the server is ahead in each (`openrouter` provider
  values, `AgentManifest`, `CommitFile`, …). There is no sync script. Evidence:
  `diff -rq server/src/vendor/shared client/src/vendor/shared`.
  - **2026-09-23** — Line evidence: `openrouter` is in `../server/src/vendor/shared/adapters.ts:83` and `../server/src/vendor/shared/contracts/productionize.ts:36` but missing from `src/vendor/shared/adapters.ts:77` and `src/vendor/shared/contracts/productionize.ts:36`; `AgentManifest` (`../server/src/vendor/shared/contracts/eval-ci.ts:152`) and `CommitFile` (`../server/src/vendor/shared/adapters.ts:129`) exist only in the server copy. The `Provider` enum itself matches (`src/vendor/shared/contracts/knowledge.ts:155`).
- **2026-09-23** — `FindingsPanel`'s j/k/a/d shortcuts are a `window` keydown listener per panel instance, and every expanded Review run mounts its own panel → with two runs open, one `a` or `d` press accepts/rejects the focused finding in each of them (read from the code, not reproduced) → keep one run expanded when using the shortcuts; scoping the listener to the focused panel is the fix. Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:55-59`, `src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:175`.
  - **2026-09-27** — Filtering or re-keying the runs list makes this worse: a run's open state comes from `defaultOpen` only at mount and `FindingsTab` passes `defaultOpen={i === 0}`, so after a filter change the new first run mounts open while a run the user opened stays open — two panels, one key press acts twice (both eval runs of a filter bar missed it) → reset open state or re-key the list on filter change, and test it. Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:46`, `src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:175`
  - **2026-09-28** — The handler checks no modifier keys: Cmd/Ctrl+A (select all) accepts and Cmd/Ctrl+D rejects the focused finding, with no undo, and keys still act behind open drawers/modals (read from the code) → guard `metaKey/ctrlKey/altKey/defaultPrevented` in any shortcut handler. Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:50-57`
  - **2026-09-28** — Partly fixed: the panel now acts only on plain key presses (`isShortcutFree`: no Cmd/Ctrl/Alt, not in a field, no `aria-modal` overlay) and a held `a`/`d` fires once; the per-panel double fire across open runs and the `g a` overlap remain. Evidence: `src/lib/shortcut-guards.ts:21`, `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:54`
  - **2026-09-28** — Fixed: FindingsTab owns which runs are open and which one drives the keys (`useOpenRuns`); only that run's panel listens, however many are open, and a new run still opens by itself. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:55`, `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsTab/useOpenRuns.ts:24`, `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx:154`
- **2026-09-23** — On the Agent runs tab, `g a` (go to Agents) also accepts the focused finding: the global chord handler and every mounted `FindingsPanel` listen on `window`, and neither stops the event, so the second key reaches both (read from the code, not reproduced) → don't use `g a` there; the fix is to skip panel shortcuts while a `g` chord is pending. Evidence: `src/components/app-shell/hooks/useGlobalShortcuts.ts:37-50`, `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:55-59`.
  - **2026-09-28** — Fixed: the chord handler listens in the capture phase and stops the second key, so no page shortcut sees it. Evidence: `src/components/app-shell/hooks/useGlobalShortcuts.ts:48,54`
- **2026-09-27** — `ReviewRunAccordion` opens and scrolls to the Timeline's jump target (`targetRunId`) in an effect that also runs on mount, so anything that remounts the accordions — filtering or re-keying the runs list — scrolls back to the last jumped-to run (read from the code, not reproduced) → clear the jump target whenever the list is filtered. Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:48-54`
  - **2026-09-28** — Fixed: open state lives in FindingsTab (not in mount), and the accordion clears the jump request once it has scrolled, so a remount scrolls nowhere. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:51`, `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.test.tsx:111`
- **2026-09-28** — Agent Config "Save" re-enables an agent disabled from the list: `ConfigTab` copies `agent.*` into state and resets it only when `agent.id` changes, then sends every field, including a stale `enabled`; switching provider also keeps the old model (read from the code) → render `<ConfigTab key={agent.id}>` and send only the fields the user changed. Evidence: `src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:29-39`
  - **2026-09-28** — Fixed: `ConfigTab` keeps only the fields the user changed and shows the cached agent for the rest, so Save sends only the draft; the parent keys it by agent id, and switching provider clears the model until one is picked. Tests fail on the old code. Evidence: `src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:28`, `src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.test.tsx:62`
- **2026-09-28** — "Open run trace" on a live run shows "No trace available yet" and "completed": the PR page never passes `running` to `RunTraceDrawer` (default `false`), and the server writes the trace only when the run ends (read from the code) → pass `running` from the live run ids when you touch the drawer. Evidence: `src/app/repos/[repoId]/pulls/[number]/page.tsx:174-181`, `src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/RunTraceDrawer.tsx:41`
  - **2026-09-28** — Fixed: `running` is now a required prop (forgetting it is a type error), the page passes whether the run is live and keys the drawer by run id, `onRunDone` refetches the trace, and `useRunEvents` starts `running` when it has ids. Evidence: `src/app/repos/[repoId]/pulls/[number]/page.tsx:180`, `src/lib/hooks/reviews.ts:173`
  - **2026-09-28** — Line evidence: `useRunEvents`'s initial `running` state is `src/lib/hooks/reviews.ts:172` (the fix note above cites `:173`, one line low).
- **2026-09-28** — `RunStatus` called `onDone` on every re-render after a run ended: its effect depended on the page's inline `onRunDone`, so each re-render (the 4 s run polling included) re-ran the invalidations (read from the code). Fixed: `onDone` is read from a ref and fires once per end of streaming. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunStatus/RunStatus.tsx:26,34`, `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunStatus/RunStatus.test.tsx:31`

## Codebase patterns

- **2026-09-23** — The PR list's filter is the `?status=` URL param and
  defaults to `needs_review`, so a PR drops out of the default view as soon as it
  is reviewed (clicking "All" from a script did not stick) → open
  `/repos/:id/pulls?status=all` to check list columns in screenshots or e2e.
  Evidence: `src/app/repos/[repoId]/pulls/page.tsx:39`.
- **2026-09-23** — The two "blockers" on the PR page can disagree. The Timeline's
  `RunSummary.blockers` is fixed when the run finishes and counted against the
  agent's `ciFailOn` gate. The Review-run header counts CRITICAL minus dismissed,
  live. → never treat them as one number; per-run severity data comes from
  `ReviewRecord.findings`. Evidence: `../server/src/modules/reviews/run-executor.ts:240`,
  `src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:57`.
- **2026-09-23** — `@devdigest/ui` has no popover, tooltip or hover card; its one
  overlay, `Dropdown`, is click-driven and absolutely positioned inside its
  wrapper. The PR list's `tableCard` has `overflow: hidden`, which would clip such
  an overlay in lower rows → build hover cards with a portal and `position: fixed`,
  and stop click propagation (React bubbles portal events to the row's `onClick`).
  Evidence: `src/vendor/ui/kit/Dropdown.tsx:83-88`,
  `src/app/repos/[repoId]/pulls/styles.ts:91`, `server/specs/02-findings-by-severity.md`.
- **2026-09-23** — Review-run finding cards say **Reject** / `rejected` only in copy (HW1 criterion 22); the API action, the `d` shortcut, `FindingActionKind` and `dismissed_at` all keep `dismiss` → grep `dismiss` in code and `Reject` only in `messages/en/prReview.json`; don't rename the API. Evidence: `messages/en/prReview.json:7`, `src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:110`.
  - **2026-09-23** — The vendored shortcut help still lists `d` as "Dismiss finding"; it can't be edited (`src/vendor/**`), so the two labels differ until the vendored kit changes. Evidence: `src/vendor/ui/nav.ts:58`.
- **2026-09-23** — `usePulls` is mounted by every `AppShell` for the sidebar's needs-review badge, so `GET /repos/:id/pulls` polls every 60 s (and on window focus) on every screen, not just the list; the PR page reuses that cache to turn `:number` into the PR id → expect that request in any page's network log, and a PR missing from the list means its detail page shows "Couldn't load". Evidence: `src/components/app-shell/hooks/useShellContext.ts:28`, `src/lib/hooks/core.ts:102-112`, `src/app/repos/[repoId]/pulls/[number]/page.tsx:33-36`.
  - **2026-09-28** — Fixed: `usePulls` polls only when asked — the PR list, and the sidebar badge only on `/repos/*`; elsewhere the badge refreshes on focus. Evidence: `src/components/app-shell/hooks/useShellContext.ts:30`, `src/lib/hooks/core.ts:114`
  - **2026-09-28** — Line evidence: the opt-in interval is `src/lib/hooks/core.ts:116` (the fix note above cites `:114`, two lines high).
- **2026-09-27** — Severity colours already have one owner: `SEV` in `@devdigest/ui` (colour, bg, icon, label per severity), used by `FindingsPanel` and `SeverityCounts`. The local `SEV_COLOR` maps in `FindingCard/constants.ts` and `FindingsSection.tsx` duplicate it, and their SUGGESTION disagreement (`--sugg` vs `--accent`) is invisible today because both tokens have the same hex in both themes → read `SEV[sev].c` instead of adding a map, and still ask before switching a token. Evidence: `src/vendor/ui/primitives/tokens.ts:6`, `src/vendor/ui/styles.css:20,29`
  - **2026-09-28** — Done: the local `SEV_COLOR` maps are gone; FindingCard and the trace's FindingsSection read `SEV[severity].c`. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:45`
- **2026-09-27** — The `comment` verdict has two colours that render together: `--warn` in the Review-run accordion header and `--info` in the `VerdictBanner` inside it → ask which one is intended before unifying them or reusing either map for new UI (e.g. verdict filter chips). Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:18`, `src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/constants.ts:16`
  - **2026-09-28** — Resolved: the user chose `--info`; `VERDICT_META` at the route rung is the one owner for the accordion header and the VerdictBanner. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/constants.ts:21`
- **2026-10-03** — `AgentEditor` keeps `ConfigTab` mounted under `<div hidden>` while another tab shows, because the draft (only the changed fields) lives in ConfigTab's local state and unmounting drops it → add new agent tabs beside it; never swap ConfigTab out by tab. The skill editor does the same. Evidence: `src/app/(shell)/agents/[id]/_components/AgentEditor/AgentEditor.tsx:25`
- **2026-10-04** — The vendored `Card` sets the `border` shorthand, so overriding one side (`borderLeft…`) on a Card makes React warn about a conflicting style property on rerender → mark a side with an inset `boxShadow` (the accepted stripe on a conventions card), which also avoids a layout shift. Evidence: `src/vendor/ui/primitives/Card.tsx:24`, `src/app/(shell)/repos/[repoId]/conventions/_components/CandidateCard/styles.ts:11`
- **2026-10-04** — `LineNumberedEditor` is shared now (`src/components/line-numbered-editor/`, promoted for the Conventions modal) but still reads the `skills` namespace (`config.unsaved`, `config.tokens`) → a consumer outside skills gets skill copy for those two labels; pass them in as props before reusing it for anything that isn't a skill body. Evidence: `src/components/line-numbered-editor/LineNumberedEditor.tsx:29`
- **2026-10-04** — The vendored `Modal` is no portal: its `position: fixed` overlay renders where it is called, so a modal inside a card inherits a disabled card's `opacity: 0.6` and its clicks (Delete, ✕, backdrop) bubble to the card's `onClick`, which opens the skill or agent → render a card's modal beside the card in a fragment, as `ConfirmDeleteModal` is; SkillCard's delete tests fail when it is nested. Evidence: `src/vendor/ui/kit/Modal.tsx:20`, `src/app/(shell)/skills/_components/SkillCard/styles.ts:11`, `src/app/(shell)/skills/_components/SkillCard/SkillCard.tsx:103`

## Tool & library notes

- **2026-09-23** — `pnpm exec vitest run <path>` finds nothing when the path
  has a Next.js segment like `[repoId]`, escaped or not ("No test files
  found") → filter by a filename substring: `pnpm exec vitest run RunHistory.test`.
  Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.test.tsx`.
  - **2026-09-23** — Line evidence: discovery is the single include glob in `vitest.config.ts:18` (`src/**/*.test.{ts,tsx}`), run by `package.json:10` (`vitest run`); a filename substring such as `RunHistory.test` worked again in the HW1 fixes (blocks A–B).
- **2026-09-23** — `Chip` from `@devdigest/ui` renders a plain `<button>` with no `aria-pressed`, so a toggle-filter's active state is visual only and the vendored kit can't be edited → in tests, assert a filter through the cards it leaves (`[data-finding-id]`), not through the button's state. Evidence: `src/vendor/ui/primitives/Chip.tsx:22`, `src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.test.tsx`.
- **2026-09-28** — The `export *` barrel of `@devdigest/ui` does not drag charts into pages: after `next build` no client chunk contains `recharts`, `d3-shape` or `mermaid` (webpack tree-shakes it; recharts declares `sideEffects: false`) → don't spend effort splitting the vendored barrel; measure with `grep -rl recharts .next/static/chunks` first. Evidence: `src/vendor/ui/index.ts:7`, `node_modules/recharts/package.json:9`
- **2026-09-28** — An SSE stream the server ends normally fires `EventSource.onerror` with `readyState` CONNECTING and the browser reconnects after the `retry` fastify-sse-v2 sends (3000 ms) — so "close on any error" also killed real reconnects, and a reconnect replays the run from seq 1 → end on an explicit terminal event (`done`), treat only CLOSED as final, and de-duplicate by run + seq. Evidence: `../server/node_modules/fastify-sse-v2/lib/plugin.js:38`, `src/lib/hooks/reviews.ts:251`, `src/lib/hooks/reviews.test.tsx:98`
- **2026-09-28** — The client's ESLint config loads no `eslint-plugin-react-hooks`, so an `// eslint-disable-next-line react-hooks/exhaustive-deps` directive is itself a lint error ("Definition for rule … was not found"); the two old ones became plain comments on the same lines → don't add such a directive without adding the plugin. Evidence: `eslint.config.mjs:10`, `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:52`, `src/lib/hooks/reviews.ts:260`.
- **2026-09-28** — After a hermetic e2e run, `client/.next-e2e/types/**` holds generated `.ts` files that `pnpm lint` picked up (11 errors) until the config ignored `.next-e2e/**` like `.next/**`. Evidence: `eslint.config.mjs:10`.
- **2026-10-03** — `userEvent.upload` honours the input's `accept` by default: a file of another type is dropped silently and no change event fires, so a test of the component's own type check passes vacuously → `userEvent.setup({ applyAccept: false })` when testing client-side rejection. Evidence: `src/app/(shell)/skills/_components/AddSkillMenu/_components/ImportSkillDrawer/ImportSkillDrawer.test.tsx:58`
  - **2026-10-04** — Path moved: the file import is now a centered modal, `ImportSkillDrawer/` → `ImportSkillModal/` (same `applyAccept: false` test, renamed with `git mv`). Evidence: `src/app/(shell)/skills/_components/AddSkillMenu/_components/ImportSkillModal/ImportSkillModal.test.tsx:46`
- **2026-10-03** — The vendored `Toggle` takes only `on`/`onChange`/`size` (no `aria-label`), so its switch has no accessible name → wrap it in a `<label>` with visually hidden text; `getByRole("switch", { name })` then finds it. Evidence: `src/vendor/ui/primitives/Toggle.tsx:3`, `src/app/(shell)/skills/_components/SkillCard/SkillCard.tsx:66-69`
  - **2026-10-04** — Line evidence moved: the card's toggle `<label>` is now `SkillCard.tsx:71-78`. Evidence: `src/app/(shell)/skills/_components/SkillCard/SkillCard.tsx:71`
  - **2026-10-04** — The vendored `Toggle` and `Checkbox` now also take `disabled` (native `disabled`, dimmed; user-approved vendor exception for blocked skills); the accessible name still needs the `<label>` wrapper. The card's toggle `<label>` is now `SkillCard.tsx:71-79`. Evidence: `src/vendor/ui/primitives/Toggle.tsx:7`, `src/vendor/ui/kit/Checkbox.tsx:9`
- **2026-10-04** — next-intl's `format.relativeTime(date)` without a `now` calls `onError(ENVIRONMENT_FALLBACK)` (a `console.error` in dev), because the root `NextIntlClientProvider` sets no global `now` → pass `useNow({ updateInterval })`, and clamp it to the moment itself (`relativeNow`), or a scan that finished after the last tick reads "in 1 minute". Evidence: `src/app/layout.tsx:32`, `src/app/(shell)/repos/[repoId]/conventions/_components/ConventionsView/ConventionsView.tsx:46`, `src/app/(shell)/repos/[repoId]/conventions/helpers.ts:35`
  - **2026-10-04** — A live "started …"/"… ago" text also needs a tick under 60 s: below a minute `relativeTime` prints seconds, so a 60 s `useNow` freezes it on "12 seconds ago" for a minute → give that text its own 1 s clock in a small leaf component (only while running), as `ScanStatus` does. Line evidence moved: the view's `relativeTime` call is now `ConventionsView.tsx:52`. Evidence: `src/app/(shell)/repos/[repoId]/conventions/_components/ConventionsView/_components/ScanStatus/ScanStatus.tsx:27`
- **2026-10-04** — TanStack Query 5 runs a mutation's `onSettled` while that mutation still counts in `isMutating`, so `qc.isMutating({ mutationKey }) === 1` there means "no other edit in flight" — the guard that refetches once after several quick optimistic edits instead of after each (its test fails without it). Evidence: `src/lib/hooks/conventions.ts:89`, `src/lib/hooks/conventions.test.tsx:127`
  - **2026-10-04** — Line evidence moved: the guard is `src/lib/hooks/conventions.ts:104`, its test `src/lib/hooks/conventions.test.tsx:189`. Evidence: `src/lib/hooks/conventions.ts:104`
- **2026-10-04** — The vendored `EmptyState` always puts a `Plus` icon on its CTA, so a CTA that doesn't add something (Conventions' "Run scan") still shows "+" → render your own `Button` under the empty state if the icon matters. Evidence: `src/vendor/ui/primitives/EmptyState.tsx:58`
- **2026-10-04** — A mutation's `setQueryData` is enough to start a function `refetchInterval`: TanStack Query 5 re-runs it on every cache write (`onQueryUpdate` → `#updateTimers`), so writing the conventions POST's 202 state (`latest_scan` queued) starts the 2 s polling with no invalidate; each write also restarts the interval. Evidence: `node_modules/.pnpm/@tanstack+query-core@5.101.0/node_modules/@tanstack/query-core/build/modern/queryObserver.js:424-428`, `src/lib/hooks/conventions.ts:34,47`
- **2026-10-04** — Under `vi.useFakeTimers({ shouldAdvanceTime: true })` a hook's `result.current` lags the query cache: it updates only after notifyManager's `setTimeout(0)` batch, so right after `await act(() => mutateAsync())` the cache is new but `result.current.data` is old → assert data with `waitFor`; API call counts can be asserted directly. Evidence: `node_modules/.pnpm/@tanstack+query-core@5.101.0/node_modules/@tanstack/query-core/build/modern/notifyManager.js:3,13`, `src/lib/hooks/conventions.test.tsx:131`
- **2026-10-04** — In user-event 14, Enter in an `<input>` submits through the submit button it finds inside the `<form>`; the vendored `Modal` renders `footer` outside its children, so a submit button placed in the footer (linked with `form=`) works in a browser but not in tests → keep a modal form's submit button inside the `<form>`. Evidence: `src/vendor/ui/kit/Modal.tsx:61-63`, `src/app/(shell)/skills/_components/AddSkillMenu/_components/ImportSkillUrlModal/ImportSkillUrlModal.tsx:54,78`
- **2026-10-04** — `new URL("https:example.com/a.md")` parses with `protocol === "https:"`, but the `SkillImportUrlRequest` contract requires the literal `https://` prefix → a protocol-only check enables a button the API answers with 422; test the prefix too. Evidence: `src/app/(shell)/skills/_components/AddSkillMenu/_components/ImportSkillUrlModal/helpers.ts:11-14`, `src/vendor/shared/contracts/knowledge.ts:274`

## Recurring errors & fixes

## Doc drift

- **2026-09-23** — README and TESTING say client tests mock `fetch`; the setup
  file only loads jest-dom and stubs `ResizeObserver`. Tests mock the hooks
  module instead. Evidence: `README.md:17,46`, `../TESTING.md:38`,
  `src/test/setup.ts`.
  - **2026-09-29** — Fixed in place: README, TESTING and `client.yml` now say components get `vi.mock`ed hook modules and data-layer tests mock `src/lib/api.ts`; `fetch` is never mocked. Evidence: `README.md:16-17,48-50`, `../TESTING.md:37-39`, `../.github/workflows/client.yml:3`.
- **2026-09-23** — `src/vendor/ui/README.md` points at a `/showcase` route that
  does not exist; only the smoke test renders the gallery. Evidence:
  `src/vendor/ui/README.md:55`, `ls src/app`.
  - **2026-09-29** — Left as is in wave 5: the drift is in the vendored `src/vendor/ui/README.md`, which stays read-only. Evidence: `src/vendor/ui/README.md:55`.
- **2026-09-23** — `RunHistory`'s header comment says "clicking a run row opens
  its trace", but the row `<div>` has no `onClick`: only the 📄 icon opens the
  drawer, and the agent name jumps to Review runs. The user confirmed icon-only
  is intended → don't add row clicks. Evidence:
  `src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:13,154,209`.
  - **2026-09-23** — Evidence has moved (the lines shifted in `ede389e`): the comment is `RunHistory.tsx:14`, the row `<div … style={rowStyle}>` without `onClick` is `:165`, the 📄 icon's `onOpenTrace` is `:229` and the agent name's `onGoToReview` is `:174`. Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:14,165,174,229`.
  - **2026-09-29** — Fixed (wave 3): the header comment now says only the 📄 icon opens a trace and rows don't click. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:15`.
- **2026-09-23** — `DiffTab` breaks the "no `onError` toasts" rule in `CLAUDE.md`: it calls `notify.error` and rethrows, and the global mutation handler toasts again, so a failed comment post shows two toasts. The PR list's header comment says sort lives in `?sort`, but search and sort are local state (only `?status` is in the URL). Evidence: `src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:36-39`, `src/lib/providers.tsx:41-43`, `src/app/repos/[repoId]/pulls/page.tsx:2,46-47`.
  - **2026-09-28** — Fixed: DiffTab no longer toasts (the global handler does, once; the composer keeps the draft), and search and sort now live in `?q` / `?sort` as the comment says. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:34`, `src/app/(shell)/repos/[repoId]/pulls/_components/PullsListView/PullsListView.tsx:32-33`
- **2026-09-28** — `docs/ui-architecture.md` → Known pitfalls says the Timeline's delete icon is a `<span role="button">` with no `tabIndex` or key handler, but wave 3 (the same commit, `9df7497`, that added the pitfall) made it a real `<button type="button">` with an `aria-label` → the pitfall describes the code as it was at `de58de8`; drop it or rewrite it. Evidence: `docs/ui-architecture.md:194-196`, `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:236-246`.
  - **2026-09-29** — Fixed: the pitfall is removed; "Shortcuts follow the last opened run" is the section's only entry now. Evidence: `docs/ui-architecture.md:192-195`.
- **2026-10-04** — `FindingCard/styles.ts` says its all-longhand border avoids React's shorthand warning, but `borderColor` is itself a shorthand over `borderLeftColor`: `pnpm exec vitest run FindingsPanel.test` logs "Updating a style property during rerender (borderColor) when a conflicting property is set (borderLeftColor)" 6 times → set the four side colours separately (or use an inset shadow) when you next touch it. Evidence: `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/styles.ts:7-13`
- **2026-10-04** — The pre-staged, unused `file.*` keys in `skills.json` say a file import's blank name is "derived from the first heading", but the server's file import names a skill from frontmatter `name` → folder → file stem; only the URL import falls back to the first heading (`preferHeadingName`) → the file modal uses its own `import.nameHint` ("taken from the file"); don't wire the `file.*` copy in as is. Evidence: `messages/en/skills.json:47`, `messages/en/skills.json:171`, `../server/src/modules/skills/import-parser.ts:47-48`

## Session notes

- **2026-09-23** — Run Cost Badge (lab task 3): +2 (Tool & library notes, Codebase patterns)
- **2026-09-23** — Findings-by-severity spec + plan: +3 (Doc drift, Codebase patterns)
- **2026-09-23** — HW1 fixes, block A (popover header, Reject, Timeline cost): +1 (Codebase patterns)
- **2026-09-23** — HW1 fixes, block B (Review-run severity pills + filter): +2 (What doesn't work, Tool & library notes)
- **2026-09-23** — HW1 fixes, block E (path:line in every entry): +2 (What doesn't work, Tool & library notes — line evidence)
- **2026-09-23** — HW1 fixes, block F (docs/ui-architecture.md, specs/pages.md): +4 (What doesn't work, Doc drift, Codebase patterns, Codebase patterns nuance)
- **2026-09-23** — PR description + insights audit: +1 (Doc drift — line evidence moved)
- **2026-09-27** — frontend-ui-architecture skill (research, SKILL.md, two eval rounds): +3 (What doesn't work, Codebase patterns ×2)
- **2026-09-27** — frontend-ui-architecture 1.2.0 (round-3 evals): +1 (What doesn't work, nuance)
- **2026-09-28** — Whole-project audit with frontend-ui-architecture/react/next skills: +3 (What doesn't work ×2, nuance)
- **2026-09-28** — Wave 0 fixes (ConfigTab draft, live trace drawer, shortcut guards): +4 (What doesn't work ×3 fixed, line evidence)
- **2026-09-28** — Wave 3 (shell layout, URL state, key factory + optimistic actions, SSE done/dedup, single shortcut owner, a11y, i18n, error pages, next/font): +12 (Tool & library notes ×2, What doesn't work +1 and ×3 fixed, Codebase patterns ×3 resolved, Doc drift fixed, Open question resolved)
- **2026-09-28** — Wave 4 (ESLint + user-event + coverage, synced vendor/shared, AgentCreate/AgentUpdate contracts, data-layer tests): +2 (Tool & library notes)
- **2026-09-29** — Wave 5 (README/TESTING test-mocking claims, ui-architecture pitfall): +4 (Doc drift fix notes)
- **2026-10-03** — L02 Skills Lab (skills pages, agent Skills tab, trace blocks): +3 (Codebase patterns, Tool & library notes ×2)
- **2026-10-04** — HW2 Conventions Extractor (route, cards, create-skill modal, nav, hooks, shared editor + skill helpers): +6 (Tool & library notes ×3, Codebase patterns ×2, Doc drift)
- **2026-10-04** — Conventions scan status + polling (isScanActive, ScanStatus, 202 flow): +2 (Tool & library notes ×2) + 2 nuances
- **2026-10-04** — Delete-confirm modal on skill/agent cards (`ConfirmDeleteModal`, copy, tests, pages.md citations): +1 (Codebase patterns) + 1 line-evidence note
- **2026-10-04** — Skill URL import modal + injection-blocked UI (banner, badge, disabled toggles, agent row; vendor `disabled` props; pages.md): +2 (Tool & library notes ×2) + 1 nuance
- **2026-10-04** — Import modals: file import as a centered modal (`ImportSkillModal`), optional skill name first in both import modals: +1 (Doc drift) + 1 path note

## Open questions

- **2026-09-23** — Some copy is hardcoded despite next-intl (onboarding page,
  root empty state), and e2e flows assert on it. Move it to `messages/en/` or
  leave it? Evidence: `src/app/onboarding/_components/AddRepoView/AddRepoView.tsx:77,94`,
  `src/app/page.tsx:34`.
  - **2026-09-28** — Resolved: the onboarding and home copy moved to `messages/en/shell.json` (`addRepo`, `home`) with the text unchanged, so e2e assertions still hold; the link and `esc` key are rich-text tags. Evidence: `src/app/onboarding/_components/AddRepoView/AddRepoView.tsx:58,60`
