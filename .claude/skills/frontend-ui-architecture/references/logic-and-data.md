# Logic and data: layers, hooks, constants, helpers, state, types

## Contents
- The layers
- Business logic as pure functions
- Custom hooks
- Constants and configuration
- Helpers vs utils vs lib
- Classifying state
- The server-data layer
- Types
- Sources

## The layers

```
component         renders; wires events to handlers
   ↓ calls
hook              React glue: useState/useQuery/handlers, returns what the view needs
   ↓ calls
domain functions  pure rules: filter, sort, count, derive, validate, format
   ↓ (hooks only) calls
API layer         src/lib/api.ts + query/mutation hooks in src/lib/hooks
```

Calls only go downwards. A component may call a domain function directly for render-time
derivations, with no hook needed. Domain functions never import React, hooks or the API
client. That keeps them testable in isolation and reusable anywhere.

You don't need every layer on day one. Start with a component and a helper. Add a hook
when state or queries need to be shared between the component and something else.

Sources: A19, B1, B3, B23.

## Business logic as pure functions

Business logic is any rule about the domain: which findings are visible, how a PR's size
is bucketed, what counts as "open". Keep it in named functions that take data and return
data:

```ts
// pulls/helpers.ts
export function filterPulls(pulls: PrMeta[], status: string, query: string): PrMeta[] { … }
export function sortPulls(pulls: PrMeta[], order: "newest" | "oldest"): PrMeta[] { … }
```

- **No hidden inputs.** Pass what the function needs. Don't read the URL, context or
  `Date.now()` inside it unless that is its explicit job; accept `now` as a parameter so
  tests are deterministic.
- **Don't mutate inputs.** Return new arrays (`[...xs].sort(…)`).
- **Derived values are computed, not stored.** If a value can be computed from props,
  state or query data, compute it during render (through the helper). Don't copy it into
  `useState` and sync it with `useEffect`. Reach for `useMemo` only when the computation
  is measurably expensive.
- **User-caused logic goes in event handlers.** Effects are for synchronizing with
  external systems.

Sources: B2, B3, B23.

## Custom hooks

- A function is a hook **only if it calls hooks**. `useSortedFindings` that only sorts is
  a helper named `sortFindings`.
- Hooks share *stateful logic*, not state: two components calling `useX()` get
  independent state. Shared state needs a single owner, such as a parent, the URL, a
  context or the query cache.
- Write hooks for concrete use cases (`useRunFilters`, `usePrRuns`). Avoid generic
  lifecycle wrappers (`useMount`, `useUpdateEffect`).
- **Where they live:**
  - Server-data hooks go in `src/lib/hooks/<domain>.ts`.
  - A UI hook used by one component stays in its folder (a `use<Name>.ts` file beside
    it).
  - UI hooks of a shared component go in its `hooks/` subfolder.
- Some duplication between hooks is fine. Extract a shared hook when the duplicated logic
  is a real concept, not just similar-looking lines.

Sources: A8, B1, B20.

## Constants and configuration

- **Module level, not in the component body.** Values that don't depend on props or
  state move outside the component. They are then allocated once, have a name, and can be
  imported by tests.
- **Location follows the ladder:** the component's `constants.ts`, then the route's
  `constants.ts`, then the shared module that owns the concept. For example, severity
  ordering belongs with the shared severity helpers.
- **One definition per concept.** Colour maps, sort orders, thresholds and label maps
  drift when copied. Grep before adding, and import the existing one. When merging
  copies that disagree, keep the existing owner and ask the user which value is right.
  Don't pick one silently, even when the difference is invisible today.
- **Design system first.** Tokens that describe how a concept looks, such as severity
  colours, icons and labels, usually already exist in the design system. Reuse them
  there, and don't wrap them in an app-level copy. Create an app map only for a concept
  the design system doesn't cover.
- **Naming.** Use `UPPER_SNAKE_CASE` for module-level immutable values. Use camelCase for
  anything computed per call.
- **Types that catch drift.** Prefer `as const` objects and union types to `enum`, and
  never `const enum`. Type lookup tables as `Record<Severity, …>` rather than
  `Record<string, …>`, so adding a member to the union breaks the build in every map that
  forgot it.
- **Not constants:**
  - UI text goes to `messages/`.
  - Environment values: read once in a config module and export typed values. Only
    `NEXT_PUBLIC_*` variables reach the browser, and they are frozen at build time.
  - Values derived from data should be computed.

Sources: B2, B9, B11, B25, B26.

