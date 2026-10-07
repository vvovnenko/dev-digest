# DevDigest `client/`: how the rules map to this repo

## Contents
- Sources of truth
- Directory map
- Conventions this skill relies on
- Where other skills disagree with this repo
- Known deviations (don't copy them)
- Behaviour on the PR page that moved code must keep
- Imports and aliases

## Sources of truth

Read these before a structural change. When they disagree with this skill, they win:

- `client/CLAUDE.md`: conventions and naming.
- `client/docs/ui-architecture.md`: Server/Client boundary, providers, hooks and query
  keys, styling.
- `client/specs/`: what each page must keep showing. `client/specs/pages.md` is a
  contract ("change the code and this file in the same commit"), and it cites
  `file:line`. When your change moves cited lines, correct those citations in place in
  the same change, then re-check each new number against the edited file.
  `e2e/specs/flows.md` cites client lines too; treat it the same way.
- `client/INSIGHTS.md`: append-only. Write to it only through the `engineering-insights`
  skill's script, never edit it by hand. `CLAUDE.md` files only get lines added.

## Directory map

```
client/
├── messages/en/<namespace>.json   UI copy, one namespace per file (auto-loaded)
└── src/
    ├── app/                       routing (Next.js App Router)
    │   ├── layout.tsx             async server root: locale, messages, time zone, Inter (next/font), Providers
    │   ├── not-found.tsx · global-error.tsx   404 and last-resort error pages
    │   ├── onboarding/            the one screen outside the app frame
    │   ├── (shell)/               route group: every screen inside the app frame
    │   │   ├── layout.tsx         mounts AppShell once; pages set the crumb with useShellCrumb
    │   │   └── error.tsx          error boundary rendered inside the frame
    │   ├── <route>/page.tsx       thin server entry: generateMetadata + one client <Name>View
    │   ├── <route>/constants.ts   route-wide constants (optional)
    │   ├── <route>/helpers.ts     route-wide pure logic (optional)
    │   ├── <route>/styles.ts      route-level styles (optional)
    │   └── <route>/_components/<Name>/
    │       ├── <Name>.tsx         named export
    │       ├── index.ts           export { Name } from "./Name"
    │       ├── styles.ts          export const s = { … } satisfies …
    │       ├── constants.ts       UPPER_SNAKE module constants
    │       ├── helpers.ts         pure functions
    │       ├── <Name>.test.tsx    Vitest + RTL
    │       └── _components/…      private children of this component
    ├── components/<kebab-name>/   UI shared by 2+ routes (same inner layout; may have hooks/)
    ├── lib/
    │   ├── api.ts                 the only fetch; ApiError
    │   ├── hooks/<domain>.ts      TanStack Query hooks (core, agents, reviews, trace, repo-intel)
    │   ├── hooks/keys.ts          query-key factories for PR/run/PR-list data (prKeys, runKeys, repoKeys)
    │   ├── hooks/index.ts         export * barrel of the hook modules (accepted exception)
    │   ├── <purpose>.ts           shared modules: github-urls.ts, model-label.ts, finding-location.ts, format.ts
    │   ├── types.ts               contract re-exports + UI view models
    │   └── providers.tsx, theme.tsx, toast.tsx, repo-context.tsx   app-wide providers
    └── vendor/                    @devdigest/ui, @devdigest/shared (read-only)
```

There is no `utils/`, no `components/ui/`, no `features/` folder and no `hooks/` folder
at the top of `src/`. Don't create them. Their jobs are done by `src/lib/<purpose>.ts`,
`@devdigest/ui` and route colocation.

**Design tokens already exist.** `@devdigest/ui` (`src/vendor/ui/primitives/tokens.ts`)
exports these maps:

- `SEV`: severity → colour, background, icon, label.
- `CAT`: category → icon, label.

`FindingsPanel`, `FindingCard`, `FindingsSection` and `SeverityCounts` read `SEV`. Grep
the vendored kit before defining any colour, icon or label map. Note that `SEV` has four keys, including `INFO`,
while the contract's `Severity` has three.

## Conventions this skill relies on

- **Data.** Network calls go only through `src/lib/api.ts`, and data only through hooks
  in `src/lib/hooks/*`. The one exception is SSE in `useRunEvents`. Queries are named
  `use<Noun>` and mutations `use<Verb><Noun>`.
- **Keys and invalidation.** PR, run and PR-list keys come from `src/lib/hooks/keys.ts`
  (`prKeys.runs(prId)` → `["pr", prId, "runs"]`), so a prefix such as `prKeys.all(prId)`
  refreshes everything a PR shows. Other resources keep inline string-array keys. The
  mutation hook invalidates what it changes (`useRunReview`, `useCancelRun`,
  `useFindingAction` with an optimistic update); pages and components never call the
  query client.
- **Shell and pages.** `src/app/(shell)/layout.tsx` mounts `AppShell` once; a view calls
  `useShellCrumb([...])` for its breadcrumb. `page.tsx` is a server file with
  `generateMetadata` (titles from `shell.titles`) that renders one client
  `<Name>View`.
- **Dates.** Format through `src/lib/format.ts` (`useDateFormat`, the app's locale and time
  zone), never `toLocaleString()`.
- **Errors.** Mutations don't add `onError` toasts, because `src/lib/providers.tsx`
  already toasts globally.
- **Styles.** Use `style={s.x}` from a colocated `styles.ts` (`satisfies CSSProperties`,
  CSS variables). A style that takes arguments is a function: `s.pill(color, bg)`.
  `className` is only for `mono` and `tnum`. Tailwind is loaded but no utilities are
  used.
- **Contracts.** Import from `@devdigest/shared` with type-only imports. A runtime import
  breaks the webpack build.
- **Copy.** UI strings go in `messages/en/<ns>.json`. e2e flows match visible text, so
  changing copy can break `e2e-web`.
- **Tests.** Tests `vi.mock()` the hooks module and wrap components in
  `NextIntlClientProvider`. They don't mock `fetch`. Pure helpers need no mocks: test them
  in `helpers.test.ts`, which the include glob `src/**/*.test.{ts,tsx}` already picks up.

## Where other skills disagree with this repo

| Skill says | Here |
| --- | --- |
| `react-best-practices`: Tailwind utility classes, no inline `style={}` | `style={s.x}` from `styles.ts` |
| `react-best-practices`: shared utilities in `utils/` or `components/ui/` | `src/lib/<purpose>.ts`; primitives from `@devdigest/ui` |
| `react-best-practices`: `useApiQuery` / `useApiMutation`, Axios | named TanStack hooks in `src/lib/hooks`, over `fetch` in `api.ts` |
| `react-best-practices`: try/catch in async hook functions | global toasts in `providers.tsx`; no per-mutation `onError` toasts |
| `next-best-practices` data patterns: fetch in Server Components, pass as props | nothing fetches on the server; client hooks only |

The rest of those skills (rendering, hooks rules, effects, keys, accessibility,
file-convention mechanics) still applies.

## Known deviations (don't copy them)

This is a snapshot taken at skill version 1.0.0, extended in 1.1.0 and pruned in 1.3.0
after the wave-3 client refactor fixed most of it. Line numbers drift, so re-check with
grep before citing any of it. Treat these as debt to mention, not patterns to follow,
and don't fix them unless the task is about them. Paths below are under
`src/app/(shell)/repos/[repoId]/pulls/` unless they start with `src/`.

- **One concept, several definitions:**
  - Severity order: `[number]/_components/FindingsPanel/constants.ts`
    (`SEVERITY_ORDER`) vs `src/components/severity-counts/helpers.ts`
    (`SEVERITY_LEVELS`).
  - The needs-review count is computed twice: `countPulls` in `helpers.ts` and the
    sidebar badge (`src/components/app-shell/hooks/useShellContext.ts`).
    - This is pre-existing debt outside the PR route. A task on the PR list only
      mentions it and keeps its own count in the route's helpers.
    - Only a task about the badge or the count itself should merge them. The shared rule
      then goes to `src/lib`, because the shell is shared code.
- **Constants outside `constants.ts`.** Inside `helpers.ts` files
  (`src/components/severity-counts/helpers.ts` `SEVERITY_LEVELS`,
  `src/components/run-cost-badge/helpers.ts` `NO_DATA`) and inside `.tsx` files
  (`src/lib/toast.tsx` `COLORS`, `src/components/mermaid-diagram/MermaidDiagram.tsx`
  `MERMAID_RE`).
- **Inline styles.** `[number]/_components/RunHistory/RunHistory.tsx` still styles with
  `style={{…}}` instead of its own `styles.ts`.
- **Folder anomalies.** `src/components/diff-viewer/` has PascalCase subfolders and a
  logic module named `comments.ts`. `src/components/severity-counts/` holds two
  components.
- **Barrel styles vary.** There are `export { X }`, `export { X, X as default }`,
  `export { X, default }` and `export *`. New code uses `export { X } from "./X"`.

When a task touches one of these spots, fix the part you touch the right way. For
conflicting values, such as two colours for SUGGESTION, ask which one is correct rather
than picking silently.

**Keeping this list true is a separate step.** When your change fixes an item here, or
you find a new deviation others will trip over, say so in your answer: "fixes known
deviation X; the skill's list can drop it". Don't edit this skill's files, and don't
bump its version, inside a product change. A maintainer updates the list in its own
commit (PATCH bump, see `README.md` → Versioning), so product diffs stay about the
product.

## Behaviour on the PR page that moved code must keep

These were traps until the wave-3 refactor (eval round 3 missed the second one). They
are fixed now; a change that filters, re-keys or re-orders the Review runs list must
keep them fixed. The owner is `useOpenRuns` in
`[number]/_components/FindingsTab/useOpenRuns.ts`, tested in `useOpenRuns.test.ts`.

- **Open state lives in `FindingsTab`, keyed by review id.** `ReviewRunAccordion` is
  controlled (`open`, `onToggle`), so remounting or re-keying the accordions doesn't
  reopen runs. The newest review opens on first load, and so does one that arrives later.
- **One run takes the keys.** Only the run passed `shortcutsActive` (the last one opened)
  mounts `FindingsPanel`'s j/k/a/d listener, however many runs are open. The global
  `g`-chord handler runs in the capture phase and stops the chord's second key, so
  `g a` never accepts a finding (`src/components/app-shell/hooks/useGlobalShortcuts.ts`).
- **A Timeline jump scrolls once.** `jumpTo` opens the run and sets a nonce; the
  accordion scrolls on a non-zero `scrollNonce` and calls `onScrolled`, which clears it,
  so a remount doesn't scroll back to an old target.

## Imports and aliases

- `@/*` maps to `src/*`. It is declared in both `tsconfig.json` and `vitest.config.ts`,
  so change both together.
- Use a relative import inside a component folder or to a direct parent
  (`../constants`). Use `@/…` to cross into another branch of the tree (`@/lib/hooks`,
  `@/components/app-shell`).
- Don't write new `../../../../lib/…` chains. The wave-3 move into `(shell)/` rewrote
  the old ones to `@/…`; the two deep relative imports left point at the agents route's
  own `constants.ts` (`PROVIDER_OPTIONS`), a route-rung import.
- UI primitives come only through the `@devdigest/ui` barrel.
