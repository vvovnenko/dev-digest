# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/`. The repo has no `.cursor/`: for Cursor, create the symlink yourself (`mkdir -p .cursor && ln -s ../.claude/skills .cursor/skills`). Shared with the team via version control.

`skills-lock.json` records the third-party skills installed with the `skills` CLI (`npx skills`), so
`npx skills experimental_install` can restore them; skills written here are `local` and not in it —
`npx skills list -p` (or `ls .claude/skills`) shows both.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Onion rings and import direction in server/ + reviewer-core: domain ← ports ← service ← routes/repository/adapters, composition root, transactions, fakes; enforced by `pnpm arch` (dependency-cruiser) (v1.0.0) |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where UI code lives: component placement and splitting, constants, helpers vs utils, business logic, state/data layer, Server/Client boundary (v1.2.0) |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |
| [engineering-insights](engineering-insights/SKILL.md) | Workflow | Read a module's INSIGHTS.md before work; append new, non-obvious insights at the end (append-only script) |
| [pr-self-review](pr-self-review/SKILL.md) | Workflow | Before a PR: routes each changed file to the skills that own it, runs deterministic checks, verifies every CRITICAL and writes a verdict; user-invoked only, no hook on `git push` (v1.2.0) |

`pr-self-review` runs only by hand: no hook on `git push` calls or enforces it. An optional push
gate (`node .claude/skills/pr-self-review/scripts/install-hooks.mjs` for git's pre-push hook,
plus the Claude hooks in its README) refuses a push without a PASS verdict. A new skill folder needs a
routing decision in `pr-self-review/routing.json` (or an `ignored` entry), or self-reviews stop.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
