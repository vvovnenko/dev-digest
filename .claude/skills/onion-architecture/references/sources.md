# Sources

The articles and docs behind the rules. IDs (F1, T7, …) are cited in `SKILL.md` and the
other reference files. Researched and link-checked on 2026-09-27; the version notes at
the end say where a source describes a newer version than this repo pins.

## Contents
- Foundations (F)
- Node and TypeScript (N)
- Tools (T)
- Anti-patterns and counterweights (A)
- Further reading
- Version notes

## Foundations (F)

| ID | Source | Takeaway for this skill |
| --- | --- | --- |
| F1 | Jeffrey Palermo, The Onion Architecture, [part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) · [part 2](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-2/) · [part 3](https://jeffreypalermo.com/2008/08/the-onion-architecture-part-3/) | "All coupling is toward the center." Repository and service interfaces live in the core, implementations at the edge; the database is external, not the center. |
| F2 | Jeffrey Palermo, [Onion Architecture: Part 4 – After Four Years](https://jeffreypalermo.com/2013/08/onion-architecture-part-4-after-four-years/) | Inner layers define interfaces, outer layers implement them, the core compiles without infrastructure. Works fine without an IoC container, so the hand-rolled `Container` is enough. |
| F3 | Alistair Cockburn, [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) | The app is driven equally by users, tests and scripts, and runs apart from its devices and DB. A port is a purposeful conversation, not an SDK wrapper. |
| F4 | Robert C. Martin, [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) | The Dependency Rule: source dependencies point inward. Only simple data crosses a boundary — don't pass entities or database rows. |
| F5 | Herberto Graça, [DDD, Hexagonal, Onion, Clean, CQRS… how I put it all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) | Ports belong to the core and are shaped by its needs. Primary adapters (HTTP) call use cases; secondary adapters (DB, LLM) implement ports; components don't import each other. |
| F6 | Martin Fowler, [PresentationDomainDataLayering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html) | In a larger app, split into domain modules first and layer inside each module — the `src/modules/<name>/` layout. |
| F7 | Martin Fowler, [Repository (PoEAA)](https://martinfowler.com/eaaCatalog/repository.html) | A repository mediates between domain and data mapping and acts like a collection of domain objects: it speaks domain types, not SQL rows. |
| F8 | Martin Fowler, [AnemicDomainModel](https://martinfowler.com/bliki/AnemicDomainModel.html) | The service layer coordinates; business rules belong in the domain. A fat service over data-only types is the anti-pattern. |
| F9 | Mark Seemann, [Layers, Onions, Ports, Adapters: it's all the same](https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/) | Onion, hexagonal and clean are layering plus dependency inversion. Enforce one dependency rule instead of debating names. |
| F10 | Mark Seemann, [Functional architecture is Ports and Adapters](https://blog.ploeh.dk/2016/03/18/functional-architecture-is-ports-and-adapters/) | A pure core with impure edges is ports and adapters by construction. |
| F11 | Mark Seemann, [Stubs and mocks break encapsulation](https://blog.ploeh.dk/2022/10/17/stubs-and-mocks-break-encapsulation/) | Favour fakes over dynamic mocks: a fake keeps the port's contract, so refactoring doesn't break tests. |
| F12 | Gary Bernhardt, [Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) | Decisions in pure functions, I/O in a thin orchestrating shell — `domain.ts` vs `service.ts`. |
| F13 | Alexis King, [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) | Parse untrusted input into precise types once, at the boundary; inner code relies on the type. |
| F14 | Microsoft, [Common web application architectures](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) | Application Core holds entities, interfaces and domain services; infrastructure implements the interfaces; wiring happens only in the composition root. |

## Node and TypeScript (N)

| ID | Source | Takeaway for this skill |
| --- | --- | --- |
| N1 | goldbergyoni/nodebestpractices, [Layer your components, keep the web framework within its boundaries](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/createlayers.md) | Entry-points, domain, data-access per component; the web framework stays in the entry point and the domain handles plain objects. |
| N2 | goldbergyoni/nodebestpractices, [Structure your solution by business components](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/breakintcomponents.md) | Folders per business component, not per technical role. |
| N3 | Sairyss, [Domain-Driven Hexagon](https://github.com/Sairyss/domain-driven-hexagon) | Ports, mappers, DTO whitelisting and dependency-cruiser enforcement in TypeScript — and a warning that full separation is overkill for small apps. |
| N4 | Khalil Stemmler, [Implementing DTOs, Mappers & the Repository Pattern](https://khalilstemmler.com/articles/typescript-domain-driven-design/repository-dto-mapper/) | The repository is a facade over the ORM with `toDomain`/`toPersistence`/`toDTO` mappers, so ORM shapes never reach controllers. |

## Tools (T)

| ID | Source | Takeaway for this skill |
| --- | --- | --- |
| T1 | Fastify, [Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/) | Each `register` creates a child context; decorators and hooks flow down, never up, unless wrapped with `fastify-plugin`. Modules are isolated plugins. |
| T2 | Fastify, [Decorators](https://fastify.dev/docs/latest/Reference/Decorators/) | Decorated objects are shared by every request; keep them immutable. Here the only decorator is `app.container`. |
| T3 | Fastify, [Getting Started](https://fastify.dev/docs/latest/Guides/Getting-Started/) | Load order: ecosystem plugins → your plugins → decorators → hooks → services/routes. |
| T4 | Fastify, [Testing](https://fastify.dev/docs/latest/Guides/Testing/) | Separate the app factory from `listen`, test with `app.inject()`, always `close()`. |
| T5 | Fastify, [Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/) | Type providers infer types only and don't propagate: every route plugin calls `withTypeProvider()`. |
| T6 | Matteo Collina, [Building a modular monolith with Fastify](https://gitnation.com/contents/building-a-modular-monolith-with-fastify) | Domain modules as plugins, no singletons, break encapsulation only on purpose. |
| T7 | Drizzle, [Transactions](https://orm.drizzle.team/docs/transactions) | `db.transaction(async (tx) => …)`, `tx.rollback()`, nested savepoints, isolation options; `tx` has the same API as `db`. |
| T8 | Drizzle, [v0 → v1 changes](https://orm.drizzle.team/docs/v0-v1-changes) | The site documents v1; on 0.45 keep `relations()` and the separate `drizzle-zod` package. |
| T9 | Lazar Nikolov (Sentry), [Atomic Repositories in Clean Architecture and TypeScript](https://blog.sentry.io/atomic-repositories-in-clean-architecture-and-typescript/) | With Drizzle: repository methods take an optional `tx`, the use case opens the transaction. This skill prefers a unit-of-work port so `tx` stays out of port signatures. |
| T10 | Miłosz Smółka (Three Dots Labs), [Database transactions in Go with layered architecture](https://threedots.tech/post/database-transactions-in-go/) | Language-agnostic: prefer `update(id, updateFn)` so the repository owns the transaction and the logic stays in the domain; don't pass `tx` via context; don't make one repository per table. |
| T11 | turkerdev, [fastify-type-provider-zod](https://github.com/turkerdev/fastify-type-provider-zod) | Set the validator and serializer compilers once; route plugins use the Zod type provider. 4.x supports Zod 3, 5.x needs Zod 4. |
| T12 | dependency-cruiser, [Rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) · [Rules tutorial](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-tutorial.md) | `forbidden` rules with `from`/`to` `path`/`pathNot`, `circular`, `couldNotResolve`, and `$1` capture groups for "same module" rules. |
| T13 | dependency-cruiser, [Options reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md) | `tsPreCompilationDeps` to see type-only imports, `tsConfig` for aliases, `preserveSymlinks`, `enhancedResolveOptions.exportsFields`. |
| T14 | JS Boundaries, [eslint-plugin-boundaries rules](https://www.jsboundaries.dev/docs/rules/) | The in-editor alternative (`boundaries/dependencies`); not chosen because the repo has no ESLint. |
| T15 | Andrew Trenk, Dillon Bly — Software Engineering at Google, [ch. 13 Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html) | Prefer real → fake → stub → interaction testing; the owner of an implementation maintains its fake; contract-test fakes against the real thing. |
| T16 | Testcontainers for Node.js, [PostgreSQL module](https://node.testcontainers.org/modules/postgresql/) | `new PostgreSqlContainer(image).start()`, `getConnectionUri()`, snapshots between tests. |
| T17 | Vitest, [v2 config reference](https://v2.vitest.dev/config/) | `globalSetup` with `provide`/`inject` can share one container per run; the v2 signature differs from current docs. |

## Anti-patterns and counterweights (A)

| ID | Source | Takeaway for this skill |
| --- | --- | --- |
| A1 | Matthias Noback, [Lasagna code – too many layers?](https://matthiasnoback.nl/2018/02/lasagna-code-too-many-layers/) | Failed layering is just indirection. Document the rules, enforce them with tools, allow deliberate, documented exceptions. |
| A2 | Mihai Mogosanu, [The Generic Repository Is An Anti-Pattern](https://blog.sapiensworks.com/post/2012/03/05/The-Generic-Repository-Is-An-Anti-Pattern.aspx) | The repository serves the application's needs, not the database's: no `Repository<T>` as a port. |
| A3 | Ben Morris, [Why the generic repository is just a lazy anti-pattern](https://www.ben-morris.com/why-the-generic-repository-is-just-a-lazy-anti-pattern/) | A generic repository is a helper, not a contract; it leaks query concerns into the domain. |
| A4 | Vladimir Khorikov, [Having the domain model separated from the persistence model](https://enterprisecraftsmanship.com/posts/having-the-domain-model-separate-from-the-persistence-model/) | A fully separate persistence model often costs more than it gains: map only where the shapes differ. |

## Further reading

- Allegro Tech, [Onion Architecture](https://blog.allegro.tech/2023/02/onion-architecture.html)
- Code Maze, [Onion Architecture in ASP.NET Core](https://code-maze.com/onion-architecture-in-aspnetcore/)
- [jbuget/nodejs-clean-architecture-app](https://github.com/jbuget/nodejs-clean-architecture-app) · [practica.js](https://github.com/practicajs/practica)
- Fastify, [Plugins](https://fastify.dev/docs/latest/Reference/Plugins/) · [fastify-plugin](https://github.com/fastify/fastify-plugin)
- Drizzle, [type API (`$inferSelect`)](https://orm.drizzle.team/docs/goodies) · [drizzle-zod](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-zod/README.md)
- Martin Fowler, [Mocks Aren't Stubs](https://martinfowler.com/articles/mocksArentStubs.html) · James Shore, [Testing Without Mocks](https://www.jamesshore.com/v2/projects/nullables/testing-without-mocks)

## Version notes

| Tool | This repo | The docs now show | Consequence |
| --- | --- | --- | --- |
| Drizzle | 0.45.3 | v1 (T8) | keep `relations()`, callback `where`, `drizzle-zod`; don't copy `defineRelations` or `drizzle-orm/zod` |
| Zod | 3 | 4 | keep `fastify-type-provider-zod` on 4.x (T11) |
| Vitest | 2 | 3+ | use the v2 config docs (T17) |
| eslint-plugin-boundaries | not used | `boundaries/dependencies` replaces `element-types` | ESLint runs (typescript-eslint), but boundaries stay with dependency-cruiser (T14) |
