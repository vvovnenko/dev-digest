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

`src/modules/repos/routes.ts` is the model:

```ts
export default async function reposRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new RepoService(app.container);         // legacy: new code passes ports

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
adapter calls and no business `if`s (N1, F4). `pulls/routes.ts` is the legacy
counterexample: Drizzle queries, GitHub sync and roll-up rules in handlers.

Checked by `onion-routes-http-only`: a route may not import `src/db/**`, Drizzle,
a repository, an adapter, an SDK or `node:fs`.

## Parse at the edge

- Put the Zod schema in the route options (`schema: { body, params, querystring }`) so
  `fastify-type-provider-zod` validates before the handler runs, and `req.body` is
  already typed (F13, T5, T11). Every route plugin calls
  `withTypeProvider<ZodTypeProvider>()` itself: type providers don't propagate (T5).
- Schemas come from `@devdigest/shared` (`RepoInput`, `IdParams` from `_shared/schemas.ts`).
  A new request shape is a contract change: add it to `server/src/vendor/shared/` and
  mirror it in `client/src/vendor/shared/`.
- Don't hand-parse: `reviews/routes.ts:32` (`RunRequest.parse(req.body ?? {})`) is legacy.
- No route declares a `response` schema today, so responses are not filtered. Adding one
  changes what the client sees; treat it as a contract decision.
- Services take the parsed values and never re-validate them.

## Errors

- Services and domain throw `AppError` subclasses from `src/platform/errors.ts`
  (`NotFoundError` 404, `ValidationError` 422, `ExternalServiceError` 502, `ConfigError` 500).
- `src/app.ts:116-164` maps them once: Zod validation → 422, `AppError` → its status,
  everything else → 500, always `{ error: { code, message, details } }`.
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
  `FastifyRequest` and the `Container`; don't pass either further in.
- A new cross-module HTTP helper in `_shared/` that imports Fastify is flagged by
  `pnpm arch` until `HTTP_HELPER` in `.dependency-cruiser.cjs` is widened: a deliberate
  rule change (see [enforcement.md](enforcement.md)).

## Streaming (SSE)

- SSE endpoints (`fastify-sse-v2`) are transport: the route subscribes to the run bus and
  writes events.
- Producers in the application ring publish through a port (`RunEvents`), never by
  importing `platform/sse.ts`: its `runBus` is a process-wide singleton
  (`src/platform/sse.ts:103`).
