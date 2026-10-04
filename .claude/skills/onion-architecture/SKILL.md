---
name: onion-architecture
description: Decides which onion ring server-side code belongs to and which way its imports may point in DevDigest's server/ (Fastify + Drizzle + Zod) and reviewer-core/ — pure domain.ts ← ports.ts ← service.ts ← routes.ts, repository.ts and src/adapters, wired only in the composition root and enforced by `pnpm arch` (dependency-cruiser with a shrink-only baseline). Use whenever creating, splitting or reviewing a server module, service, repository, route, port, adapter or domain rule; moving logic between routes, services and repositories; adding a transaction or an external call; writing a service test with fakes; or when `pnpm arch` fails — even if the request only says "add an endpoint", "extract this query" or "where should this go". Structure and dependency direction only; Fastify mechanics belong to fastify-best-practices, query and transaction syntax to drizzle-orm-patterns, schema idioms to zod, physical table design to postgresql-table-design.
metadata:
  version: "1.1.0"
---

# Onion architecture (backend)

Business rules sit in the middle, I/O sits at the edge, and every import points inward.
In DevDigest that buys three concrete things: service tests with in-memory fakes instead
of Testcontainers or private-field hacks, SQL in one place per module, and a CI check
that stops new leaks while the old ones are paid down.

**Precedence.** `server/CLAUDE.md` and `reviewer-core/CLAUDE.md` beat this skill, and
this skill beats generic advice. Neighbouring skills own their topics and are not
repeated here: `fastify-best-practices` (plugins, hooks, schemas), `drizzle-orm-patterns`
(query and transaction syntax), `zod`, `postgresql-table-design`, `typescript-expert`.
Where they disagree on structure, this skill wins: `fastify-best-practices` shows DI
through decorators with SQL inside a "service" (`rules/decorators.md:129-172`) and routes
calling `fastify.repositories` (`rules/routes.md:458`). Here the only decorator is
`app.container`, routes call services, and repositories never see Fastify.

Source IDs such as (F1) point to [references/sources.md](references/sources.md).

## In this repo (DevDigest `server/` + `reviewer-core/`) — read first

| Ring | Lives in | May import | Never imports |
| --- | --- | --- | --- |
| Domain model | `src/modules/<m>/domain.ts` | its own domain, `@devdigest/shared`, `platform/errors.ts`, `zod` | `node:*`, db, Drizzle, Fastify, SDKs, adapters, ports, other modules |
| Ports (domain services) | `src/modules/<m>/ports.ts`; shared ports in `src/vendor/shared/adapters.ts` | its module's domain, `@devdigest/shared` | Drizzle rows, `Db`/tx, SDK or Fastify types |
| Application services | `src/modules/<m>/service.ts` (and other non-edge module files) | ports, domain, `@devdigest/shared`, pure `platform/*`, `@devdigest/reviewer-core` | `Container`, `src/db/**`, repositories, adapters, SDKs, Fastify, `node:fs` |
| HTTP edge | `src/modules/<m>/routes.ts`, `src/modules/_shared/context.ts` | its service, `@devdigest/shared`, `_shared` | Drizzle, `src/db/**`, repositories, adapters |
| Persistence edge | `src/modules/<m>/repository.ts`, `repository/<entity>.repo.ts`, `src/db/**` | Drizzle, `src/db/**`, its module's ports and domain | services, routes, Fastify, adapters |
| External edge | `src/adapters/<tech>/` | shared ports and contracts, the SDK it wraps | `src/modules/**`, `src/db/**`, Fastify, the container |
| Composition root | `src/app.ts`, `src/server.ts`, `src/platform/container.ts`, `src/modules/index.ts` | everything | — |
| Engine core | `reviewer-core/src/**` | `@devdigest/shared`, `zod`, `openai/helpers/*` | server `src/**`, DB, fs, Fastify; the OpenAI client outside `src/llm/openrouter.ts` |

A module for new code, with dependencies pointing up the list:

