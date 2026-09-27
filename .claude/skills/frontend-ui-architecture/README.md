# frontend-ui-architecture

**Version 1.0.0** · the version is recorded in `SKILL.md` → `metadata.version`.

A skill about **where frontend code lives and how it is split** in a React 19 + Next.js
App Router + TanStack Query codebase: component placement and splitting, constants,
helpers, utils, business logic, hooks, state, the data layer, types and the Server/Client
boundary. It covers architecture and code organization only.

- Rendering rules, hooks correctness, memoization and performance →
  [`react-best-practices`](../react-best-practices/SKILL.md)
- Next.js file-convention and API mechanics →
  [`next-best-practices`](../next-best-practices/SKILL.md)

This README is for maintainers. Agents load `SKILL.md`, and the reference files only on
demand.

## Layout

| File | Loaded | Holds |
| --- | --- | --- |
| `SKILL.md` | when the skill triggers | the repo map, principles, the "where does this code go?" walk, short rules per topic, checklists |
| `references/devdigest.md` | working in `client/` | the full directory map, relied-on conventions, conflicts with other skills, known deviations |
| `references/components.md` | splitting or composing | placement ladder, split signals, composition, component folder, exports and barrels |
| `references/logic-and-data.md` | placing logic, state or data code | layers, pure business logic, hooks, constants, helpers vs utils, state classes, the server-data layer, types |
| `references/nextjs-app-router.md` | route structure or the boundary | organization strategies, `app/` structure, page/layout/template, Server/Client, data models, Actions and Route Handlers, env |
| `references/examples.md` | wanting a worked case | six before/after refactors on real DevDigest code |
| `evals/evals.json` | never, by agents; used by maintainers | three test prompts with assertions (see [Evaluation](#evaluation)) |

Every rule in the references ends with `Sources: A…/B…`, pointing to the IDs below.

## Design decisions

- **Project conventions win.** Precedence is `client/CLAUDE.md` > this skill > generic
  advice. Generic rules are always paired with the DevDigest path they map to.
- **Explain why, don't shout.** Rules carry a reason instead of MUST/NEVER, so an agent
  can handle cases the rule didn't foresee.
- **Progressive disclosure.** `SKILL.md` stays short. Detail lives in reference files one
  level deep, and each file has a table of contents.
- **No duplication with neighbouring skills.** Where they conflict with this repo (for
  example Tailwind vs `style={s.x}`, or `utils/` vs `src/lib/<purpose>.ts`),
  `references/devdigest.md` says so explicitly.
- **Snapshots are labelled.** The list of known deviations is a dated snapshot
  (v1.0.0). Agents are told to re-check it with grep before citing a line.

## Where the sources disagree, and what the skill chose

| Question | Positions | This skill |
| --- | --- | --- |
| Barrel files | public API per folder (A15, A11, A20) ↔ remove barrels: cycles, module graph cost (A22a–d, A10) | one narrow `index.ts` per component folder (`export { X } from "./X"`); no new `export *`; never import your own barrel; `src/lib/hooks/index.ts` is the accepted exception |
| Feature folders vs type folders | features (A10, A16, A20, A21) ↔ type folders, features are arbitrary (A15) ↔ neutral (A1, A9) | Next.js "split by route": `_components` per route, then `src/components`, then `src/lib` (the repo's existing strategy) |
| Layers: bulletproof-react vs FSD | 3 tiers (A10) ↔ 6+ layers with slices (A11) | neither is adopted; the one-way rule (shared ← routes) is kept |
| Container/presentational | withdrawn by its author (A17, A18) ↔ separation kept via layers (A19) | hooks + pure functions instead of container components |
| A hook per query vs `queryOptions` | custom hook per query (B15, B21) ↔ `queryOptions` factories (B16, 2024) | one place per key; in DevDigest, named hooks in `src/lib/hooks/<domain>.ts` |
| Where to transform data | fetcher/API layer (B23, B22) ↔ `select` (B17) | mapping in the fetcher/hook; per-view derivations in `select` or render helpers |
| Domain logic as classes vs functions | classes/strategy (A19) ↔ pure functions (B1–B3, B23) | pure functions |
| `utils/` and `helpers/` folders | accepted (A10, A15, A16) ↔ forbidden names (B22) | colocated `helpers.ts`; shared code in `src/lib/<purpose>.ts`; never a catch-all `utils` |
| UPPER_SNAKE constants | any module-level constant (B25 Google) ↔ exported, deeply immutable only (B25 Airbnb) | module-level immutable values (matches the repo's 48 existing constants) |
| `enum` | plain `enum` OK (B25 Google) ↔ `as const` (B11) | `as const` + unions; never `const enum` |
| Next.js data model | DAL for new apps (B6, B13) ↔ HTTP API for existing backends (B6) | HTTP API (Fastify) via TanStack Query; a DAL/Actions would be a separate decision |

## Sources

Research date: 2026-09-27. Every URL was opened during research unless marked
*(via search)*. Those three pages were confirmed only through search results: a 403 for
Medium, a DNS failure for profy.dev, and Wikipedia not fetched.

### A. Project structure, components, module boundaries

**Official documentation**

| ID | Source | Used for |
| --- | --- | --- |
| A1 | Next.js — [Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) | three organization strategies; `_private` folders; route groups; "choose a strategy … and be consistent" |
| A2 | Next.js — [Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) · [`src` folder](https://nextjs.org/docs/app/api-reference/file-conventions/src-folder) · [`template.js`](https://nextjs.org/docs/app/api-reference/file-conventions/template) | group conflicts; `src/app` and the `@/*` alias; templates reset state on navigation |
| A3 | Next.js — [Layouts and Pages](https://nextjs.org/docs/app/getting-started/layouts-and-pages) | page vs layout responsibilities |
| A4 | Next.js — [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | `"use client"` at the leaves; server content as `children`; providers deep; `server-only` |
| A5 | Next.js Learn — [Dashboard App: Getting Started](https://nextjs.org/learn/dashboard-app/getting-started) | the "inside `app/`" strategy (`app/ui`, `app/lib`) at tutorial scale |
| A6 | React — [Thinking in React](https://react.dev/learn/thinking-in-react) | "a component should ideally only do one thing" |
| A7 | React — [Your First Component](https://react.dev/learn/your-first-component) · [Importing and Exporting Components](https://react.dev/learn/importing-and-exporting-components) | never define a component inside another; default vs named exports |
| A8 | React — [Passing Props to a Component](https://react.dev/learn/passing-props-to-a-component) · [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) | `children` as a slot; spread props "with restraint"; "some duplication is fine" |
| A9 | React (legacy) — [File Structure FAQ](https://legacy.reactjs.org/docs/faq-structure.html) | by feature or by type; at most 3–4 nesting levels; "don't overthink it" |

**Methodologies and maintainer guides**

| ID | Source | Used for |
| --- | --- | --- |
| A10 | Alan Alickovic — bulletproof-react: [Project Structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) · [Next.js app](https://github.com/alan2207/bulletproof-react/tree/master/apps/nextjs-app) | shared → features → app; no cross-feature imports; now advises against barrels; routing-only `app/` |
| A11 | Feature-Sliced Design — [Overview](https://feature-sliced.design/docs/get-started/overview) · [Layers](https://feature-sliced.design/docs/reference/layers) · [Public API](https://feature-sliced.design/docs/reference/public-api) · [Usage with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs) | strict layer imports; segments by purpose; no `export *`; "not everything needs to be a feature" |
| A12 | Kent C. Dodds — [Colocation](https://kentcdodds.com/blog/colocation) | "place code as close to where it's relevant as possible" |
| A13 | Kent C. Dodds — [AHA Programming](https://kentcdodds.com/blog/aha-programming) | avoid hasty abstractions; "prefer duplication over the wrong abstraction" |
| A14 | Sandi Metz — [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) · Wikipedia — [Rule of three](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)) *(via search)* | "duplication is far cheaper than the wrong abstraction"; refactor on the third occurrence |
| A15 | Josh W. Comeau — [Delightful React File/Directory Structure](https://www.joshwcomeau.com/react/file-structure/) | folder per component with helpers and constants; helper vs util definitions; case against feature folders |
| A16 | Robin Wieruch — [React Folder Structure in 5 Steps](https://www.robinwieruch.de/react-folder-structure/) | incremental structure; promote when two features need it |
| A17 | Dan Abramov — [Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) *(via search)* | the 2019 note: "I don't suggest splitting your components like this anymore" |
| A18 | patterns.dev — [Container/Presentational](https://www.patterns.dev/react/presentational-container-pattern) · [Compound](https://www.patterns.dev/react/compound-pattern) · [Hooks](https://www.patterns.dev/react/hooks-pattern); Kent C. Dodds — [Compound Components with React Hooks](https://kentcdodds.com/blog/compound-components-with-react-hooks) | hooks replace containers; compound components via context |
| A19 | Juntao Qiu (martinfowler.com) — [Modularizing React Applications](https://martinfowler.com/articles/modularizing-react-apps.html) · [Headless Component](https://martinfowler.com/articles/headless-component.html) | view / hook / domain / gateway layers; headless logic in hooks |
| A20 | Johannes Kettmann — [Popular React folder structures](https://profy.dev/article/react-folder-structure) *(via search)* · [Screaming Architecture (dev.to mirror)](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) | folders should name the domain; pages are thin compositions |
| A21 | Alex Kondov — [Tao of React](https://alexkondov.com/tao-of-react/); mithi — [react-philosophies](https://github.com/mithi/react-philosophies) | group by route; one job per component (no "and"); pass primitives and nodes |

**Barrel files and boundary tooling**

| ID | Source | Used for |
| --- | --- | --- |
| A22a | TkDodo — [Please Stop Using Barrel Files](https://tkdodo.eu/blog/please-stop-using-barrel-files) | cycles; a Next.js page went from ~11k to ~3.5k modules; barrels only as library entries |
| A22b | Marvin Hagemeister — [The barrel file debacle](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) | the cost of loading module graphs through barrels |
| A22c | Vercel — [How we optimized package imports in Next.js](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) | `optimizePackageImports` for third-party barrels |
| A22d | Atlassian — [Faster builds when removing barrel files](https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files) | 75% fewer build minutes; the trade-off is lost encapsulation |
| A23a | eslint-plugin-import — [`no-restricted-paths`](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-restricted-paths.md) | enforcing one-way imports with zones |
| A23b | [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) | element types, allow/deny rules, entry points |
| A23c | [Steiger](https://github.com/feature-sliced/steiger) (FSD linter) | public API and cross-import checks |

### B. Logic, constants, utils, state, types, Next.js boundaries

**Official documentation**

| ID | Source | Used for |
| --- | --- | --- |
| B1 | React — [Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) · [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks) | hooks share logic, not state; no `use` prefix without hooks; no lifecycle wrappers |
| B2 | React — [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) · [Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies) | compute derived data in render; "move static objects and functions outside your component" |
| B3 | React — [Keeping Components Pure](https://react.dev/learn/keeping-components-pure) | pure rendering; side effects in event handlers |
| B4 | React — [Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) · [Sharing State Between Components](https://react.dev/learn/sharing-state-between-components) | minimal state; ids not copies; one owner |
| B5 | Next.js — [The Server and Client Boundary](https://nextjs.org/docs/app/guides/server-and-client-boundary) | code crosses through imports, data through props; `server-only` / `client-only` |
| B6 | Next.js — [Data Security](https://nextjs.org/docs/app/guides/data-security) | three data models, "choose one"; DAL and DTOs; env access |
| B7 | Next.js — [Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data) · [Server Actions and Mutations](https://nextjs.org/docs/app/guides/server-actions) | `"use server"` files; actions for mutations only; validate every input |
| B8 | Next.js — [Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) | Route Handlers are public endpoints; don't call your own handlers from Server Components |
| B9 | Next.js — [Environment Variables](https://nextjs.org/docs/app/guides/environment-variables) | `NEXT_PUBLIC_` inlined at build and frozen |
| B10 | TanStack Query — [Advanced Server Rendering](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr) · [Query Options](https://tanstack.com/query/latest/docs/framework/react/guides/query-options) · [Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) · [Does this replace client state?](https://tanstack.com/query/latest/docs/framework/react/guides/does-this-replace-client-state) | prefetch plus hydration; every `queryFn` input in the key; not a client-state store |
| B11 | TypeScript — [Handbook: Enums](https://www.typescriptlang.org/docs/handbook/enums.html) · [TS 5.8 release notes (`--erasableSyntaxOnly`)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html) | `as const` instead of `enum` |
| B12 | Zod — [Basics](https://zod.dev/basics) | `z.infer` as the single source of a type |

**Maintainer and expert guides**

| ID | Source | Used for |
| --- | --- | --- |
| B13 | Sebastian Markbåge (Next.js blog) — [How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) | DAL/DTO origin; minimal props to client components; actions' arguments are hostile |
| B14 | Lee Robinson (Next.js blog) — [Building APIs with Next.js](https://nextjs.org/blog/building-apis-with-nextjs) | shared logic behind both Actions and APIs; wrappers in `lib/` |
| B15 | TkDodo — [Practical React Query](https://tkdodo.eu/blog/practical-react-query) · [React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager) | server state ≠ client state; don't copy query data into `useState` |
| B16 | TkDodo — [Effective React Query Keys](https://tkdodo.eu/blog/effective-react-query-keys) · [The Query Options API](https://tkdodo.eu/blog/the-query-options-api) | keys from generic to specific, colocated; `queryOptions` factories |
| B17 | TkDodo — [React Query Data Transformations](https://tkdodo.eu/blog/react-query-data-transformations) | where to transform: backend → `queryFn` → render → `select` |
| B18 | TkDodo — [React Query and TypeScript](https://tkdodo.eu/blog/react-query-and-type-script) · [Type-safe React Query](https://tkdodo.eu/blog/type-safe-react-query) | type the fetcher; validate at the boundary |
| B19 | TkDodo — [You Might Not Need React Query](https://tkdodo.eu/blog/you-might-not-need-react-query) | when framework fetching suffices vs client queries |
| B20 | Kent C. Dodds — [Application State Management with React](https://kentcdodds.com/blog/application-state-management-with-react) · [How to use React Context effectively](https://kentcdodds.com/blog/how-to-use-react-context-effectively) | server cache vs UI state; Provider + `useX` hook |
| B21 | bulletproof-react — [API Layer](https://github.com/alan2207/bulletproof-react/blob/master/docs/api-layer.md) · [State Management](https://github.com/alan2207/bulletproof-react/blob/master/docs/state-management.md) · [Project Standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) | one API client; categories of state; config module for env |
| B22 | Feature-Sliced Design — [Slices and segments](https://feature-sliced.design/docs/reference/slices-segments); Steiger — [`segments-by-purpose`](https://github.com/feature-sliced/steiger/blob/master/packages/steiger-plugin-fsd/src/segments-by-purpose/README.md) | name modules by purpose, not `utils` / `helpers` / `types` |
| B23 | Johannes Kettmann — [Clean(er) React Architecture: entities and DTOs](https://dev.to/jkettmann/path-to-a-cleaner-react-architecture-domain-entities-dtos-3ja0) · [Business logic separation](https://dev.to/jkettmann/path-to-a-cleaner-react-architecture-part-6-business-logic-separation-221g) | DTO → domain mapping in the API layer; logic as pure functions behind thin hooks |
| B24 | Matt Pocock — [Where To Put Your Types in Application Code](https://www.totaltypescript.com/where-to-put-your-types-in-application-code) | colocate types; share at the narrowest level |
| B25 | [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) · [Airbnb JavaScript Style Guide — naming, uppercase](https://github.com/airbnb/javascript#naming--uppercase) | `CONST_CASE` rules; no `const enum` |
| B26 | [T3 Env — Next.js](https://env.t3.gg/docs/nextjs) | one validated env module with a server/client split |

### C. Skill authoring

| ID | Source | Used for |
| --- | --- | --- |
| C1 | Agent Skills — [Specification](https://agentskills.io/specification) | frontmatter fields; `metadata.version`; `references/` one level deep; SKILL.md under 500 lines |
| C2 | Anthropic — [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | concise bodies; third-person descriptions; progressive disclosure; TOC for files over 100 lines; checklists; evaluations first |
| C3 | Claude Code — [Skills](https://code.claude.com/docs/en/skills) | supported frontmatter (no `version` field, so it goes in `metadata`); project skills live in `.claude/skills/` |
| C4 | Anthropic `skill-creator` skill | draft → test with and without the skill → review → iterate; "pushy" descriptions; explain why instead of MUST |

### Checked but not used as rules

- typescript-eslint — [`naming-convention`](https://typescript-eslint.io/rules/naming-convention/): the rule is frozen and advises flagging only egregious cases. That is a reason not to enforce UPPER_SNAKE by lint.
- TanStack Query community page `lukemorales-query-key-factory` returned 404 during research. Don't cite it.

### Repo evidence

The DevDigest mapping comes from `client/CLAUDE.md`, `client/docs/ui-architecture.md`
and a survey of `client/src` on 2026-09-27: 31 route-local component folders, 16 shared
ones, no `utils/`, and data only through `src/lib/hooks`.

## Evaluation

The evals are in `evals/evals.json`: three realistic `client/` tasks, each with
assertions.

- `pulls-page-logic`: move inline logic out of `pulls/page.tsx`.
- `dedupe-format-and-colors`: remove the duplicate `formatWhen` and severity colour maps.
- `run-filters-component`: add a filter bar to the Review runs tab.

Each task was run by a subagent with the skill and by one without it (baseline, told not
to read `.claude/skills/`). The agents wrote proposals only; the repo was read-only. The
proposals were then graded against the assertions using the `skill-creator` process.

| Round | Skill | Assertions | With skill | Without | Time with / without (mean) |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.0.0 | 21 | 21/21 (100%) | 19/21 (90%) | 583 s / 448 s |
| 2 | 1.1.0 | 25 (stricter) | 24/25 (97%) | 22/25 (86%) | 614 s / 545 s |
| 3 | 1.2.0 | 43 (5 evals) | 41/43 (95%) | 38/43 (88%) | 649 s / 460 s |

What the rounds showed:

- **The baseline already does basic placement well.** `client/CLAUDE.md` and the
  neighbouring files encode the conventions. The skill's value is in judgment calls:
  - reuse the design system instead of adding a map;
  - keep defensive fallbacks;
  - ask about conflicting values;
  - keep contract docs in sync;
  - promote a constant when the change adds its second consumer.
- **Round 1 found a wrong example.** Example 3 proposed a new severity map where `SEV`
  already existed. That was fixed in 1.1.0.
- **Round 2 found a conflict between rules.** Scope discipline beat the promotion
  ladder, and the agent imported a sibling's `VERDICT_META`. 1.1.0 now states that
  promotion the change itself triggers belongs to the change. This fix has not been
  re-measured yet.
- **The skill adds time on larger tasks:** roughly +70 s to +190 s per run on
  average. Shortening `SKILL.md` in 1.2.0 did not reduce it. The extra time goes into the
  checks the skill asks for: existing owners, dependent behaviour and doc citations.
- **Round 3 confirmed the 1.1.0/1.2.0 fixes.** Only the skill runs:
  - moved `VERDICT_META` to the route rung;
  - corrected every shifted citation in `pages.md` and `flows.md`;
  - asked before adding a server data path.

  They also pushed back on the requested pseudo-hook. The assertions were too loose to
  score that last one.
- **Round 3 found two gaps.** Both were fixed afterwards and have not been re-measured:
  - `devdigest.md` and example 1 contradicted each other on the needs-review count, which
    pulled the shell into a page refactor;
  - the `defaultOpen` re-open trap, missed by both configurations.
- **The "keep the deviations list true" rule had a side effect.** Skill runs proposed
  editing the skill itself inside product changes, which graders count as scope creep.
  Since the final 1.2.0, runs only report a fixed or new deviation, and maintainers
  update the list in a separate commit.

**Contamination warning.** `evals/evals.json` lives in the repo. In round 3, three of ten
runs saw it through repo-wide greps, including the expected answers: the `e2` baseline
and both `e4` runs. Those results are unreliable. Next rounds must use the executor
template below, which excludes `.claude/` from every search.

To re-run, give each prompt to one agent that reads `SKILL.md` (with skill) and one that
doesn't (baseline), then grade against `expectations`. Start every executor prompt with
this block, so neither run can read the eval set or the skill by accident:

```text
Execute this task in the repository <repo root>.
- [with skill]  First read .claude/skills/frontend-ui-architecture/SKILL.md and follow it,
                reading its reference files as it directs.
- [baseline]    Do not use the Skill tool and do not read anything under .claude/.
- Never search .claude/: use `grep -rn --exclude-dir=.claude --exclude-dir=node_modules …`
  or `rg -g '!.claude' …`; never grep from the repo root without that exclusion.
- READ-ONLY REPO: no edits, no state-changing git, no app/tests/installs; never read server/clones/.
- Task: <eval prompt>
- Deliverable: write ONE file, <workspace>/iteration-N/eval-<id>-<name>/<config>/run-1/outputs/proposal.md:
  files to create/modify, full contents or unified diffs, rationale, questions for the user.
```

Graders read only the outputs and the repo, never `.claude/skills/`. For checks that apply
diffs, graders work in a scratch copy and call `node_modules/.bin/vitest` and `tsc`
directly. `pnpm exec` from a copy with a symlinked `node_modules` rewrites the real
`client/node_modules/.modules.yaml`.

## Versioning

The version uses semver and is stored in `SKILL.md` → `metadata.version`. Update this
README's changelog in the same change.

- **MAJOR**: a rule is reversed or removed, or the precedence changes.
- **MINOR**: a new rule, section, reference file or example.
- **PATCH**: wording, links, refreshed line numbers or snapshot data.

### Changelog

- **1.2.0 — 2026-09-27.** Changes after the second eval round:
  - **Contract docs.** `client/specs/pages.md` and `e2e/specs/flows.md` citations are
    corrected in place; only `INSIGHTS.md` is append-only (the user's decision). Before
    this, runs split between editing and appending dated notes.
  - **Promotion.** Promotion through the route rung is now explicit in the ladder, the
    principles and `components.md`: never import from a sibling component's folder.
  - **Shorter `SKILL.md`.** Per-topic sections became a "Rules at a glance" block that
    points to references, from 284 to 216 lines.
  - **Known deviations** gained `lineLabel` ×3 and the duplicated needs-review count.
    - Agents only report fixed or new deviations; they never edit the skill inside a
      product change. An earlier draft had them edit it, and graders flagged that as
      scope creep.
  - **An executor prompt template for evals.** It excludes `.claude/` from searches,
    because in round 3 three of ten runs read `evals.json` through repo-wide greps.
    - The needs-review entry is marked as pre-existing debt that tasks only mention.
    - Example 1 says the same. A round-3 run found that the two had contradicted each
      other and pulled the shell into a page refactor.
  - **`devdigest.md` gained "Behaviour traps on the PR page":** scroll on mount, open
    state from `defaultOpen` at mount only, and j/k/a/d on every open panel.
  - **Evals.** Two new ones (`hook-vs-helper-promotion`, `server-fetch-decision`), and
    the three old ones got stricter assertions (43 in total).
- **1.1.0 — 2026-09-27.** Changes after the first eval round:
  - **Design system first.** A new "check whether it already exists" step before
    placing code (design-system tokens such as `SEV`, then `src/lib` and
    `src/components`). Example 3 now reuses `SEV` instead of creating a new severity
    map; the old version was wrong, because a baseline run found `SEV` and neither run
    followed the example.
  - **Scope discipline** now covers three cases:
    - contract docs that must change together with the code (`client/specs/pages.md`);
    - behaviour that depends on moved code: effects on mount, scroll targets,
      shortcuts, defensive fallbacks;
    - promotion that the change itself triggers, i.e. a second consumer of a sibling's
      constant. The second eval round showed the old wording let "scope" win over the
      promotion ladder.
  - **Both checklists** gained matching items.
  - **Evals.** Assertions were strengthened (behaviour preservation, reuse of the
    design system, contract docs), and the evals were re-run.
- **1.0.0 — 2026-09-27.** First version: `SKILL.md`, five reference files, a source
  catalog of 58 entries (89 URLs), a catalog row in `.claude/skills/README.md`, and a
  pointer in `client/CLAUDE.md`.

## Maintenance

- When `client/CLAUDE.md` or `client/docs/ui-architecture.md` changes a convention,
  update `references/devdigest.md` and the table in `SKILL.md` together, then bump the
  version.
- Refresh the "Known deviations" snapshot when it drifts. Grep for each item, remove the
  ones that are fixed, and bump PATCH. Agents only report fixed or new deviations in
  their answers, so the update happens here, in its own commit.
- To add a rule, add its source to the catalog first, then cite its ID in the reference
  file.
- Keep `SKILL.md` under ~300 lines. Detail belongs in `references/`.