## Helpers vs utils vs lib

| Term | What | Where |
| --- | --- | --- |
| helper | pure function tied to one component or route (knows its data shapes) | `helpers.ts` beside that component or `page.tsx` |
| shared module | pure function reused across routes or shared components | `src/lib/<purpose>.ts` |
| generic util | no domain knowledge (dates, numbers, strings, arrays) | still `src/lib/<purpose>.ts`, e.g. `format-date.ts` |
| library wrapper | configures a third-party library once | `src/lib/<library-or-purpose>.ts` |

- **Name by purpose, never by kind.** `utils.ts`, `helpers/index.ts` and `common.ts`
  become dumping grounds that everything imports and nobody owns.
- **Promote with the ladder.** A helper moves to `src/lib` when a second route or a
  shared component needs it, because a shared component cannot import from a route.
- **Test pure functions directly** in `helpers.test.ts` / `<purpose>.test.ts`. They need
  no rendering and no mocks, so they are the cheapest tests in the codebase.

Sources: A12, A15, A16, B22.

## Classifying state

Give each piece of state exactly one owner:

| Kind | Owner | Why |
| --- | --- | --- |
| Server data (anything the API returns) | TanStack Query cache via hooks | caching, refetch, invalidation; copying it into `useState` stops background updates |
| Shareable or restorable UI state (filters, tab, sort, page) | URL search params | survives reload, shareable, back button works |
| Local UI state (open, hover, draft input) | `useState` in the lowest component that needs it | the smallest re-render scope |
| State shared by siblings | the closest common parent | one owner, passed down |
| Cross-tree app state (theme, active repo, toasts) | a context provider plus a `useX` hook that throws outside the provider | explicit dependency; the context object stays private |
| Form state | local state or a form library | validation at submit |

Keep state minimal:

- Store an id, not a copy of the selected object.
- Use one `status` union rather than several booleans that can contradict each other.
- Don't keep what you can derive.

Sources: B4, B15, B20, B21.

## The server-data layer

- **One client.** All HTTP goes through one module (`src/lib/api.ts`), which owns the
  base URL, headers, JSON handling and error shape.
- **Hooks grouped by domain.** One file per resource area (`core`, `agents`, `reviews`,
  …) holds that area's queries and mutations. There is one place per query key.
- **Keys.** Order them from generic to specific, starting with the resource name. Include
  every variable the `queryFn` uses, or the cache will serve stale data for new inputs.
  When several queries must be invalidated together, build their keys from one factory so
  they share a prefix: DevDigest's `src/lib/hooks/keys.ts` gives every PR query
  `["pr", prId, …]` (`prKeys.runs(prId)`), so `invalidateQueries({ queryKey:
  prKeys.all(prId) })` refreshes the PR's detail, reviews, runs and comments. Resources
  with a single query keep an inline key (`["settings"]`). A `queryOptions` factory is a
  valid alternative in projects that use it; don't mix it with key factories.
- **Invalidation belongs to the mutation hook** (`onSuccess: invalidateQueries …`), so
  every caller gets it. Components don't reach into the query client. An optimistic
  update also lives there (`onMutate` sets the cache, `onError` restores it, `onSettled`
  refetches): see `useFindingAction` in `src/lib/hooks/reviews.ts`.
- **Where to reshape data:**
  - Prefer the backend.
  - Field renames or DTO → view-model mapping go in the fetcher or hook.
  - Per-view subsets and derivations go in `select` or a helper called in render.
  - Never reshape ad hoc inside JSX.
- **Type the fetcher, not the hook generics.** The return type of `api.get<T>()` flows
  through `useQuery`. Validating responses with a schema at the boundary turns "trust me"
  generics into real checks.

Sources: B10, B15, B16, B17, B18, B21.

## Types

- A type used once lives in the file that uses it.
- A type shared by a component's files goes in that folder (in `constants.ts` next to the
  values it describes, or a `types.ts` if it grows). A type shared across the app goes in
  the narrowest common module.
- API contracts come from the shared contract package with type-only imports. Derive
  variants with `Pick`, `Omit` or `Partial` instead of redefining fields by hand, so
  contract changes surface at compile time.
- When a Zod schema exists, infer the type from it (`z.infer<typeof X>`) so the schema
  stays the single source of truth.
- UI view models (the shapes a screen renders) are separate from contracts and live next
  to the mapping that produces them.

Sources: B12, B18, B24.

## Sources

IDs refer to the catalog in the skill's `README.md`.
