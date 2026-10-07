# client (`@devdigest/web`) — agent notes

Next.js 15 studio on :3000. **pnpm**.

Stack: TypeScript 5.7 · Next.js 15 (App Router) · React 19 · TanStack Query 5 · next-intl 3 ·
Zod 3 (types only) · lucide-react · recharts · react-markdown + remark-gfm · mermaid · Tailwind 4
(loaded by the vendored UI CSS; components style with `style={s.x}`) · Vitest 2 + RTL 16 + jsdom.

## Commands

```sh
pnpm dev          # next dev -p 3000
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest + jsdom — no API needed (there is no lint script)
pnpm lint         # eslint + type-aware typescript-eslint (warn-only) — added in wave 4
pnpm coverage     # v8 report, no thresholds
```

## Conventions

- Route-local UI lives in `_components/<Name>/` (`<Name>.tsx`, `index.ts`, plus
  optional `styles.ts` · `constants.ts` · `helpers.ts` · `<Name>.test.tsx`).
  Components shared across routes go in `src/components/<kebab-name>/`.
- Network calls only through `src/lib/api.ts`; data only through hooks in
  `src/lib/hooks/*` (TanStack Query, inline string-array keys). The one exception
  is SSE in `useRunEvents`.
- PR/run query keys come from `src/lib/hooks/keys.ts` (prefix invalidation); the
  mutation hook invalidates what it changes — pages and components don't.
- Every screen but onboarding sits in `src/app/(shell)/`: its layout mounts `AppShell`
  once, a page sets its breadcrumb with `useShellCrumb`; `page.tsx` is a server file
  (title via `generateMetadata` + `shell.titles`) rendering a client `<Name>View`.
- Don't add `onError` toasts to mutations — `src/lib/providers.tsx` already
  toasts globally, so you get two.
- `meta: { silent: true }` skips that global toast — only for background mutations whose
  failure is expected (`useAutoSyncPulls`). The PR list GET only reads; `useSyncPulls` imports.
- Styling is `style={s.x}` from a colocated `styles.ts` (`satisfies
  CSSProperties`, CSS variables). `className` only for the `mono`/`tnum` utilities.
- UI strings go in `messages/en/<ns>.json`; every file there is auto-loaded as a
  namespace (`src/i18n/request.ts`).
- Import **types only** from `@devdigest/shared` — a runtime import breaks the
  webpack build. That is why `src/lib/feature-models.ts` is a hand-synced copy.
- Aliases are declared twice, in `tsconfig.json` and `vitest.config.ts` — change
  both.

## Naming

- Components: route-local `_components/<Pascal>/<Pascal>.tsx` (may nest `_components/`),
  shared `src/components/<kebab>/<Pascal>.tsx`; tests `<Pascal>.test.tsx` beside the component.
- Hooks: `src/lib/hooks/<kebab>.ts`; queries `use<Noun>` (`usePrRuns`), mutations
  `use<Verb><Noun>` (`useDeleteRun`, `useCancelRun`).
- i18n: one namespace per `messages/en/<camelCase>.json`; keys are nested camelCase
  (`prReview` → `finding.suggestedFix`).
- Styles: each `styles.ts` exports `const s`; a style with arguments is a function (`s.pill(color, bg)`).

## Gotchas

- Tests do **not** mock `fetch` (README says they do): they `vi.mock()` the hooks
  module and wrap components in `NextIntlClientProvider`.
- Since 2026-09-29 the README agrees; the data-layer tests (`src/lib/hooks/*.test.tsx`) mock
  `src/lib/api.ts` under a real `QueryClient` instead of the hooks.
- `NEXT_PUBLIC_API_BASE` is baked in at build time — restart/rebuild after
  changing it.
- There are no `data-testid`s — e2e flows match visible text, so changing copy
  can break `e2e-web`.
- 12 of 18 `messages/en/*.json` namespaces have no screen yet — pre-staged for
  later lessons, not dead code.
- Since L02 `skills` has a screen (the Skills Lab), so 11 of 18 have none — supersedes the count above.
- Since HW2 `conventions` has a screen too (`/repos/:repoId/conventions`), so 10 of 18 have none.

## Do not touch

(Root `CLAUDE.md` covers `src/vendor/**`, lockfile, `.env`.)

- `next-env.d.ts` — generated. Import UI primitives only via the `@devdigest/ui` barrel.

## Read when

- Read [`INSIGHTS.md`](INSIGHTS.md) before starting; append what you learned at
  the end.
- Write to `INSIGHTS.md` only through the `engineering-insights` skill — it
  appends and never edits existing entries.
- Read [`specs/`](specs/README.md) before building a UI feature.
- Use the `frontend-ui-architecture` skill before creating, moving or splitting a component, hook, helper or constants file.
- Read [`docs/`](docs/README.md) before changing data fetching, the app shell or i18n.
- Read [`docs/ui-architecture.md`](docs/ui-architecture.md) before moving a Server/Client
  Component boundary, adding a hook, or touching providers, i18n or styling.
- Read [`specs/pages.md`](specs/pages.md) before changing a route, a tab, or copy an e2e flow asserts.
- Read [`README.md`](README.md) (UI route map ↔ endpoints) when adding a page or a hook.
- Read [`src/vendor/ui/README.md`](src/vendor/ui/README.md) when using or adding UI primitives.
- Read [`../server/README.md`](../server/README.md) when you need an endpoint's exact shape.
- Read [`../e2e/README.md`](../e2e/README.md) when changing copy or routes that flows use.
