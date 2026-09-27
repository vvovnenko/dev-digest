# DevDigest `client/`: how the rules map to this repo

## Contents
- Sources of truth
- Directory map
- Conventions this skill relies on
- Where other skills disagree with this repo
- Known deviations (don't copy them)
- Behaviour traps on the PR page
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
    │   ├── layout.tsx             async server root: locale, messages, Providers
    │   ├── <route>/page.tsx       thin entry; most are client pages
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
    │   ├── hooks/index.ts         export * barrel of the hook modules (accepted exception)
    │   ├── <purpose>.ts           shared pure modules: github-urls.ts, model-label.ts
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

`FindingsPanel` and `SeverityCounts` already read `SEV`. Grep the vendored kit before
defining any colour, icon or label map. Note that `SEV` has four keys, including `INFO`,
while the contract's `Severity` has three.

## Conventions this skill relies on

- **Data.** Network calls go only through `src/lib/api.ts`, and data only through hooks
  in `src/lib/hooks/*`, which use inline string-array keys. The one exception is SSE in
  `useRunEvents`. Queries are named `use<Noun>` and mutations `use<Verb><Noun>`.
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

This is a snapshot taken at skill version 1.0.0 and extended in 1.1.0. Line numbers
drift, so re-check with grep before citing any of it. Treat these as debt to mention, not patterns to follow, and
don't fix them unless the task is about them.

- **Logic inline in pages.** `src/app/repos/[repoId]/pulls/page.tsx` filters, searches,
  sorts and counts PRs in the page body, although `helpers.ts` sits next to it.
  `pulls/[number]/page.tsx` also derives run ids and findings inline.
- **One concept, several definitions:**
  - Severity colours: `FindingCard/constants.ts` (`SUGGESTION: var(--sugg)`) vs
    `RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx`
    (`SUGGESTION: var(--accent)`). Both duplicate `SEV` from `@devdigest/ui`. `--sugg`
    and `--accent` currently have the same hex in both themes, so the conflict isn't
    visible yet.
  - Verdict colours: `ReviewRunAccordion.tsx` (`comment: var(--warn)`) vs
    `VerdictBanner/constants.ts` (`comment: var(--info)`).
  - Severity order: `FindingsPanel/constants.ts` vs
    `src/components/severity-counts/helpers.ts`.
  - `formatWhen` is copied in `ReviewRunAccordion.tsx` and
    `src/components/diff-viewer/CommentCard/CommentCard.tsx`.
  - The finding line label ("11" or "61-74") exists three times:
    - `lineLabel` in `FindingCard/helpers.ts`;
    - `lineLabel` in `src/components/severity-counts/helpers.ts`;
    - inline JSX in `RunTraceDrawer/_components/FindingsSection/FindingsSection.tsx`.
  - The needs-review count is computed twice: in `pulls/page.tsx` and in the sidebar badge
    (`src/components/app-shell/hooks/useShellContext.ts`).
    - This is pre-existing debt outside the PR route. A task on the PR list only
      mentions it and keeps its own count in the route's helpers.
    - Only a task about the badge or the count itself should merge them. The shared rule
      then goes to `src/lib`, because the shell is shared code.
- **Constants outside `constants.ts`.** `pulls/page.tsx` (`OPEN_STATUSES`),
  `agents/[id]/page.tsx` (`VALID_TABS`), inside `.tsx` files (`VERDICT_COLOR`,
  `SEV_COLOR`) and inside `helpers.ts` files.
- **Inline styles.** Older ports style with `style={{…}}` or module-level
  `CSSProperties` objects instead of a `styles.ts`: `RunHistory`, `ReviewRunAccordion`,
  `AddRepoView`.
- **Folder anomalies.** `RunHistory/` has no `index.ts` and is imported by deep path.
  `components/diff-viewer/` has PascalCase subfolders and a logic module named
  `comments.ts`. `components/severity-counts/` holds two components.
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

## Behaviour traps on the PR page

Check these when a change filters, re-keys or re-orders the Review runs list. Both the
skill run and the baseline missed the second one in eval round 3.

- **Scroll on mount.** `ReviewRunAccordion` opens and scrolls to the Timeline's
  `targetRunId` in an effect that also runs on mount. A remounted run scrolls back to an
  old jump target unless the target is cleared when the list changes.
- **Open state is set once.** Open state comes from `defaultOpen` at mount only.
  `FindingsTab` passes `defaultOpen={i === 0}`, so after filtering, the new first run
  mounts open while a run the user opened earlier stays open.
- **One key press, two actions.** Every open run mounts a `FindingsPanel` with its own
  `window` keydown listener for j/k/a/d, so one key press acts on each open panel. Keep
  at most one run open, for example by resetting open state or re-keying the list on
  filter change, and test it.

## Imports and aliases

- `@/*` maps to `src/*`. It is declared in both `tsconfig.json` and `vitest.config.ts`,
  so change both together.
- Use a relative import inside a component folder or to a direct parent
  (`../constants`). Use `@/…` to cross into another branch of the tree (`@/lib/hooks`,
  `@/components/app-shell`).
- Don't write new `../../../../lib/…` chains. Don't mass-rewrite old ones either: about
  40 exist.
- UI primitives come only through the `@devdigest/ui` barrel.
