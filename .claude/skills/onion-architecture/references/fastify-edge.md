# The HTTP edge: Fastify routes in an onion

## Contents
- A thin route
- Parse at the edge
- Errors
- Plugins, encapsulation and the container
- Streaming (SSE)

Fastify mechanics (hooks, schemas, serialization, plugins) belong to
`fastify-best-practices`. This file covers what a route may and may not contain.

## A thin route

`src/modules/repos/routes.ts:20-39` is the model:

```ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new RepoService({
    repos: container.reposRepo,
    jobs: container.jobs,
    git: () => container.git,
    indexing: container.repoIndexing,
    log: app.log,
  });

  app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const { repo, created } = await service.add(workspaceId, userId, req.body.url);
    reply.status(created ? 201 : 200);
    return repo;
  });
}
```

A handler does four things: take the parsed input, resolve `workspaceId` with
`getContext`, call one service method, and pick the status. It contains no SQL, no
adapter calls and no business `if`s (N1, F4). `repo-intel/routes.ts` is the remaining
counterexample: its handlers call `container.repoIntel` and `container.jobs` directly.

Checked by `onion-routes-http-only`: a route may not import `src/db/**`, Drizzle,
a repository, an adapter, an SDK or `node:fs`. What an import rule can't see — a handler
using `container.db` or calling `container.<member>.<method>(` — is counted by
`server/test/routes-container-ratchet.test.ts`, whose counts may only go down.

## Parse at the edge

- Put the Zod schema in the route options (`schema: { body, params, querystring }`) so
  `fastify-type-provider-zod` validates before the handler runs, and `req.body` is
  already typed (F13, T5, T11). Every route plugin calls
  `withTypeProvider<ZodTypeProvider>()` itself: type providers don't propagate (T5).
- Schemas come from `@devdigest/shared` (`RepoInput`, `IdParams` from `_shared/schemas.ts`).
  A new request shape is a contract change: add it to `server/src/vendor/shared/` and
  mirror it in `client/src/vendor/shared/`.
- Don't hand-parse. An optional body is still a schema: `reviews/routes.ts:40`
  (`body: RunRequest.optional()`).
- The main GET routes declare a `response` schema from `@devdigest/shared` (e.g.
  `reviews/routes.ts:191`). The serializer runs the reply through it, so a reply that drifts
  from its contract is a 500 (`app.ts:224-229`), and keys the schema lacks are dropped: add a
  field to the contract before the route returns it.
- Services take the parsed values and never re-validate them.

## Errors

- Services and domain throw `AppError` subclasses from `src/platform/errors.ts`
  (`NotFoundError` 404, `ValidationError` 422, `ExternalServiceError` 502, `ConfigError` 500).
- `src/app.ts:207-258` maps them once, always `{ error: { code, message, details } }`:
  request validation → 422, `AppError` → its status, Fastify's own 4xx (bad JSON, 413,
  415, 429 from the rate limit) → their status with a stable code, anything else —
  including our own data failing a Zod parse — → 500 `internal_error` with a generic
  message (the raw one goes to the log only). Unknown routes get the same envelope.
- A route doesn't catch and translate errors itself, and a service doesn't import
  `FastifyReply` to set a status.

## Plugins, encapsulation and the container

- Each module is one encapsulated plugin (default export of `routes.ts`) registered
  statically in `src/modules/index.ts`; `@fastify/autoload` is installed but unused
  (T1, T6).
- The only decorator is `app.container` (`src/app.ts`). Don't decorate services or
  repositories onto the instance, although `fastify-best-practices` shows that pattern:
  here services are built in the plugin from container-provided ports, which keeps them
  testable without Fastify (T2, F2).
- `getContext` (`src/modules/_shared/context.ts`) is the HTTP helper that may see both
  `FastifyRequest` and the `Container`; don't pass either further in. Its
  `requireRepoInWorkspace` (`:30`) is the tenancy check for a module that addresses repos
  by id without owning them (repo-intel).
- A new cross-module HTTP helper in `_shared/` that imports Fastify is flagged by
  `pnpm arch` until `HTTP_HELPER` in `.dependency-cruiser.cjs` is widened: a deliberate
  rule change (see [enforcement.md](enforcement.md)).

## Streaming (SSE)

- SSE endpoints (`fastify-sse-v2`) are transport: the route subscribes to the run bus and
  writes events.
- Producers in the application ring publish through a port (`RunEvents`), never by
  importing `platform/sse.ts`: the bus belongs to the container, one per app
  (`src/platform/container.ts:114`, overridable in tests).
- A stream must end and must let go: `reviews/routes.ts` 404s another workspace's run,
  replays the persisted trace for a finished one (`:76`), sends a heartbeat comment while
  idle (`:111`) and releases its subscription on the response's `close` (`:126`) — the
  plugin just stops pulling, so the generator's `finally` never runs.
