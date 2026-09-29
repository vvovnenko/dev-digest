# Enforcement: `pnpm arch` (dependency-cruiser)

## Contents
- Commands
- The rules
- Options and why each is there
- The baseline: freeze, then only shrink
- Reading a failure
- What the tool can't see
- Changing a rule

Config: `server/.dependency-cruiser.cjs`. Baseline:
`server/.dependency-cruiser-known-violations.json`. dependency-cruiser 17.4.3 is already a
server dependency, so no install is needed (T12, T13).

## Commands

Run from `server/`. `reviewer-core` must have its deps (`cd reviewer-core && npm ci`),
or `openai`/`zod` imports are unresolvable.

| Command | Does | Exit ≠ 0 when |
| --- | --- | --- |
| `pnpm arch` | cruises `src` + `../reviewer-core/src`, ignores baselined violations | a violation is not in the baseline |
| `pnpm arch:stale` | regenerates the baseline to stdout and diffs it with the committed file | the baseline lists a violation that is gone (or misses one) |
| `pnpm arch:baseline` | rewrites the baseline file | — (only after fixing violations) |
| `node .claude/skills/onion-architecture/scripts/baseline-diff.mjs [ref]` | compares the baseline with `ref` (default `HEAD`), per rule | an entry was added |

CI (`.github/workflows/server-unit.yml`, job `typecheck`) runs `pnpm arch` and
`pnpm arch:stale` after `pnpm typecheck`.

## The rules

Paths are relative to `server/`; reviewer-core files appear as `../reviewer-core/src/…`.