```text
src/modules/<name>/
  domain.ts       # pure types + rules — no I/O, no clock, no ids generated inside
  ports.ts        # interfaces service.ts needs, named for the role (PullStore, JobQueue)
  service.ts      # use cases: load → decide (domain) → persist → emit; deps are ports
  repository.ts   # Drizzle; `implements` the store port; the only file with SQL
  routes.ts       # HTTP only: schema → getContext → one service call → status
```

Files appear only when they earn their place: a pure CRUD module may have no `domain.ts`.

**Wiring.** `platform/container.ts` builds repositories and adapters with lazy getters;
each `routes.ts` plugin builds its service once from explicit ports, e.g.
`new PullsService({ pulls: container.pullsRepo, github: () => container.github(), log: app.log })`
(`pulls/routes.ts:25-29`; `app.log` satisfies the `Logger` port). Knowledge only the root
has is adapted there: `container.repoIndexing` (`src/platform/container.ts:177-187`).

**Legacy.** 25 known violations are frozen in `server/.dependency-cruiser-known-violations.json`,
all in `modules/repo-intel/` (do-not-touch): its service and pipeline take the `Container`,
use concrete adapters and `node:fs`, and form a cycle with the container. Don't copy them.
The list, with `path:line`: [references/devdigest.md](references/devdigest.md).

## Principles

1. **Dependencies point inward.** An inner ring never names an outer one, not even in an
   `import type` (F1, F4, F9). `pnpm arch` enforces it.
2. **The core owns its ports.** A port is shaped by what the use case needs, not by what
   Drizzle or Octokit offer, and it lives next to its consumer (F1, F3, F5).
3. **Functional core, imperative shell.** Decisions are pure functions over values; the
   service does the I/O around them (F12, F10).
4. **Parse at the edge, trust inside.** Zod parses HTTP bodies, env, LLM output and
   GitHub payloads once, where they enter; inner code takes the parsed type (F13, T11).
5. **One place wires everything.** Only the composition root calls `new` on adapters and
   repositories. No DI framework is needed (F2, F14).
6. **A layer must earn its place.** No pass-through layers, no generic `Repository<T>`, no
   row → domain mapper when the shapes are identical (A1, A2, A4, N3).
7. **The repo's conventions beat the sources.** File names, the container, `AppError` and
   `@devdigest/shared` stay as `server/CLAUDE.md` describes them.

## Where does this code go?

Ask in order; the first yes wins.

1. Does it read the HTTP request or set a status code? → `routes.ts`.
2. Does it build SQL or touch a Drizzle table? → `repository.ts`, behind a port.
3. Does it call the network, a process, the filesystem or an SDK? → an adapter in
   `src/adapters/<tech>/` behind a port (a shared one in `vendor/shared/adapters.ts` when
   several modules need it).
4. Is it a decision over values (a status, a version bump, a score, a filter)? → `domain.ts`.
5. Is it an interface the service needs from the outside? → `ports.ts`.
6. Does it orchestrate loads, decisions and writes for one use case? → `service.ts`.
7. Is it needed by two modules? → a contract in `@devdigest/shared` (a contract change,
   mirror it in `client/`), or `src/modules/_shared/` for server-only HTTP helpers.

Put this block in a plan before writing backend code:

```text
Onion check — <feature>
  domain:  <pure rules/types, or "none">
  ports:   <interfaces the service needs; which existing ones are reused>
  service: <use cases and the order load → decide → persist → emit>
  edges:   <routes / repository / adapter changes>
  wiring:  <container getters + routes plugin>
  arch:    `pnpm arch` stays green; baseline only shrinks
```

## Domain (`domain.ts`)

