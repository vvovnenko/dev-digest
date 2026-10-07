# Before/after on real DevDigest code

Each example names the rule it applies. Paths are relative to `client/src/`. The
"before" code comes from the repo as of skill version 1.0.0. The wave-3 client refactor
(skill 1.3.0) applied examples 1–3 and moved the routes into the `app/(shell)/` group;
each of those examples ends with where the result lives now. They stay here as worked
examples of the rules, not as tasks.

## Contents
1. Logic inline in a page → route helpers + unit test
2. The same formatter in two trees → one shared module
3. One concept, two conflicting maps → reuse the design system's map, and ask about the value
4. A new route-local component → where each part goes
5. A fully interactive screen → a thin server page plus a client view
6. A "hook" that calls no hooks → a helper

## 1. Logic inline in a page → route helpers + unit test

*Rules: route files stay thin; business logic lives in pure functions; one definition
per concept.*

**Before.** In `app/repos/[repoId]/pulls/page.tsx` (1.0.0), the page body filters, searches,
sorts and counts. A constant also sits in the page, although `constants.ts` and
`helpers.ts` are right next to it:

```tsx
const OPEN_STATUSES = new Set(["needs_review", "reviewed", "stale"]);
// … inside PullsPage():
const q = query.trim().toLowerCase();
const filtered = (pulls ?? [])
  .filter((p) => status === "all" || p.status === status)
  .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q))
  .slice()
  .sort((a, b) => {
    const ta = Date.parse(a.updated_at ?? "") || 0;
    const tb = Date.parse(b.updated_at ?? "") || 0;
    return sort === "oldest" ? ta - tb : tb - ta;
  });
const openCount = (pulls ?? []).filter((p) => OPEN_STATUSES.has(p.status)).length;
const needsReviewCount = (pulls ?? []).filter((p) => p.status === "needs_review").length;
```

**After.** The constant moves to the route's `constants.ts`:

```ts
// app/repos/[repoId]/pulls/constants.ts  (added)
/** Open PRs carry a derived review status; everything else is merged/closed. */
export const OPEN_STATUSES: ReadonlySet<string> = new Set(["needs_review", "reviewed", "stale"]);
```

The rules move to the route's `helpers.ts`, next to the existing `sizeOf` and
`relativeTime`:

```ts
// app/repos/[repoId]/pulls/helpers.ts  (added next to sizeOf / relativeTime)
export function filterPulls(pulls: PrMeta[], status: string, query: string): PrMeta[] {
  const q = query.trim().toLowerCase();
  return pulls
    .filter((p) => status === "all" || p.status === status)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || String(p.number).includes(q));
}

/** Newest first unless `order` is "oldest"; PRs without a date sort as oldest. */
export function sortPulls(pulls: PrMeta[], order: string): PrMeta[] {
  const time = (p: PrMeta) => Date.parse(p.updated_at ?? "") || 0;
  return [...pulls].sort((a, b) => (order === "oldest" ? time(a) - time(b) : time(b) - time(a)));
}

export function countPulls(pulls: PrMeta[]): { open: number; needsReview: number } {
  return {
    open: pulls.filter((p) => OPEN_STATUSES.has(p.status)).length,
    needsReview: pulls.filter((p) => p.status === "needs_review").length,
  };
}
```

The page now only composes:

```tsx
// page.tsx — now only composes
const all = pulls ?? [];
const filtered = sortPulls(filterPulls(all, status, query), sort);
const counts = countPulls(all);
```

The helpers get their own test:

```ts
// app/repos/[repoId]/pulls/helpers.test.ts  (new; no rendering, no mocks)
import { describe, expect, it } from "vitest";
import type { PrMeta } from "@/lib/types";
import { filterPulls, sortPulls } from "./helpers";

const pr = (o: Partial<PrMeta>) => ({ number: 1, title: "", status: "needs_review", updated_at: null, ...o }) as PrMeta;

describe("filterPulls", () => {
  it("matches the title or the number", () => {
    const list = [pr({ number: 7, title: "Fix login" }), pr({ number: 42, title: "Docs" })];
    expect(filterPulls(list, "all", "login").map((p) => p.number)).toEqual([7]);
    expect(filterPulls(list, "all", "42").map((p) => p.number)).toEqual([42]);
  });
});

describe("sortPulls", () => {
  it("puts the newest first by default and does not mutate the input", () => {
    const list = [pr({ number: 1, updated_at: "2026-01-01" }), pr({ number: 2, updated_at: "2026-02-01" })];
    expect(sortPulls(list, "newest").map((p) => p.number)).toEqual([2, 1]);
    expect(list.map((p) => p.number)).toEqual([1, 2]);
  });
});
```

