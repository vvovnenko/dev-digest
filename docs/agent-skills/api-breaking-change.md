---
name: api-breaking-change
description: Apply when the diff changes a public API surface — an HTTP route's method or path, its path, query or header parameters, its request body, its status or error codes, or a function, type or constant other packages import. Flag every change after which a request or call that worked before fails or behaves differently.
type: rubric
---
A public contract is everything a caller outside this PR relies on: the routes an
HTTP client calls, what they accept, the status and error codes the client branches
on, and the functions, types and constants other packages import. A change is
breaking when a caller that is not updated in the same release fails, or quietly
gets a different result.

**Breaking — flag it:**
- Removing or renaming a route, an HTTP method, a path, query or header parameter, a
  request field, an enum value the caller sends, or an exported symbol.
- Adding a required input, making an optional input required, or narrowing what is
  accepted (a shorter max length, a stricter format, fewer enum values).
- Changing an input's type, unit or format (`number` → `string`, cents → dollars,
  ISO date → epoch seconds).
- Changing the status code of an existing outcome (`200` → `201`, `404` → `400`), an
  error code callers match on, or the default of an optional input.
- Changing an exported function's parameter order, arity or return type.

**Check, for each changed route, schema or export:**
1. Write the contract before and after from the removed and added lines.
2. Name one request or call that worked before and what it gets now
   (`POST /v1/payouts {"amount": 500}` → 422 "amount_cents is required").
3. Look for a compatible path in the diff: the old name still accepted, the new input
   optional with a default, or the change shipped under a new route version (`/v2`).
   A change that keeps such a path is not breaking.

**Report each break:**
- Cite the added line that changes the contract (the schema field, the route
  declaration). For a route or field that is only removed, cite the nearest changed
  line of the same hunk and name what was removed.
- Give old → new, the caller that breaks, and the compatible alternative.
- Response-shape changes belong to `api-response-schema` when that skill is attached;
  report each change once.

**Severity:** a break on a public route or export is CRITICAL; a break on a surface
the diff does not show is public is a WARNING.

**Not a finding:** a new route, a new optional input, wider accepted input, or a
change to internal code no caller outside the PR can reach.

**Bad** — the request contract changes in place:

```ts
const CreatePayoutBody = z.object({
  account_id: z.string(),
  amount_cents: z.number().int().positive(), // was `amount`
  method: z.enum(['standard', 'instant']), // new and required
});
```

Every client still sending `{ "account_id": "acct_1", "amount": 500 }` now gets a 422.

**Good** — the new names arrive without breaking the old request:

```ts
const CreatePayoutBody = z
  .object({
    account_id: z.string(),
    amount: z.number().int().positive().optional(), // deprecated, still accepted
    amount_cents: z.number().int().positive().optional(),
    method: z.enum(['standard', 'instant']).default('standard'),
  })
  .refine((b) => b.amount !== undefined || b.amount_cents !== undefined, {
    message: 'amount_cents is required',
  });
```
