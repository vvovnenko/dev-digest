# Severity rubric and hard-rule catalog

The gate blocks a push on one CRITICAL, so CRITICAL has to mean "this must not
merge", not "I would have written it differently". A reviewer that inflates
severity teaches the team to waive, and then the gate protects nothing.

## The three levels

**CRITICAL** — only when this diff *introduces* one of:

1. **A hard rule broken** — a rule this repo owns, phrased as never / must / do not
   touch, in a `CLAUDE.md` or a **local** skill (`onion-architecture`,
   `frontend-ui-architecture`, `engineering-insights`). The catalog below lists them.
2. **A broken build or CI** — type error, failing test, a rule `pnpm arch` or a
   ratchet test enforces.
3. **A real vulnerability or leak** — exploitable injection, SSRF, path traversal,
   a secret in code or logs, a query that skips workspace scoping.
4. **Lost or corrupted data** — a destructive migration, a multi-write without a
   transaction that leaves half a state, a race that overwrites a terminal status.

**WARNING** — a real problem that should be fixed but doesn't meet the bar above:
a "prefer / should" from any skill, a maintainability issue, a missing test, a
correctness risk that needs an unusual input.

**SUGGESTION** — optional polish.

Rules that keep the bar honest:

- **Third-party skills** (`react-best-practices`, `next-best-practices`,
  `react-testing-library`, `fastify-best-practices`, `drizzle-orm-patterns`,
  `postgresql-table-design`, `zod`, `typescript-expert`, `security`) raise CRITICAL
  only for category `bug` or `security`. `verdict.mjs` caps anything else to WARNING,
  so don't fight it — choose the level the rubric gives.
- `mermaid-diagram` findings are capped at SUGGESTION.
- **Pre-existing problems never block.** If the problem is already on the base
  (`git show <base_sha>:<file>`), set `"introduced": false`; the report lists it,
  the gate ignores it.
- **The repo beats the skill.** When a skill's advice contradicts `CLAUDE.md` or a
  local skill (Tailwind vs `style={s.x}`, decorators vs `app.container`, mocking
  `fetch`), it is not a finding at all. The task's `suppress` list names the known ones.
- When unsure between two levels, take the lower one and say why in the rationale.

## `rule_id`

Every finding carries `rule_id: "<prefix>/<kebab-name>"`. For a hard rule use the
id from the catalog. Otherwise make one from the skill and the problem
(`react/effect-for-derived-state`, `drizzle/n-plus-one`, `bug/off-by-one`,
`sec/ssrf`). Waivers and `--stats` group by `rule_id` and file, so keep ids stable:
the same problem gets the same id every run.

## Hard-rule catalog (may be CRITICAL)

Deterministic checks (D1–D11) already cover secrets, do-not-touch paths,
migrations, the contract mirror, INSIGHTS, `pnpm arch`, typecheck and spec zones.
Don't duplicate them; the catalog below is what a reviewer judges by reading code.

### Backend — `onion-architecture`, `server/CLAUDE.md`, `reviewer-core/CLAUDE.md`

