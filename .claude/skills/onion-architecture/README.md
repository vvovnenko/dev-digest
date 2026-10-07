# onion-architecture — maintainer notes

What this skill is, how it is built, and what to keep in sync. Agents read `SKILL.md`;
this file is for whoever changes the skill or its rules.

## Layout

| File | Role |
| --- | --- |
| `SKILL.md` | the rules an agent follows; ≤ ~250 lines, description ≤ 1024 chars |
| `references/devdigest.md` | ring map of `server/src` + `reviewer-core/src`, known deviations with `path:line` |
| `references/layers-and-ports.md` | domain, ports, services, composition — good/bad examples |
| `references/persistence-and-transactions.md` | repositories implementing ports, row mapping, the three transaction patterns |
| `references/fastify-edge.md` | thin routes, Zod at the edge, errors, container vs decorators, SSE |
| `references/testing.md` | fakes, contract suites, Testcontainers, `app.inject` |
| `references/enforcement.md` | the dependency-cruiser rules, options, baseline workflow, blind spots |
| `references/sources.md` | every external source with an ID and a one-line takeaway |
| `scripts/baseline-diff.mjs` | read-only; exits 1 if the baseline grew compared with a git ref |

Enforcement lives outside the skill folder: `server/.dependency-cruiser.cjs`,
`server/.dependency-cruiser-known-violations.json`, the `arch`, `arch:baseline` and
`arch:stale` scripts in `server/package.json`, and two steps in
`.github/workflows/server-unit.yml` (job `typecheck`).

## Design decisions

- **Onion rings map onto the existing file names.** `routes.ts`, `service.ts`,
  `repository.ts` stay (they are the repo's convention); `domain.ts` and `ports.ts` are
  added for new code, only when needed.
- **The container stays the composition root.** No DI framework and no Fastify
  decorators for services (Palermo part 4: a container is not required). New services
  take explicit port objects instead of the whole `Container`.
- **Ports live next to their consumer** (`modules/<m>/ports.ts`), except the shared
  external ports that already sit in `vendor/shared/adapters.ts`.
- **Transactions via `update(id, fn)` or a unit-of-work port**, not an optional `tx`
  parameter on every method, so Drizzle types never enter port signatures.
- **Legacy is frozen, not refactored.** 64 violations were baselined on 2026-09-27.
  `arch:stale` makes the baseline shrink-only; `baseline-diff.mjs` proves it for a change.
- **dependency-cruiser over eslint-plugin-boundaries.** It was already a dependency, needs
  no ESLint setup, sees type-only imports and cruises reviewer-core in the same run.

## Where the sources disagree

| Topic | Sources | Chosen here |
| --- | --- | --- |
| Separate persistence model | N4 maps everything; A4 maps only where shapes differ | A4 — map when the shapes differ |
| Passing a transaction | T9 optional `tx` per method; T10 `update(id, fn)` | T10 first, then a unit-of-work port |
| DI | T2/T6 decorators as DI; F2/F14 composition root | composition root (`platform/container.ts`) |
| Layer count | N3 full DDD hexagon; A1 warns against lasagna | rings appear only when they earn their place |

## Keep in sync

- A new rule or a changed rule name: `server/.dependency-cruiser.cjs`,
  `references/enforcement.md` (rule table), and the baseline (rule names are keys).
- A new `platform/` file: classify it in `PLATFORM_INFRA` and in the ring map in
  `references/devdigest.md`.
- A paid-down deviation: remove it from `references/devdigest.md` in the same change as
  the smaller baseline.
- `.claude/skills/README.md` catalog row, and the pointers in `server/CLAUDE.md`,
  `reviewer-core/CLAUDE.md`, `server/docs/architecture.md` and `TESTING.md`.
- Re-check `references/sources.md` links when bumping the version in `SKILL.md`.
