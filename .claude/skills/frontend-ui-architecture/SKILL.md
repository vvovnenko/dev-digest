---
name: frontend-ui-architecture
description: Decides where frontend code lives and how it is split in a React + Next.js App Router codebase — route-local vs shared components, when to split a component, and where constants, helpers, utils, custom hooks, types, business logic and API/query code belong, plus the Server/Client Component boundary. Use whenever creating, moving, splitting or reviewing a component, page, layout, hook, helper, constants or types file in client/, or when choosing between inline code, helpers.ts, src/lib and a hook — even if the request only says "add a filter to this page", "clean up this component" or "where should this go". Architecture and code organization only; rendering rules, hooks correctness and performance belong to react-best-practices, Next.js file-convention and API details to next-best-practices.
metadata:
  version: "1.3.0"
---

# Frontend UI architecture

Where code goes and how it is cut into modules in a React 19 + Next.js App Router +
TanStack Query app. The goal is a codebase where a reader can guess a file's location
before searching, and where a change touches one place instead of five.

**Precedence.** A project's written conventions beat this skill, and this skill beats
generic advice. In DevDigest, `client/CLAUDE.md` comes first. Neighbouring skills own
their topics and are not repeated here: `react-best-practices` (rendering, hooks rules,
memoization, performance) and `next-best-practices` (file-convention and API mechanics).

## In this repo (DevDigest `client/`) — read first

| Code | Lives in |
| --- | --- |
| Route entry | `src/app/**/page.tsx`: a thin server file (`generateMetadata`) rendering one client `<Name>View`, which reads params, calls hooks and composes. Screens inside the app frame sit in the `src/app/(shell)/` group, whose `layout.tsx` mounts the shell once |
| UI used by one route | `src/app/<route>/_components/<Name>/`, which may nest its own `_components/` |
| A component folder | `<Name>.tsx` + `index.ts`, and when needed `styles.ts` · `constants.ts` · `helpers.ts` · `<Name>.test.tsx` |
| Non-UI code for a whole route | `constants.ts` / `helpers.ts` / `styles.ts` next to that `page.tsx` |
| UI used by 2+ routes | `src/components/<kebab-name>/<Pascal>.tsx`, same optional files |
| Primitives (Button, Card, Chip…) and design tokens (`SEV`, `CAT`) | `@devdigest/ui`, vendored and read-only. Reuse before defining your own |
| Shared non-UI logic | `src/lib/<purpose>.ts`, named for what it does (`github-urls.ts`, `model-label.ts`) |
| Server data | query/mutation hooks in `src/lib/hooks/<domain>.ts` over `src/lib/api.ts`, the only network path; PR/run keys from `src/lib/hooks/keys.ts` |
| UI-only hooks of a shared component | colocated, e.g. `src/components/app-shell/hooks/` |
| Types | contracts via type-only imports from `@devdigest/shared`; UI view models in `src/lib/types.ts` or colocated |
| UI copy | `messages/en/<namespace>.json` |
| Styles | a colocated `styles.ts` exporting `const s`, used as `style={s.x}` |

`react-best-practices` mentions Tailwind utilities instead of `style={}`, `utils/`,
`components/ui/`, `useApiQuery` and Axios. None of these exist here, so follow the table.
Full mapping, the known deviations and how to treat them are in
[references/devdigest.md](references/devdigest.md).

## Principles

1. **Colocate first, promote late.** Code lives next to its only consumer and moves up
   when a second consumer appears. A premature shared abstraction costs more than a small
   duplicate.
2. **Dependencies point one way.** Routes import shared code (`src/lib`,
   `src/components`, `@devdigest/ui`). Shared code never imports from `src/app`, and one
   component never imports from a sibling component's folder.
3. **Route files stay thin.** `page.tsx` reads params, calls hooks and composes.
   Filtering, sorting, counting and mapping go to helpers that can be unit-tested.
4. **Components render; logic lives in plain functions.** Business rules are pure
   TypeScript functions. Hooks connect them to React.
5. **One owner per kind of state.** Server data belongs to TanStack Query, shareable UI
   state to the URL, and local UI state to the lowest component that needs it.
