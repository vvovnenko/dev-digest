# Components: placement, splitting, composition, exports

## Contents
- Placement and the promotion ladder
- When to split, and when not to
- Composition patterns
- Logic out of components: hooks, not containers
- Anatomy of a component folder
- Exports and barrel files
- Naming
- Sources

## Placement and the promotion ladder

A component starts where it is used and moves only when a new consumer forces it to.

| Consumers | Location |
| --- | --- |
| One parent component | in that parent's file (small, stateless), or `<Parent>/_components/<Name>/` |
| Several components of one route | `src/app/<route>/_components/<Name>/` |
| Two or more routes | `src/components/<kebab-name>/` |
| Any app, no domain knowledge | the design system (`@devdigest/ui`, vendored; can't be extended from here) |

Promote when a second consumer actually appears, not when one "might". Next.js private
folders (`_components`) exist for exactly this: they colocate UI with a route without
creating a URL segment.

When you promote, move the whole folder (component, styles, constants, helpers, test)
and update the imports. Don't leave a re-export shim behind.

The same ladder applies to a component's constants and helpers. When a second component
needs `VerdictBanner/constants.ts`'s `VERDICT_META`, move it to the route rung
(`pulls/[number]/constants.ts`), and have both import it from there. Don't re-export it
through `VerdictBanner/index.ts`, and don't deep-import `../VerdictBanner/constants`:
that makes one component's internals another's dependency. The move belongs to the
change that adds the second consumer.

Sources: A1, A9, A12, A13, A14, A16.

## When to split, and when not to

Signals to split:

- **Single responsibility.** You can't describe the component without "and", or it "does
  more than one thing".
- **Separate state.** A region has its own `useState`, effect or subscription that the
  rest ignores. Extracting it also narrows re-renders.
- **Reuse.** The same markup appears twice, or another screen wants it.
- **Different reasons to change.** Layout, data wiring and interaction details change for
  different reasons and are often owned by different edits.
- **Size.** Around 150–200 lines, or JSX nested deeper than you can follow. Treat this
  as a reason to look for the seams above, not as a rule to cut at a line count.

Signals to wait:

- The pieces would share all their state. Splitting only moves it into props: you
  replace length with prop drilling.
- The "sub-component" is ten lines of markup used once. Keep it in the parent file as a
  module-level function component.
- You are splitting to prepare for a reuse nobody asked for. That is a hasty abstraction.

Never declare a component inside another component's body. It gets a new identity on
every render, so React remounts it and its state is lost.

Sources: A6, A7, A13, A16, A21.

## Composition patterns

- **`children` and slots.** When a wrapper only positions content, take it as `children`
  or as named `ReactNode` props (`header`, `actions`). Don't pass the data and let the
  wrapper decide what to render. This removes prop drilling and keeps the wrapper
  generic.
- **Pass primitives and nodes, not whole records.** A component that receives a full
  domain object is coupled to its shape. Take the fields it needs, or a rendered node.
- **Compound components.** For widgets whose parts share implicit state (tabs, menus,
  disclosure), expose `Tabs`, `Tabs.List` and `Tabs.Panel`, which share state through a
  context private to the module. This avoids a "prop explosion" on one root.
- **Headless logic.** When several UIs need the same behaviour (keyboard navigation,
  selection, filtering), put the behaviour in a hook that returns state and handlers,
  and keep the markup in the components that call it.

Sources: A8, A18, A19, A21.

## Logic out of components: hooks, not containers

The container/presentational split (a wrapper that fetches, a child that renders) is
superseded. Its author withdrew it in 2019, and hooks give the same separation without
an extra component.

- Put data wiring in a query hook (`src/lib/hooks`) and call it where the data is
  rendered, or in the nearest parent that owns loading and error states.
- Put rules (filter, sort, derive) in pure helpers. See `logic-and-data.md`.
- A component that only calls a hook and returns `null`, or only passes props through,
  is indirection. Inline it.

Sources: A17, A18, A19.

## Anatomy of a component folder

This is modelled on `pulls/[number]/_components/FindingsPanel/`. The real folder has no
`helpers.test.ts` yet; it is shown because new helpers should come with one.

```
FindingsPanel/
├── FindingsPanel.tsx      the component (named export)
├── index.ts               export { FindingsPanel } from "./FindingsPanel"
├── styles.ts              export const s = { … }   (only if it has styles)
├── constants.ts           SEVERITY_ORDER, LOW_CONFIDENCE_THRESHOLD …
├── helpers.ts             visibleFindings(findings, hideLow, severity)
├── helpers.test.ts        unit tests for helpers (no rendering, no mocks)
├── FindingsPanel.test.tsx behaviour through the UI
└── _components/           children used only by this component
```

Create the optional files only when they have content. An empty `constants.ts` is noise.
Keep the order inside `<Name>.tsx`: imports, module-level constants and helpers that are
too small for their own file, the component, then small private sub-components.

Sources: A15, A16 (per-component folders); `client/CLAUDE.md`.

## Exports and barrel files

The sources disagree. Some treat an `index.ts` as a folder's public API. Others, backed
by build data, advise dropping barrels: they cause import cycles and pull whole module
graphs into every import. The rules here keep the useful part:

- **Per-component `index.ts`, narrow and explicit.** `export { Name } from "./Name"`,
  plus a props type if consumers need it. Outside code imports the folder, so the
  component's internals can move freely.
- **No `export *` in new barrels.** It hides what is public and defeats tree-shaking.
- **Never import your own barrel from inside the folder.** Import the sibling file
  directly, or you create a cycle.
- **Module-level barrels are the exception, not the pattern.** DevDigest's
  `src/lib/hooks/index.ts` is established, so don't add more.
- **Named exports.** They keep one name across the codebase and let tooling rename
  safely. Route files (`page.tsx`, `layout.tsx`) use the default exports Next.js requires.

Sources: A7, A10, A11, A15, A22a–d.

## Naming

- Component files and folders are PascalCase (`FindingCard/FindingCard.tsx`). Shared
  folders under `src/components/` are kebab-case (`severity-counts/`). Everything else is
  kebab-case.
- Name a module for what it does (`github-urls.ts`), not what it is (`utils.ts`,
  `helpers2.ts`).
- Hooks are `use<Noun>` for queries and `use<Verb><Noun>` for mutations.

Sources: A16, A20, B22; `client/CLAUDE.md` → Naming.

## Sources

IDs refer to the catalog in the skill's `README.md`.