| Rule | From | Forbids | Typical fix |
| --- | --- | --- | --- |
| `onion-domain-pure` | `modules/<m>/domain.ts` | anything but own domain, `@devdigest/shared`, `platform/errors.ts`, `zod` | pass data or a function in as an argument |
| `onion-ports-pure` | `modules/<m>/ports.ts` | anything but own domain/ports and `@devdigest/shared` | describe the need in domain/contract types |
| `onion-app-no-infra` | module files that are not routes/repository/domain/ports | `src/db/**`, Drizzle/postgres, repositories, adapters, SDKs, Fastify, `node:fs`/`child_process`/`os`/…, `dotenv`, `platform/{container,jobs,config,sse,prompts}`, `app`/`server` | take a port in the constructor |
| `onion-routes-http-only` | `routes.ts`, `_shared/context.ts` | db, Drizzle, repositories, adapters, SDKs, fs I/O | move the query to a repository, the logic to the service |
| `onion-repo-persistence-only` | `repository.ts`, `*.repo.ts` | routes, services, Fastify, adapters, SDKs, platform infrastructure | a repository only stores and loads |
| `onion-no-cross-module` | `modules/<a>/**` | `modules/<b>/**` except `_shared` | a port of yours, satisfied in `platform/container.ts`; or a shared contract |
| `onion-adapters-outer-ring` | `src/adapters/**` | `src/modules/**`, `src/db/**`, Drizzle, Fastify, platform infrastructure, root | pass config in; a DB-backed port is a repository |
| `onion-platform-no-features` | `src/platform/**` except `container.ts` | modules, adapters, root | move wiring into the container |
| `onion-kernel-pure` | `vendor/shared/**`, `platform/errors.ts` | anything but themselves and `zod` | keep the kernel dependency-free |
| `onion-db-no-upward` | `src/db/**` | modules, adapters, platform, Fastify, SDKs | seed data belongs to `db/` itself |
| `onion-core-public-api-only` | `src/**` | `../reviewer-core/**` except `src/index.ts` and `src/llm/openrouter.ts` | import `@devdigest/reviewer-core` |
| `onion-core-provider-in-root-only` | `src/**` except `platform/container.ts` | `../reviewer-core/src/llm/openrouter.ts` | take an `LLMProvider` port; the container builds the provider |
| `core-no-server-src` | `reviewer-core/src/**` | server `src/**` except `vendor/shared` | only contracts cross into the engine |
| `core-no-infra` | `reviewer-core/src/**` | Drizzle, Fastify, Octokit, simple-git, Anthropic SDK, ast-grep, ripgrep, p-queue, dotenv, `node:fs`/… | inject it through `ReviewInput` |
| `core-llm-sdk-in-provider-only` | `reviewer-core/src/**` except `llm/openrouter.ts` | `openai` (except `openai/helpers/*`) | go through `LLMProvider` |
| `no-circular` | anything | import cycles, type-only edges included | invert one edge with a port |
| `not-to-unresolvable` | anything | imports that don't resolve | install deps; never baseline it |
| `no-orphans` | a file nothing imports and that imports nothing | — | delete it or wire it in |
| `no-unreachable-from-entry` | `src/server.ts`, `src/db/migrate.ts`, `src/db/seed.ts` | any `src/` or engine file they never reach (tests aren't cruised) | delete the dead code, or wire it in; exempt: the entries, `adapters/mocks.ts`, `settings/feature-models.ts` (pre-staged, tested) |

Allowed on purpose: application code may import `platform/errors`, `run-logger`,
`price-book`, `resilience` and the reviewer-core re-export `structured`. The composition root (`app.ts`, `server.ts`,
`platform/container.ts`, `modules/index.ts`) is exempt from the direction rules.

## Options and why each is there

| Option | Why |
| --- | --- |
| `tsPreCompilationDeps: true` | `import type { Db }` or a row type still couples rings; without it type-only imports are invisible |
| `tsConfig: { fileName: 'tsconfig.json' }` | resolves `@devdigest/shared` and `@devdigest/reviewer-core` path aliases, also for reviewer-core files |
| `preserveSymlinks: true` | pnpm may lay out `node_modules` isolated (symlinks into `.pnpm/`) or hoisted (`server/.npmrc`), depending on its version; without it the `to` paths, and so the baseline keys, differ between machines and CI |
| `enhancedResolveOptions.exportsFields: ['exports']` | `p-queue` and `octokit` have no `main`, only `exports` |
| `exclude` anchored (`^dist/`, `^clones/`) | `exclude` also matches resolved `node_modules` paths: an unanchored `dist/` silently drops every import of a package whose entry is in `dist/` (`p-queue`, `simple-git`) |
| `doNotFollow: node_modules` | packages are targets, not analysed |
| `\.test\.ts$` excluded | tests may import anything to build fakes |

The code imports `./x.js` for `x.ts`; dependency-cruiser resolves that on its own.

## The baseline: freeze, then only shrink

A known violation is matched by rule name, `from` and `to` (and cycle members). What
that means:

- **New code can't add a new violating pair.** `pnpm arch` fails.
- **More calls through an already-baselined pair pass.** Another `readFile` in a
  repo-intel pipeline file is invisible to the tool; the skill's scope rules and review
  catch it.
- **A fixed violation must leave the baseline**, or it would silently re-allow the same
  import later. `pnpm arch:stale` fails until you run `pnpm arch:baseline`.
- **Moving or renaming a legacy file re-keys its entries**: they show up as new. Fix them
  in the move, or ask the user before regenerating.

Workflow after paying down debt:

```sh
cd server
pnpm arch                         # green first — never regenerate over a new violation
pnpm arch:baseline                # rewrite the file
node ../.claude/skills/onion-architecture/scripts/baseline-diff.mjs   # must say "added 0"
pnpm arch:stale                   # green
```

Commit the smaller baseline with the fix. Never run `pnpm arch:baseline` to make a red
`pnpm arch` green.

## Reading a failure

```text
  error onion-app-no-infra: src/modules/repos/service.ts → node_modules/drizzle-orm/index.d.ts
    Application code (service.ts and every other module file …) … Skill: onion-architecture → Services.
```

The first line is the rule and the edge; the indented text is the rule's `comment`, which
names the section of `SKILL.md` to read. `--output-type err-long` prints the comment.
For the full graph of one file:
`pnpm exec depcruise src/modules/<m>/service.ts --config .dependency-cruiser.cjs -T text`.

## What the tool can't see

- Member access: `app.container.db` used in a route is not an import. For routes this
  gap is closed by `server/test/routes-container-ratchet.test.ts` (unit lane, so CI): it
  counts `container.db` and `container.<member>.<method>(` per `routes.ts`, allows only
  `repo-intel/routes.ts: 2`, and fails when a count rises or falls (lower the allowance
  when you remove one). Wiring a service (`jobs: container.jobs`,
  `github: () => container.github()`) is not counted.
- Globals: `fetch`, `process.env`, `setTimeout` need no import.
- Dynamic `import()` with a non-literal specifier.
- More uses of an already-baselined `(from, to)` pair.

Apart from the ratchet, these are covered by the review checklist in `SKILL.md`, not by
CI (A1: document the rules, enforce what a tool can, allow documented exceptions).

## Changing a rule

- A rule change is its own change, with the user's OK: widening a rule hides violations.
- Rule names are baseline keys. Renaming one re-reports all its known violations as new;
  rename only together with `pnpm arch:baseline`, and show the `baseline-diff.mjs`
  output in the change.
- Adding a rule: run `pnpm arch` without the baseline first
  (`pnpm exec depcruise src ../reviewer-core/src --config .dependency-cruiser.cjs -T err`)
  and decide with the user whether its legacy hits are fixed or frozen.
- A new platform file: classify it (pure helper or infrastructure) and update
  `PLATFORM_INFRA` in the config and the ring map in [devdigest.md](devdigest.md) together.
- Why not ESLint `eslint-plugin-boundaries` (T14): the repo has no ESLint setup, while
  dependency-cruiser is already a dependency and runs in CI without an editor.