- Pure functions and types. The clock, ids and randomness come in as arguments.
- Reuse `@devdigest/shared` types when the shape is the same; add a domain type only when
  it differs (a value the API doesn't expose, a narrower union).
- Throw `AppError` subclasses from `platform/errors.ts` for broken invariants; the HTTP
  status stays in the error class, not in domain code.
- In this repo: `modules/agents/domain.ts` (versioning rules the repository applies inside
  its transaction), `modules/pulls/domain.ts` (review status, PR-list mapping) and
  `modules/reviews/domain.ts` (the stored records a run works with).

Examples: [references/layers-and-ports.md](references/layers-and-ports.md).

## Ports (`ports.ts`)

- Name ports for their role (`PullStore`, `JobQueue`, `RunEvents`) and methods for the
  intent (`listForRepo`, `saveStats`), never for tables.
- Signatures use domain and contract types only: no `$inferSelect` rows, no `Db` or tx,
  no Octokit or OpenAI types.
- Reuse the shared ports (`LLMProvider`, `GitHubClient`, `GitClient`, …). `DepGraph`,
  `Tokenizer` and `RepoIntel` are declared outside `vendor/shared`: legacy, don't copy it.
- Need another module's data? Declare the narrow port you need; the other module's
  repository satisfies it structurally and the composition root passes it in.

## Services (`service.ts`)

- The constructor takes a `deps` object of ports. Never the `Container`, never
  `new XRepository(...)`, never a Fastify type.
- Secrets-backed adapters stay lazy: `github: () => Promise<GitHubClient>`, so a missing
  key surfaces as `ConfigError` on use, as it does today.
- Order inside a use case: load → decide (domain) → persist → emit or enqueue after the
  write succeeded. A service is thin; if it grows `if`s over values, move them to domain
  (F8).

## Routes (`routes.ts`)

- `withTypeProvider<ZodTypeProvider>()`, a schema from `@devdigest/shared`,
  `getContext(app.container, req)`, one service call, then the status. `pulls/routes.ts`,
  `repos/routes.ts` and `settings/routes.ts` are models to copy; `repo-intel/routes.ts`
  (calls `container.jobs` and `container.repoIntel` itself) is the one not to.
- No SQL, no adapters, no business `if`s, no hand-parsing of `req.body`.
- Errors are `AppError` subclasses mapped once in `app.ts:207-258`. Fastify mechanics:
  `fastify-best-practices`. Details: [references/fastify-edge.md](references/fastify-edge.md).

## Persistence and transactions (`repository.ts`)

- The repository `implements` its port, scopes every query by `workspaceId`, and returns
  domain or contract types. Drizzle rows stay inside.
- Multi-write use cases must be atomic (`reviews/repository/run.repo.ts`,
  `agents/repository.ts` show how). One repository method = one consistency boundary
  (`db.transaction`); `update(id, fn)` when a decision needs the current row; a
  unit-of-work port when a use case spans repositories (T7, T9, T10).
- Never call an LLM, GitHub, git or the SSE bus inside a transaction: fetch first, write
  in one short transaction, emit after commit.
- Drizzle's site now documents v1; this repo is on 0.45 (T8), which wraps driver errors in
  `DrizzleQueryError` (read Postgres codes from `err.cause`). Patterns and code:
  [references/persistence-and-transactions.md](references/persistence-and-transactions.md).

## Adapters (`src/adapters/<tech>/`)

- Follow `server/docs/architecture.md` → "Adding an adapter": port in
  `vendor/shared/adapters.ts`, class in `src/adapters/<name>/`, lazy getter, override key,
  mock in `src/adapters/mocks.ts`.
- An adapter knows its SDK and the port, nothing else: no `src/modules/**`, no
  `src/db/**`. A port backed by Postgres is a repository, not an adapter.
- Parse what the outside world returns (GitHub payloads, LLM JSON, CLI output) inside the
  adapter, so the core receives typed values.

## reviewer-core

- It is the engine's domain core: pure except for the injected `LLMProvider`.
- `src/llm/openrouter.ts` is its one adapter; only it may import the `openai` client.
  `src/llm/structured.ts` may use `openai/helpers/zod`, which is a schema helper.
- `server/` imports it only as `@devdigest/reviewer-core`, and only the container builds
  `OpenRouterProvider`, from the `@devdigest/reviewer-core/llm/openrouter.js` subpath: the
  package index does not export it (`onion-core-provider-in-root-only`).

## Testing by ring

| Ring | Test with | Lane |
| --- | --- | --- |
| Domain | plain inputs → outputs | unit |
| Service | in-memory fakes of its ports; assert on state, not calls (F11, T15) | unit |
| Repository | real Postgres via Testcontainers + the port's contract suite (T16) | `*.it.test.ts` |
| Route | `buildApp({ overrides })` + `app.inject()` (T4) | unit or `.it` |

Never fake a service's dependencies with `as unknown as Container` plus private-field
overwrites (`test/repo-intel-resync.test.ts:30-51`). Details:
[references/testing.md](references/testing.md).

## Enforcement (`pnpm arch`)

- `cd server && pnpm arch` cruises `src` and `../reviewer-core/src`; it needs
  `npm ci` in `reviewer-core` first. Type-only imports count. CI runs it with
  `pnpm arch:stale` in `server-unit.yml` → `typecheck`.
- A failure names the rule and the edge. Fix the import by moving code to the right ring
  or introducing a port; the rule's `comment` says which.
- Paid down a known violation? `pnpm arch:baseline`, then
  `node .claude/skills/onion-architecture/scripts/baseline-diff.mjs` must report `added 0`.
- `app.container.db` is a property, not an import, so `pnpm arch` can't see a route that
  queries or drives an adapter through it; `test/routes-container-ratchet.test.ts` counts
  `container.db` and `container.<member>.<method>(` per routes file, and the counts only go down.
- Never regenerate the baseline to hide a new violation, never loosen a rule to get green,
  and never rename a rule without regenerating the baseline and the user's OK.

Rule table, options and blind spots: [references/enforcement.md](references/enforcement.md).

## Scope discipline

- **New files** follow every rule here.
- **Files you touch** gain no new violating import (CI enforces it). Fix an existing
  violation in the same file when it is cheap and local; otherwise list it and ask.
- **Adding more of a frozen pattern is still new debt.** Another adapter call in a
  repo-intel pipeline file passes `pnpm arch` (the pair is already baselined) but breaks
  this skill: put new I/O behind a port.
- Leave `src/modules/repo-intel/` internals and untouched modules alone
  (`server/CLAUDE.md` → Do not touch). A bulk refactor is a separate task.
- Docs that cite moved code (`server/docs/architecture.md`, specs) change in the same
  commit; `INSIGHTS.md` only through the `engineering-insights` script.

## Review checklist

- [ ] New logic sits in the ring the "Where does this code go?" walk gives.
- [ ] `domain.ts` does no I/O and reads no clock.
- [ ] Ports are role-named and carry no rows, `Db`, tx, SDK or Fastify types.
- [ ] The service takes ports, not the `Container`, and builds no repository.
- [ ] Routes hold no SQL, no adapter calls, no business `if`s.
- [ ] SQL lives in `repository.ts`, which `implements` a port and scopes by `workspaceId`.
- [ ] Multi-write use cases are atomic; no external call inside a transaction.
- [ ] Adapters import neither `src/modules/**` nor `src/db/**`.
- [ ] Service tests use fakes of ports; repositories have `*.it.test.ts`.
- [ ] `pnpm arch`, `pnpm arch:stale` and the routes ratchet test pass; `baseline-diff.mjs`
  reports `added 0`.
- [ ] No new instance of a baselined pattern in a touched legacy file.

## Reference files

| File | Read when |
| --- | --- |
| [references/devdigest.md](references/devdigest.md) | mapping a file to its ring, or touching legacy code |
| [references/layers-and-ports.md](references/layers-and-ports.md) | writing domain, ports or a service; good/bad examples |
| [references/persistence-and-transactions.md](references/persistence-and-transactions.md) | writing a repository or anything multi-write |
| [references/fastify-edge.md](references/fastify-edge.md) | adding or changing a route |
| [references/testing.md](references/testing.md) | testing a service, repository or route |
| [references/enforcement.md](references/enforcement.md) | `pnpm arch` fails, or changing a rule |
| [references/sources.md](references/sources.md) | the articles and docs behind each rule |