| rule_id | The diff… | Source |
| --- | --- | --- |
| `onion/inner-imports-outer` | makes an inner ring name an outer one: `domain.ts` imports db/Drizzle/Fastify/adapters/`node:*`; a service imports `Container`, `src/db/**`, a repository, an adapter or an SDK; a port's signature carries a Drizzle row, `Db`/tx or an SDK type | onion: Principles 1, ring table |
| `onion/route-no-sql` | puts SQL, a Drizzle table or an adapter call in `routes.ts` (incl. `container.db`, `container.x.y(`) | onion: Routes; `server/CLAUDE.md` Conventions |
| `onion/service-takes-container` | gives a new service the `Container`, or `new`s a repository/adapter outside the composition root | onion: Services, Principle 5 |
| `onion/io-in-transaction` | calls an LLM, GitHub, git or the SSE bus inside `db.transaction` | onion: Persistence and transactions |
| `onion/multi-write-not-atomic` | adds a use case with several writes that are not in one transaction | onion: Persistence and transactions |
| `onion/adapter-imports-core` | makes an adapter import `src/modules/**` or `src/db/**` | onion: Adapters |
| `server/missing-workspace-scope` | adds a repository query or handler path that doesn't scope by `workspaceId` | `server/CLAUDE.md`; onion: Persistence |
| `server/hand-parsed-body` | hand-parses `req.body` / `req.query` instead of a schema from `@devdigest/shared` | `server/CLAUDE.md` Conventions |
| `server/cross-module-repository` | imports another module's repository from that module's folder | `server/CLAUDE.md` Conventions |
| `server/pg-test-not-it` | adds a test that imports `test/helpers/pg.ts` but isn't named `*.it.test.ts` (the unit lane has no Docker) | `server/CLAUDE.md` Conventions |
| `core/impure` | gives `reviewer-core/src` DB, filesystem or env access, or uses the `openai` client outside `src/llm/openrouter.ts` | `reviewer-core/CLAUDE.md` |
| `core/grounding-bypass` | lets a model finding skip the citation-grounding gate | `reviewer-core/CLAUDE.md` Gotchas |
| `core/untrusted-unwrapped` | puts untrusted text (diff, PR body, repo map, specs) into a prompt without `wrapUntrusted()` | `reviewer-core/CLAUDE.md` |

WARNING, not CRITICAL: business `if`s in a route (`onion/route-business-logic`),
another instance of a baselined legacy pattern (`onion/new-frozen-pattern`), a
pass-through layer or generic `Repository<T>` (`onion/layer-without-purpose`),
`as unknown as Container` in a test (`onion/test-fakes-container`), a non-`AppError`
throw (`server/plain-error`).

### Frontend — `frontend-ui-architecture`, `client/CLAUDE.md`

| rule_id | The diff… | Source |
| --- | --- | --- |
| `ui/component-fetch` | makes a component, page or hook call `fetch`/the network directly instead of a hook over `src/lib/api.ts` (SSE in `useRunEvents` is the one exception) | ui-arch: Where does this code go? 2; `client/CLAUDE.md` |
| `ui/shared-imports-app` | makes `src/lib` or `src/components` import from `src/app` | ui-arch: Principle 2 |
| `ui/sibling-import` | imports from a sibling component's folder instead of the shared rung | ui-arch: Principle 2, Scope discipline |
| `ui/component-inside-component` | declares a component inside another component's body (remounts every render) | ui-arch: Components |
| `ui/server-data-in-state` | copies TanStack Query data into `useState` | ui-arch: State |
| `ui/second-data-path` | adds a Server Action, a Route Handler or server-side fetching | ui-arch: Next.js App Router ("ask first") |

WARNING, not CRITICAL: a new `utils.ts` / `export *` (`ui/catch-all-module`), an
`enum` (`ui/enum`), a constant inside a component body (`ui/constant-in-render`),
logic inline in `page.tsx` (`ui/fat-page`), an `onError` toast on a mutation
(`ui/double-toast`), hard-coded UI copy (`ui/hardcoded-copy`), a duplicated
design-system token (`ui/duplicate-token`), `style` not from a colocated `styles.ts`
(`ui/inline-style`).

### Specs (spec reviewer)

| rule_id | The diff… |
| --- | --- |
| `spec/acceptance-violated` | contradicts an explicit acceptance criterion of the spec (as amended) |
| `spec/scope-exceeded` | adds behaviour the spec lists as out of scope or unchanged (as amended) |

WARNING: `spec/acceptance-not-covered` — a criterion this diff doesn't implement
yet (a partial PR is fine; say which criterion).

### Any skill — category `bug` or `security`

`bug/<kebab>` for a defect that breaks behaviour on a normal input (crash, wrong
result, lost update); `sec/<kebab>` for an exploitable vulnerability. Both may be
CRITICAL from any skill. Explain the input that triggers it — a verifier will try
to refute it.
