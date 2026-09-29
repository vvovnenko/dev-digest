# UI architecture

How the studio is built **today**. Stack, commands and the route map are in
[`../README.md`](../README.md); conventions and naming are in
[`../CLAUDE.md`](../CLAUDE.md); what each page must keep showing is in
[`../specs/pages.md`](../specs/pages.md). This file covers the Server/Client
boundary, how data reaches a component, and what refreshes it. Paths are relative
to `client/`; `[number]/` = `src/app/(shell)/repos/[repoId]/pulls/[number]/` (the PR detail route) and
`PR/` = its `_components/`.

## Server vs Client Components

- **Root layout** (`src/app/layout.tsx:19-20`) is `async`: it reads the locale, *all* messages and the time
  zone on the server and renders `NextIntlClientProvider → Suspense (fallback null) → Providers`
  (`layout.tsx:32-36`). It also loads Inter through `next/font` (`:2,11,22`) and sets the tab-title
  template "<page> · DevDigest" (`:13-17`).
- **The `(shell)` route group** holds every screen but `/onboarding`. Its layout, a Server Component, renders
  the client `AppShell` once (`src/app/(shell)/layout.tsx:7-9`), so the frame, the command palette and the
  shortcut listeners survive navigation. The group adds nothing to the URL.
- **Every `page.tsx` is a thin Server file.** It exports `generateMetadata`, whose title comes from
  `shell.titles` (`messages/en/shell.json:46-56`; e.g. `src/app/(shell)/repos/[repoId]/pulls/[number]/page.tsx:7-10`
  → "PR #482 · DevDigest"), and renders one client view: `HomeView`, `AgentsListView`, `AgentEditorView`,
  `SettingsView`, `PullsListView`, `PrDetailView`, `AddRepoView` (each `<Name>View.tsx` starts with
  `"use client"`).
- **Nothing fetches on the server.** The only `fetch` is `src/lib/api.ts:24`; there is no `loading.tsx`.
  Errors: a page that throws renders `src/app/(shell)/error.tsx:10-16` inside the shell (retry = `reset`);
  an unknown URL renders `src/app/not-found.tsx:9-23`; a failing root layout falls back to
  `src/app/global-error.tsx`, which has no providers and so fixed English copy.

So the server renders only the shell and the i18n messages; all data loads in client islands after
hydration. The whole catalog, including namespaces no screen reads yet, is serialized into every page:
`src/i18n/request.ts:16-25` loads every file and `layout.tsx:20,32` passes them all.

## Providers and global errors

`src/lib/providers.tsx:51-57` nests the providers, outermost first: `QueryClientProvider → ThemeProvider →
ToastProvider → RepoProvider`. The `QueryClient` is created once, in `useState` (`providers.tsx:22`), with
`retry: 1`, `staleTime: 30 s`, `refetchOnWindowFocus: false` (`providers.tsx:26-30`). Overrides:
`useRunTrace` never retries (`src/lib/hooks/trace.ts:18`), `useProviderModels` stays fresh 5 min
(`agents.ts:68`), `usePulls` refetches on focus (`core.ts:118`).

- A failed **query** toasts only on a network failure (status 0) or ≥ 500; a non-`ApiError` counts as 500
  (`providers.tsx:35-40`). A 4xx stays silent so the page can show it inline. A failed **mutation**
  always toasts (`providers.tsx:41-47`), via the hook-free `notify` bridge (`src/lib/toast.tsx:30-39`).
  Mutation call sites therefore add no `onError` toast: `DiffTab` rethrows so the composer keeps the draft
  (`PR/DiffTab/DiffTab.tsx:32-38`), and `CreateAgentModal` navigates only `onSuccess`.
- Exceptions: `AddRepoView` shows the error inline (`AddRepoView.tsx:39-41`) as well as the global
  toast. SSE failures reach neither cache, so `useRunEvents` toasts `error` events itself, once per event
  (`src/lib/hooks/reviews.ts:236-243`).
- Toasts sit in a polite live region; an error toast is `role="alert"` (`toast.tsx:90-99`).

## Network layer (`src/lib/api.ts`)

- `API_BASE` is `NEXT_PUBLIC_API_BASE`, else `http://localhost:3001` (`api.ts:5-6`), inlined at build
  time by `next.config.mjs:10-12`. The only other network call is `EventSource` (`reviews.ts:228`).
- `content-type: application/json` is sent only with a body (`api.ts:27-30`); `post`/`put`/`patch` send
  none for a falsy payload (`api.ts:67-72`). A 204 returns `undefined` (`api.ts:61`).
