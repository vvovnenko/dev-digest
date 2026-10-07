---
name: api-deprecation-policy
description: Apply when the diff removes or renames a route, field, parameter, enum value or exported symbol, or marks one as deprecated. Flag a removal that skips the deprecation step, and a deprecation that gives clients no marker, replacement or removal date.
type: convention
---
Removing part of a public contract takes two releases, not one. First the old route,
field or export is deprecated: it keeps working, and clients are told what replaces
it and when it goes away. Only after that window does a major release remove it.

**A deprecation is complete when it has all of:**
1. Unchanged behaviour: the deprecated route, field or function still works as before.
2. A marker a client or a tool can read:
   - HTTP: a `Deprecation` header (RFC 9745), a `Sunset` header with the removal
     date (RFC 8594) and `Link: <…>; rel="successor-version"`;
   - OpenAPI or JSON Schema: `deprecated: true`;
   - TypeScript: a `/** @deprecated Use … */` JSDoc on the export or field.
3. A named replacement.
4. A removal date or version, and a "Deprecated" line in the changelog.

**Flag:**
- A public route, field, parameter, enum value or export that the diff removes or
  renames in one step, with no deprecated predecessor in sight — clients find out
  from a 404 or an `undefined`.
- A deprecation that lacks the marker, the replacement or the removal date.
- A deprecated route or field whose behaviour the diff also changes.

**Report each gap:** cite the line of the removal or of the incomplete marker, and
spell out the deprecation the change needs (the headers or JSDoc, the replacement,
the date). When the removal is already reported as a breaking change, put this
deprecation path in that finding's suggestion instead of adding a second finding.

**Severity:** a public surface removed with no deprecation step is a WARNING; a
deprecation missing its marker, replacement or date is a SUGGESTION.

**Not a finding:** removing something the diff shows was already deprecated, once
its announced removal date or version is reached.

**Bad** — the statement route disappears in one step:

```ts
export async function payoutRoutes(app: FastifyInstance) {
  app.get('/v1/payouts/:id', getPayout);
  // GET /v1/payouts/:id/statement was deleted here; clients learn it from a 404
}
```

**Good** — the route keeps working and says when it goes and what replaces it:

```ts
app.get<{ Params: { id: string } }>('/v1/payouts/:id/statement', async (req, reply) => {
  reply
    .header('Deprecation', '@1790812800') // deprecated since 2026-10-01
    .header('Sunset', 'Thu, 01 Apr 2027 00:00:00 GMT')
    .header('Link', '</v1/payouts/' + req.params.id + '/documents>; rel="successor-version"');
  return getStatement(req.params.id); // unchanged until the sunset date
});
```