These are helpers, not a hook, because nothing here calls React. They stay at route
level because only this route uses them.

**Applied.** `app/(shell)/repos/[repoId]/pulls/helpers.ts` now has `filterPulls`,
`sortPulls` (typed `SortKey`), `parseSort` and `countPulls`, with
`helpers.test.ts` beside it; `OPEN_STATUSES` is in `constants.ts`. The page became a thin
server file and the screen `_components/PullsListView/`, which also keeps search and sort
in the URL (`?q=`, `?sort=`).

The sidebar badge (`components/app-shell/hooks/useShellContext.ts`) also counts
needs-review PRs. That duplication already existed and lives outside this route, so the
refactor mentions it in the answer and leaves the shell alone. Merging the two counts is a
separate task.

## 2. The same formatter in two trees → one shared module

*Rules: promote when a second consumer appears; shared code can't import from a route;
name modules by purpose.*

**Before.** The same function is copied into
`app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx`
(route-local) and `components/diff-viewer/CommentCard/CommentCard.tsx` (shared), as of
1.0.0:

```ts
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
```

**After.** The consumers are a route component and a shared component. A shared
component may not import from `src/app`, so the only rung that covers both is
`src/lib`:

```ts
// lib/format-date.ts  (new — named for its purpose, not utils.ts)
/** Locale date-time for an ISO timestamp; returns the input unchanged if it isn't a date. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
```

Both files then `import { formatDateTime } from "@/lib/format-date"`. The PR list's
`relativeTime` ("3h", "2d") is a different format with one consumer, so it stays in
`pulls/helpers.ts`.

**Applied, one step further.** The shared module became `lib/format.ts`: `useDateFormat`
formats through next-intl's `useFormatter`, so dates use the app's locale and time zone
on server and client alike instead of the browser's `toLocaleString()`. It calls a hook,
so it is a hook; `DATE_TIME` and `TIME` are its option constants. `ReviewRunAccordion`,
`CommentCard` and `RunHistory` use it.

## 3. One concept, two conflicting maps → reuse the design system's map, and ask about the value

*Rules: look in the design system first; one definition per concept.*

**Before.** Two local severity colour maps disagree on SUGGESTION:

```ts
// …/_components/FindingCard/constants.ts
export const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)", WARNING: "var(--warn)", SUGGESTION: "var(--sugg)", INFO: "var(--info)",
};
// …/RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx
const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)", WARNING: "var(--warn)", SUGGESTION: "var(--accent)",
};
```

**First, look for an existing owner.** The design system already defines the concept,
and `FindingsPanel` and `SeverityCounts` already use it:

```ts
// vendor/ui/primitives/tokens.ts (read-only), exported by @devdigest/ui
export const SEV: Record<Severity, { c: string; bg: string; icon: IconName; label: string }> = {
  CRITICAL: { c: "var(--crit)", … }, WARNING: { c: "var(--warn)", … },
  SUGGESTION: { c: "var(--sugg)", … }, INFO: { c: "var(--info)", … },
};
```

**After.** Both consumers read `SEV[severity].c` from `@devdigest/ui`. Both local maps
are deleted, and `FindingCard/constants.ts` goes too if nothing else is left in it. No
third map is created. A new app-level `SEVERITY_COLOR` would just be one more copy to
drift.

```tsx
import { SEV } from "@devdigest/ui";
// FindingsSection: severity arrives as stored text, so keep a guard for unknown values
const color = SEV[f.severity as keyof typeof SEV]?.c ?? "var(--text-muted)";
```

