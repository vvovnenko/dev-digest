# Next.js App Router: structure and boundaries

This file is about architecture: where things go and which way data flows. For
file-convention and API mechanics (special files, async params, metadata, route segment
config), use `next-best-practices`.

## Contents
- Choosing a project organization strategy
- Structure inside `app/`
- page, layout, template: who owns what
- The Server/Client boundary
- Choosing one data model
- Server Actions and Route Handlers, if you adopt them
- Environment variables
- Sources

## Choosing a project organization strategy

Next.js is deliberately unopinionated. It documents three valid strategies:

1. **Routing-only `app/`.** All code lives outside `app/`, e.g. `src/features`,
   `src/components`, `src/lib`, and route files only import and compose.
2. **Top-level folders inside `app/`.** Shared code lives in folders such as `app/ui`
   and `app/lib`.
3. **Split by feature or route.** Shared code sits at the root, and route-specific code
   is colocated inside each route segment.

Pick one and apply it consistently. DevDigest uses **3**: route-local UI in `_components/`
inside the route, shared UI in `src/components/`, shared non-UI code in `src/lib/`, and
the `src/` directory with the `@/*` alias.

Methodologies built on strategy 1 are larger frameworks, not drop-ins:

- **bulletproof-react** uses a `features/` tree with one-way imports, shared → features →
  app.
- **Feature-Sliced Design** uses layers and slices, and needs `app/` and `pages/` renamed
  when used with Next.js.

Consider them only for a deliberate restructure, never piecemeal inside one feature.

Sources: A1, A5, A10, A11.

## Structure inside `app/`

- A folder becomes a public route only when it contains `page.tsx` or `route.ts`. Other
  files can be colocated safely.
- **Private folders** (`_components`, `_lib`) are excluded from routing. They mark code
  as belonging to that route, and they can't collide with future Next.js file names.
  Colocated UI goes in them.
- **Route groups** `(name)` organize routes without changing the URL, and can give a set
  of routes its own layout. Use them for a real reason, such as a shared layout, a
  section or a team boundary, not as decoration. Two groups that resolve to the same URL
  are a build error.
- Keep nesting shallow. Past three or four levels of folders, look for a missing
  promotion to shared code.

Sources: A1, A2, A9.

## page, layout, template: who owns what

| File | Owns | Keep out |
| --- | --- | --- |
| `layout.tsx` | UI shared by a subtree: shell, providers, navigation. It persists across navigation and keeps its state | page-specific data and logic |
| `template.tsx` | like a layout, but remounts on navigation. Use it only when state or effects must reset per page | anything a layout can do |
| `page.tsx` | the route's entry: read params and search params, choose the view, compose it | filtering, sorting, mapping (use helpers); long JSX (use `_components`) |
| `loading.tsx` / `error.tsx` / `not-found.tsx` | route-level fallbacks | per-widget states (keep those in the component) |

A page that grows past composition is the most common architectural smell in App Router
code. Move logic to helpers and markup to `_components` before adding more.

Sources: A2, A3, A20.

## The Server/Client boundary

- **Server by default.** A component is a Server Component unless its file, or a module
  that imports it, starts with `"use client"`. The directive marks an *entry* into the
  client graph: everything that file imports becomes client code.
- **Put the boundary as low as possible.** Mark the interactive leaf (a filter bar, a
  button group), not the page, so static content stays on the server.
- **Thin server page, client view.** When the whole screen is interactive, the page can
  stay a server file that renders one client view. DevDigest does this on every route,
  e.g. `src/app/(shell)/agents/page.tsx` → `AgentsListView`; the server page also
  exports `generateMetadata` for the tab title.
- **Crossing the boundary:**
  - Code crosses through imports; data crosses through props.
  - Props must be serializable.
  - Pass only the fields the client needs, not whole records.
  - Server-rendered content can be passed into a client component as `children`.
- **Providers** go in one small client component. Render them as deep in the tree as
  their consumers allow.
- **Guard modules.** `import "server-only"` makes a module fail the build if client code
  imports it (secrets, database access). `"client-only"` does the reverse.

Sources: A4, B5, B13.

## Choosing one data model

The Next.js security guide describes three models and advises picking one per app:

| Model | Fits | Where data code lives |
| --- | --- | --- |
| External HTTP API | an existing backend service | a client or server fetch layer that calls the API; the backend enforces auth |
| Data Access Layer (DAL) | a new Next.js app owning its database | `server-only` modules that authorize and return minimal DTOs; only they read `process.env` secrets |
| Component-level access | prototypes | queries inside Server Components (don't grow a product on this) |

**DevDigest is the external HTTP API model.** The Fastify API on `:3001` owns the data.
The client reaches it only through `src/lib/api.ts` and TanStack Query hooks in client
components. Nothing fetches on the server. Mixing in a DAL, server-side fetches or Server
Actions would create a second data path with its own caching and error handling, so it
needs an explicit decision.

If server-side fetching is ever adopted alongside TanStack Query:

- Server Components only prefetch into a per-request `QueryClient`.
- The client hydrates through `HydrationBoundary`.
- The same query data must not be rendered by both a Server and a Client Component,
  because the server copy can't revalidate.

Sources: B6, B8, B10, B13, B19.

## Server Actions and Route Handlers, if you adopt them

- **Server Actions** are for mutations only:
  - Put them in dedicated files with `"use server"` at the top, e.g.
    `app/<route>/actions.ts` or `src/lib/actions/<domain>.ts`.
  - Keep them thin: authenticate, authorize and validate the input with a schema, then
    delegate to the data layer and return only what the UI needs.
  - Treat their arguments as hostile, because they are public endpoints.
- **Route Handlers** (`route.ts`) are public HTTP endpoints for webhooks, proxies and
  non-UI consumers. Server Components shouldn't call their own app's Route Handlers; call
  the data layer directly.
- If both exist, move the shared logic into the data layer and call it from both.

Sources: B7, B8, B13, B14.

## Environment variables

- Only `NEXT_PUBLIC_*` variables reach the browser. They are inlined at build time and
  frozen, so a change needs a rebuild. Dynamic lookups (`process.env[name]`) are not
  inlined.
- Read and validate environment variables in one module, and export typed values. Code
  that uses them imports the module, not `process.env`.
- Server secrets never get the `NEXT_PUBLIC_` prefix. In a DAL setup, only server-only
  modules read them.

In DevDigest, `NEXT_PUBLIC_API_BASE` is read once in `src/lib/api.ts`.

Sources: B6, B9, B26.

## Sources

IDs refer to the catalog in the skill's `README.md`.