6. **Consistency beats preference.** Where the codebase already has a pattern, follow it.
   Propose a different one separately.

## Where does this code go?

**First, check whether it already exists.** Grep for the concept: a colour map, an order,
a formatter, a primitive. Look in the design system first (`@devdigest/ui` exports
primitives and tokens such as `SEV` and `CAT`), then `src/lib` and `src/components`.
Reusing the existing owner beats creating a new "shared" copy.

If nothing exists, ask these in order. The first "yes" decides the kind of module:

1. **Does it return JSX?** It is a component.
2. **Does it talk to the network?** It is a hook in `src/lib/hooks/<domain>.ts` over
   `src/lib/api.ts`. Components never `fetch`.
3. **Does it call React hooks?** It is a custom hook, `use<Something>`.
4. **Is it a pure function of its inputs** (filter, sort, count, format, map, validate)?
   It is a helper. It is not a hook, and not inline in JSX.
5. **Is it a value that never changes at runtime?** It is a constant.
6. **Is it a type?** It goes next to its single use, or in the narrowest shared module.
7. **Is it UI text?** It goes in `messages/en/<namespace>.json`.

Then pick the **lowest rung of the promotion ladder that covers every consumer**:

```
inside the component file (module level, not inside the function)
  → the component folder: helpers.ts / constants.ts
    → the route: next to page.tsx (e.g. pulls/[number]/constants.ts)
      → shared: src/components/<kebab>/ (UI) or src/lib/<purpose>.ts (non-UI)
```

Two components in the same route share through the route rung, not by importing from
each other's folders. A consumer in another route, or in a shared component, forces the
shared rung.

When planning a change, copy this into the answer:

```
Placement check:
- [ ] Searched for an existing owner first (design system tokens, src/lib, src/components)
- [ ] Every new file sits where the table / ladder says
- [ ] page.tsx only composes; no filter/sort/count/map inline
- [ ] Pure logic is in a helper and has a unit test
- [ ] No new utils/, common/, misc/ folder or catch-all file
- [ ] Imports point only toward shared code; nothing imported from a sibling component's folder
- [ ] Each concept (colour map, order, threshold, formatter) is defined once
- [ ] Behaviour that depends on the moved code still works (listed and checked)
- [ ] Contract docs citing moved lines are corrected in place; other deviations are listed, not fixed
```

## Rules at a glance

Each group has a reference file with the reasons, patterns and edge cases. Open only the
one the task needs.

**Components** → [references/components.md](references/components.md)

- **When to split:** the description needs "and"; a region has its own state or effect;
  a region repeats; or it changes for a different reason. About 150–200 lines is a signal
  to look, not a rule. Don't split pieces that share all their state.
- **How to split:** use `children`/slots instead of forwarding props, hooks instead of
  container components, and compound components for widgets with shared state. Never
  declare a component inside another.
- **Exports:**
  - `<Name>/<Name>.tsx` has a named export; `index.ts` contains
    `export { Name } from "./Name"`.
  - Import through the index from outside, and by file from inside the folder.
  - No new `export *`; `src/lib/hooks/index.ts` is the one exception.

**Constants, helpers, logic, state, types** →
[references/logic-and-data.md](references/logic-and-data.md)

- **Constants:**
  - Module level, in `constants.ts` on the lowest rung, named `UPPER_SNAKE_CASE`.
  - Use `as const` and unions, never `enum`. Type maps as `Record<Union, …>`.
  - One definition per concept. Design-system tokens come first. When copies disagree,
    keep the existing owner and ask which value is right.
  - UI copy, env config and derived values are not constants.
- **Helpers:** pure functions (no hooks, `fetch` or React) in `helpers.ts` beside their
  user. Shared ones go in `src/lib/<purpose>.ts`, never `utils.ts`. Test them in
  `helpers.test.ts`.
- **Layers:** component → hook → pure domain functions → API layer; calls only go down.
  - A function is a hook only if it calls hooks; hooks serve concrete use cases.
  - Compute derived data in render. User-caused logic goes in event handlers, not
    effects.