- **Still ask about the value.** Moving to `SEV` changes FindingsSection's SUGGESTION
  from `--accent` to `--sugg`. Today both tokens have the same hex in both themes
  (`vendor/ui/styles.css`), so nothing looks different. Say that, and ask whether
  `--sugg` is the intended token rather than switching silently.
- **Keep the defensive fallback** where data comes from the server as plain text.
  Removing it is a behaviour change, not a refactor.
- **Only when the design system has no such map** do you create one: in the shared
  module that owns the concept, typed `Record<Severity, …>`.

**Applied.** `FindingCard.tsx` and `RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx`
read `SEV[…].c` with a `var(--text-muted)` fallback, and `FindingCard/constants.ts` is
gone. The same change moved the line label to one owner, `lib/finding-location.ts`
(`lineLabel`).

## 4. A new route-local component → where each part goes

*Task shape: "add agent and status filter chips above the Review runs list on the PR
page."*

```
app/(shell)/repos/[repoId]/pulls/[number]/_components/RunFilters/
├── RunFilters.tsx       chips; receives options + selection + onChange as props
├── index.ts             export { RunFilters } from "./RunFilters"
├── constants.ts         RUN_STATUS_FILTERS = [{ key: "all", labelKey: "all" }, …] as const
├── helpers.ts           filterRuns(runs, { agentId, status }) — pure
├── helpers.test.ts
├── styles.ts            export const s = { bar: { … } satisfies CSSProperties, … }
└── RunFilters.test.tsx  wraps in NextIntlClientProvider; mocks @/lib/hooks if needed
```

- **Data.** Reuse the query the tab already uses. `RunFilters` doesn't fetch, and a new
  endpoint call would be a hook in `lib/hooks/reviews.ts`.
- **State.** The selection belongs to the lowest parent that renders both the chips and
  the list. If it must survive reload or be shareable, put it in the URL, as the PR list
  does with `?status=`, `?q=` and `?sort=`.
- **Behaviour to keep.** Filtering re-renders the accordions; open state and the
  shortcut target live in `FindingsTab`'s `useOpenRuns`, keyed by review id, so a filter
  must not reset them or reopen runs (see `devdigest.md` → Behaviour on the PR page).
- **Copy.** Labels go in `messages/en/prReview.json`, and `constants.ts` holds only the
  label keys.
- **Styles.** `style={s.x}`, no Tailwind classes. Chips come from `@devdigest/ui`.

## 5. A fully interactive screen → a thin server page plus a client view

*Rule: put the client boundary as low as possible; page files only compose.*

`app/(shell)/agents/page.tsx`, as it is today:

```tsx
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AgentsListView } from "./_components/AgentsListView";

/* Route: /agents (Agents list). Thin route entry — the view, its create modal,
   styles, constants, helpers and i18n are colocated under _components/AgentsListView. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("agents") };
}

export default function AgentsPage() {
  return <AgentsListView />;
}
```

The page stays a Server Component, so it can also export `generateMetadata` (the tab
title). `"use client"` sits in `AgentsListView`, and the list filtering lives in
`AgentsListView/helpers.ts` (`filterAgents`). Since wave 3 every route follows this shape
(`HomeView`, `AgentEditorView`, `SettingsView`, `PullsListView`, `PrDetailView`,
`AddRepoView`); new screens do too rather than putting `"use client"` on `page.tsx`
with the whole screen inline.

## 6. A "hook" that calls no hooks → a helper

*Rule: a function is a hook only if it calls hooks.*

```ts
// ✗ named like a hook, but it is a pure transformation
export function useVisibleFindings(findings: FindingRecord[], hideLow: boolean) {
  return findings.filter((f) => !hideLow || f.confidence >= LOW_CONFIDENCE_THRESHOLD);
}

// ✓ what FindingsPanel actually does: a pure helper in FindingsPanel/helpers.ts
export function visibleFindings(findings: FindingRecord[], hideLow: boolean, severity: Severity | null = null) { … }
// …called during render in FindingsPanel.tsx
```

The `use` prefix tells readers and the linter that Rules of Hooks apply. A pure function
with that prefix can't be called in a loop or a condition for no reason, and it hides
the fact that it is trivially testable.