- A thrown `fetch` becomes `ApiError(0, "network_error")`, "Cannot reach the DevDigest engine at … Is the
  API running?" (`api.ts:34-42`). A non-2xx becomes `ApiError` built from `{ error: { code, message,
  details } }`, else `"<status> <statusText>"` (`api.ts:44-58`).

## Hooks, query keys, invalidation

All hooks live in `src/lib/hooks/*.ts`, re-exported by `src/lib/hooks/index.ts:4-8`. Pull-request, run and
PR-list keys come from the factories in `src/lib/hooks/keys.ts:6-23`: a key starts with the resource and
holds every `queryFn` input, so invalidating a prefix refreshes everything under it (`prKeys.all(prId)` =
the PR's detail, reviews, runs and comments). The other keys are inline arrays. `["context", repoId]`
(`core.ts:168-182`) and `["repo-intel-state"]` have hooks but no screen yet.

| Key | Hook → endpoint | Refetch | Written by |
| --- | --- | --- | --- |
| `["settings"]` | `useSettings` → `GET /settings` (`core.ts:25-30`) | — | `useUpdateSettings` sets data (`core.ts:36`) |
| `["secrets-status"]` | `useSecretsStatus` → `GET /settings/secrets-status` (`core.ts:60-66`) | — | `useTestConnection` when `ok` (`core.ts:50-54`) |
| `["repos"]` | `useRepos` → `GET /repos` (`core.ts:69-74`) | — | add / refresh / delete repo (`core.ts:80,89,99`) |
| `repoKeys.pulls(repoId)` | `usePulls` → `GET /repos/:id/pulls` (`core.ts:112-120`) | every 60 s only with `poll: true`; on focus | `useRefreshRepo` (`core.ts:90`), `useSyncPulls` after a poll (`core.ts:133`); a finished run, all lists (`reviews.ts:56`) |
| `prKeys.detail(prId)` | `usePullDetail` → `GET /pulls/:id` (`core.ts:159-165`) | — | `prKeys.all` invalidations |
| `["agents"]` | `useAgents` → `GET /agents` (`agents.ts:8-13`) | — | create / update / delete (`agents.ts:30,45,56`) |
| `["agent", id]` | `useAgent` → `GET /agents/:id` (`agents.ts:15-21`) | — | update sets data, delete removes it (`agents.ts:46,57`) |
| `["provider-models", p]` | `useProviderModels` → `GET /providers/:p/models` (`agents.ts:63-70`) | — | `useTestConnection` when `ok` (`core.ts:52`) |
| `prKeys.runs(prId)` | `usePrRuns` → `GET /pulls/:id/runs` (`reviews.ts:27-35`) | every 4 s while a run is `running` | run review, delete run and a finished run via `prKeys.all` (`reviews.ts:133,67,54`); cancel (`reviews.ts:76`) |
| `prKeys.reviews(prId)` | `usePrReviews` → `GET /pulls/:id/reviews` (`reviews.ts:38-44`) | — | finding action, optimistic (`reviews.ts:168-183`); delete review (`reviews.ts:85`); `prKeys.all` invalidations |
| `prKeys.comments(prId)` | `usePrComments` → `GET /pulls/:id/comments` (`reviews.ts:91-97`) | — | `useCreatePrComment` (`reviews.ts:113`) |
| `runKeys.trace(runId)` | `useRunTrace` → `GET /runs/:id/trace` (`trace.ts:13-20`) | no retry | a finished run, all traces (`reviews.ts:55`) |
| `["repo-intel-state", repoId]` | `useRepoIntelStatus` → `GET /repos/:id/index-state` (`repo-intel.ts:31-38`) | every 1.5 s when `poll` | `useResyncRepoIntel` (`repo-intel.ts:46`) |

- **The PR list is shared, and polls only where asked.** The GET only reads what the server stores;
  importing from GitHub is `POST /repos/:id/poll` through `useSyncPulls` (Refresh) and
  `useAutoSyncPulls`, once per repo and only with a GitHub token (`core.ts:122-157`; its failures stay
  silent through `meta.silent`, `src/lib/providers.tsx:41-46`). `usePulls` polls only with `poll: true`
  (`core.ts:103-120`): the PR list page asks for it
  (`PullsListView.tsx:28`), the sidebar's needs-review badge only on `/repos/*` paths
  (`src/components/app-shell/hooks/useShellContext.ts:28-30,75-77`); elsewhere the badge refreshes on focus
  and navigation. The PR page reads the same cached list to turn `:number` into the PR's uuid
  (`[number]/usePrDetail.ts:13-14`).
- **Mutation hooks invalidate what they change; pages don't.** A started review invalidates `prKeys.all`
  (`reviews.ts:133`), so its runs show up in the run history at once and the 4 s poll starts. When the live
  streams end, `useRunSettled` refreshes the PR's data, every run trace and every PR list, so the list's
  SCORE, FINDINGS, COST and status catch up without waiting for a poll (`reviews.ts:51-58`, called from
  `FindingsTab.tsx:47,86`). A cancel refreshes the run history (`reviews.ts:76`).
- **Live runs come from the run history.** The ids of the PR's `running` runs are derived from `usePrRuns`
  (`[number]/helpers.ts:5-7`, `usePrDetail.ts:30`); the client no longer calls `GET /pulls/:id/runs/active`.
- **Accept / Reject is optimistic.** `useFindingAction(prId)` patches the cached reviews in `onMutate`, rolls
  back in `onError` and refetches `onSettled`; `usePendingFindingIds` reports which findings have an action in
  flight, so only that card's buttons wait (`reviews.ts:158-194`, `FindingsPanel.tsx:34-35,120`).

## Live runs (SSE)

`useRunEvents(runIds)` (`reviews.ts:207-264`) opens one `EventSource` per run at `/runs/:id/events`
(`reviews.ts:228`). It listens to the named events `info`, `tool`, `result` and `error`, appending the parsed
`RunEvent`s, and to `done` (`reviews.ts:246-247`), which the server sends as the stream's last event
(`../server/src/modules/reviews/routes.ts:85,137`).

- **A run ends only on `done`.** `running` turns false once every run has sent it
  (`reviews.ts:221-225,247`). An error while `readyState` is `CONNECTING` is a dropped connection that
  EventSource is already retrying; only `CLOSED` (the server refused the stream, e.g. an unknown run) also
  ends it (`reviews.ts:250-252`).
- **A reconnect replays the run**, so events are de-duplicated by run + `seq`, and an `error` event toasts
  once (`reviews.ts:236-243`). The effect is keyed on the joined ids, so any change to the set reopens every
  stream and clears the events (`reviews.ts:212,214-217,261`).
- **`RunStatus`** (`PR/RunStatus/RunStatus.tsx:20-36`) renders the log and calls `onDone` once per end of
  streaming. It reads the latest callback from a ref, so a parent passing a fresh function each render does
  not fire it again.
- **`RunTraceDrawer`** subscribes only when its `running` prop is true (`RunTraceDrawer.tsx:49-53`).
  `running` is required: the view passes whether the run is live and keys the drawer by run id
  (`PrDetailView.tsx:113-122`). A live run — e.g. from Live review's "Open run trace"
  (`FindingsTab.tsx:78`) — opens on the Live log and is labelled "running" (`RunTraceDrawer.tsx:71`); when it
  finishes, `useRunSettled` invalidates every trace, so the Trace tab refetches. If the trace returns 404
  (`../server/src/modules/reviews/routes.ts:191-196`), the drawer shows "No trace available yet."
  (`RunTraceDrawer.tsx:102-104`); a 4xx raises no toast.

## i18n

- One locale, `en`, no locale routing (`src/i18n/request.ts:14,27-33`); plugin wired in
  `next.config.mjs:3,15`. Each `messages/en/<ns>.json` becomes namespace `<ns>` (`request.ts:19-23`).
- The time zone is fixed on the server (`request.ts:30-32`) and passed to the client provider
  (`layout.tsx:20,32`), so dates format the same on both sides. Components print dates only through
  `src/lib/format.ts` (`useDateFormat`, `DATE_TIME`, `TIME`), not `toLocaleString()`.
- Client components read `prReview`, `runs`, `agents`, `settings`, `shell` and `common` with
  `useTranslations`; page titles use `getTranslations("shell.titles")` on the server. Counts use ICU plurals
  (`{count, plural, one {# finding} other {# findings}}`).
- **Hardcoded English that remains:** `global-error.tsx` (no providers there), the Timeline's agent-name
  fallback "Agent" (`PR/RunHistory/RunHistory.tsx:191`) and the toast fallback "Something went wrong"
  (`src/lib/providers.tsx:18`). e2e flows assert some message text, so change a string only with its flow
  ([`../specs/pages.md`](../specs/pages.md#copy-that-e2e-flows-assert)).
- **Some vendored copy is English too:** nav labels, settings sections and the shortcut list
  (`src/vendor/ui/nav.ts:25-26,39-42,51-59`). The shortcut list still says "Dismiss finding" for `d`
  (`nav.ts:58`), while the card button says "Reject".

## Styling and theme

- **Styles are colocated** in `styles.ts` as `s`: objects with `satisfies CSSProperties`, or functions
  when they take arguments (`FindingsPanel/styles.ts:28-46`); colours are CSS variables. One older port
  still styles inline (`PR/RunHistory/RunHistory.tsx:41-77` and its JSX).
- **Shared tokens have one owner.** Severity colours come from `SEV` in `@devdigest/ui`; verdict colours from
  `VERDICT_META` (`[number]/constants.ts:10-22`, used by the Review-run header and the VerdictBanner); PR status
  colours from `STATUS_META` (`src/app/(shell)/repos/[repoId]/pulls/constants.ts:10-17`); `file:line` labels
  from `src/lib/finding-location.ts`.
- **Tailwind is loaded but not used.** `globals.css:5` imports `src/vendor/ui/styles.css`, which does
  `@import "tailwindcss"` and defines the tokens per `[data-theme]` (`styles.css:1,9-10,49`).
  Components use no Tailwind utilities; the only classes are `mono` and `tnum` (`styles.css:144,221`).
- **Font.** Inter is self-hosted by `next/font` (`layout.tsx:11`) as `--font-inter`, which `globals.css:10-12`
  puts first in the body font stack (the vendored sheet asks for "Inter" by name).
- **Theme.** `<html>` starts with `data-theme="dark" data-density="regular"` (`layout.tsx:22`). An inline
  script applies `localStorage["dd-theme"]` before paint (`layout.tsx:25`, `src/lib/theme.tsx:44`).
  `ThemeProvider` reads the attribute back (`theme.tsx:17-20`), and `set` writes both the attribute and
  `localStorage["dd-theme"]` (`theme.tsx:22-30`).
- **Aliases.** UI primitives come from the `@devdigest/ui` barrel (`src/vendor/ui/index.ts:4-13`). The
  aliases are declared in `tsconfig.json:22-28` and `vitest.config.ts:8-12`.

## App shell, active repo, shortcuts

- **`AppShell`** combines the vendored `AppFrame`, `CommandPalette` and `ShortcutsHelp` and owns the
  breadcrumb state (`src/components/app-shell/AppShell.tsx:13-35`). The `(shell)` layout mounts it once; a
  page shows its breadcrumb with `useShellCrumb(crumb)`, which compares by value, updates in a layout effect
  and clears on unmount (`hooks/useShellCrumb.ts:17-25`). `/onboarding` has no shell: `AddRepoView` draws a
  full-screen card.
- **Shell context** (`useShellContext.ts:22-93`) supplies the active nav key from the path
  (`helpers.ts:26-40`), the repo switcher (select, add, remove with a confirm; `useShellContext.ts:33-60`),
  the theme toggle and the needs-review badge. The **command palette** offers "Go to …" for each nav
  item, plus Settings and the theme toggle (`useShellCommands.ts:20-47`).
- **Active repo.** `RepoProvider` picks it in this order: the `/repos/:id` path, then
  `localStorage["dd-repo"]`, then the first repo (`src/lib/repo-context.tsx:47-48`). `useRepoNotFound`
  turns true only after repos have loaded and the id matches none of them (`repo-context.tsx:69-72`).
- **Shortcuts.** Cmd/Ctrl+K opens the palette and `?` opens help; both ignore text inputs
  (`useGlobalShortcuts.ts:29-38`). `g` then `p` / `a` / `,` navigates if the second key comes within
  1200 ms (`useGlobalShortcuts.ts:39-52`, `constants.ts:4`, `src/vendor/ui/nav.ts:25-26,36`); the handler
  listens in the capture phase and stops the second key, so `g a` never reaches a page shortcut
  (`useGlobalShortcuts.ts:45-48,54`).
- **Finding shortcuts** `j`/`k`/`a`/`d` act only on a plain key press — no Cmd/Ctrl/Alt, not in a text field,
  no modal drawer or dialog open — and a held `a`/`d` fires once (`src/lib/shortcut-guards.ts:21-30`,
  `FindingsPanel.tsx:54-69`). With several Review runs open, only one panel listens: `FindingsTab` owns
  which runs are open and which one drives the keys — the last one opened, or a run that just finished
  (`PR/FindingsTab/useOpenRuns.ts:23-47`, `FindingsTab.tsx:138-142`).

## Known pitfalls

- **Shortcuts follow the last opened run.** Opening a run hands it the keys; closing it hands them to the
  first run still open (`useOpenRuns.ts:31-39`). A run that finishes while you work takes them too.