- **State:**
  - Server data lives in TanStack Query, never copied into `useState`.
  - Shareable UI state goes in the URL. Local state goes in the lowest component that
    needs it. Cross-tree state goes in a context provider in `src/lib`.
- **Data layer:** one API client, hooks grouped by domain. A key starts with the resource
  and includes every `queryFn` input; where related queries are invalidated together, a
  key factory gives them a shared prefix (`src/lib/hooks/keys.ts`). Invalidation happens
  in the mutation hook.
- **Types:** colocate them; shared types go in the narrowest module. Contracts come
  through `import type` from `@devdigest/shared`, and variants are derived with
  `Pick`/`Omit`.

**Next.js App Router** → [references/nextjs-app-router.md](references/nextjs-app-router.md)

- `src/app` holds routing and route-local `_components/`. Shared code lives outside
  `app`. Route groups exist only to share a layout (`(shell)` shares the app frame).
- Components are Server Components by default, with `"use client"` on the smallest
  interactive subtree. A thin server `page.tsx` renders a client view
  (`src/app/(shell)/agents/page.tsx`). Props are minimal and serializable.
- **One data model:** the external Fastify API through TanStack Query hooks in client
  components. Nothing fetches on the server; there is no DAL, no Server Actions and no
  Route Handlers. Adding a second data path is an architecture decision, so ask first.

## Scope discipline

Apply these rules to code you create or change. When you notice deviations in files the
task doesn't touch, list them in your answer but don't fix them unasked. A feature mixed
with a broad refactor is hard to review and hard to revert.

Three things are part of the change, not scope creep:

- **Promotion your change triggers.** If your change adds a second consumer to something
  that lives in another component's folder (for example a sibling's `VERDICT_META`), move
  it to the lowest common rung in the same change. Importing it from the sibling's folder
  "for now" is how cross-component coupling starts.
- **Contract docs that cite what you moved.** `client/specs/pages.md` ("change the code and
  this file in the same commit") and `e2e/specs/flows.md` cite `file:line`. When your
  change shifts or moves cited lines:
  - Correct those citations **in place** in the same change, and check each new number
    against the edited file.
  - `INSIGHTS.md` files are the exception: append-only, written only through the
    `engineering-insights` script. `CLAUDE.md` files only get lines added.
- **Behaviour that depends on what you moved.** Moving or wrapping code can break things
  that rely on it:
  - effects that fire on mount, and scroll targets;
  - keyboard shortcuts bound on `window` (only one list item should be live);
  - selection that points at a filtered-out item;
  - fallbacks for bad data.

  List those dependants and keep them working. Removing a defensive fallback is a
  behaviour change, not a cleanup.

## Review checklist

When reviewing a change, check that:

- [ ] Every file is on the lowest rung of the ladder that covers its consumers
- [ ] Routes don't import each other; shared code doesn't import from `src/app`; no sibling-folder imports
- [ ] `page.tsx` composes; logic is in helpers or hooks
- [ ] No component does its own `fetch`; data comes from `src/lib/hooks`
- [ ] Hooks call hooks; functions that don't are not named `use…`
- [ ] Constants are module-level and defined once; nothing duplicates the design system or `src/lib`
- [ ] No new catch-all `utils`, no new `export *`
- [ ] Behaviour relying on moved or wrapped code still works: effects, scroll, shortcuts, fallbacks
- [ ] Contract docs' `file:line` citations match the edited files
- [ ] The project's conventions win over generic advice (`client/CLAUDE.md`)

## Reference files

| Read | When |
| --- | --- |
| [references/devdigest.md](references/devdigest.md) | Working in this repo's `client/`: exact paths, known deviations, precedence over other skills |
| [references/components.md](references/components.md) | Splitting or composing components; component folder, exports, barrels |
| [references/logic-and-data.md](references/logic-and-data.md) | Placing logic, hooks, constants, helpers, state, query code or types |
| [references/nextjs-app-router.md](references/nextjs-app-router.md) | Route structure, Server/Client boundary, choosing a data path |
| [references/examples.md](references/examples.md) | Before/after refactors on real DevDigest code |

Rationale and sources for every rule are in `README.md` (for maintainers; you don't need
to load it).
