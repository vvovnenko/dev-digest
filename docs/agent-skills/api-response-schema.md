---
name: api-response-schema
description: Apply when the diff changes what an endpoint returns — a handler's reply object, a serializer or mapper, a response schema (zod, JSON Schema, OpenAPI) or a response DTO type. Flag removed or renamed fields, changed types, units or formats, fields that become optional or nullable, and new enum values clients may not handle.
type: rubric
---
Clients parse a response with fixed expectations: a typed SDK, a mobile app that
ships once a month, `JSON.parse` followed by arithmetic. A response that changes
shape breaks them at run time, often silently: a missing field reads as `undefined`,
and a number that became a string still parses.

**Compare the response before and after, field by field:**
1. A removed or renamed field: every caller reading the old name gets `undefined`.
2. A changed type, unit or format: `number` → `string`, integer cents → a decimal
   string, epoch → ISO date, an object → an array, one item → a list.
3. A field that was always present becoming optional or nullable: a caller that
   dereferences it crashes on the new `null`.
4. A new value in a response enum: a caller with an exhaustive `switch` falls into
   its error branch.
5. A changed envelope: a bare array wrapped in `{ data: [...] }`, a new pagination
   wrapper, a different error body.
6. Where the shape is built: the handler's returned object or `reply.send(...)`, a
   mapper such as `toDto()`, and the declared response schema. Check the change in
   all of them — a schema that still says `z.number()` while the handler returns a
   string is a contract the service no longer keeps.

**Report each change:**
- Cite the added line of the changed field (for a removed field, the nearest changed
  line of the same object).
- Give old → new and what a caller written for the old shape does with the new one
  (`total += payout.amount` builds a string; `payout.destination_id` is `undefined`).
- Suggest the additive path: keep the old field and add the new one beside it
  (`amount` stays cents, `amount_decimal` is new), or version the response.

**Severity:** a removed, renamed or retyped field on a public endpoint is CRITICAL; a
field that becomes optional or nullable, a new enum value or a changed envelope is a
WARNING.

**Not a finding:** a new optional field, or a field added to an object clients
already treat as open.

**Bad** — the payout response changes shape in place:

```ts
return {
  id: payout.id,
  amount: (payout.amountCents / 100).toFixed(2), // was the integer amountCents
  destination: payout.bankAccountId, // was destination_id
};
```

A client doing `total += payout.amount` now builds a string, and one reading
`payout.destination_id` gets `undefined`.

**Good** — the old fields stay, the new one is added beside them:

```ts
return {
  id: payout.id,
  amount: payout.amountCents, // unchanged: integer cents
  amount_decimal: (payout.amountCents / 100).toFixed(2), // new
  destination_id: payout.bankAccountId, // unchanged
};
```
