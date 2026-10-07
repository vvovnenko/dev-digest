/**
 * Built-in skills used by the seed (lesson L02 — Skills Lab).
 *
 * These mirror the human-readable originals in `docs/agent-skills/*.md` (frontmatter
 * name / description / type + markdown body). Keep the two in sync —
 * `test/seed-docs-sync.test.ts` fails when they drift. The DB row is the source of
 * truth at run time; editing a skill here only affects freshly seeded workspaces.
 *
 * The fourth Test Quality skill, `docs/agent-skills/flaky-test-patterns/`, is NOT
 * seeded: it is imported through the UI to walk the import path.
 */

export interface SeedSkill {
  name: string;
  description: string;
  type: 'rubric' | 'convention' | 'security' | 'custom';
  body: string;
}

export const BRANCH_COVERAGE_SKILL: SeedSkill = {
  name: 'branch-coverage',
  description:
    'Apply when the diff adds or changes production code that branches (if/else, early return, throw, switch case, ternary, ?? or || default, catch). Flag every new branch that no test in the diff drives into and asserts on.',
  type: 'rubric',
  body: `Every branch the diff adds to production code needs a test whose input reaches that
branch and whose assertion would fail if the branch were deleted or inverted.

**Check, for each changed production function:**
1. List its branches: each \`if\` / \`else\`, early \`return\`, \`throw\`, \`switch\` case,
   ternary arm, \`??\` / \`||\` default, \`catch\` block and guard clause.
2. For each branch, find a test in the diff whose input reaches it AND whose
   assertion checks what that branch does (its return value, error or side effect).
3. A branch with no such test is a gap. A suite that only runs the happy path
   leaves every guard, error and early-return branch untested.

**Report each gap:**
- Cite the production line of the branch itself (the \`if\`, \`throw\` or \`return\`),
  not the test file — that line is in the diff.
- Name the input that reaches it ("amount is 0", "currency differs from the
  charge") and what the code does there.
- Suggest the missing test as input → expected outcome
  (\`refund(0)\` → throws \`InvalidAmountError\`).
- When more than three branches of one function are untested, report ONE finding
  that cites the function's line range and lists the branches.

**Severity:** an untested branch that changes the result, throws or moves money is
a WARNING; an untested branch that only logs is a SUGGESTION.

**Not a gap:** a branch a test outside the diff plainly covers, or defensive code
the function's typed inputs cannot reach.`,
};

export const EDGE_CASE_CHECKLIST_SKILL: SeedSkill = {
  name: 'edge-case-checklist',
  description:
    'Apply when a test in the diff calls a function with one typical input, or when the diff adds validation, limits, arithmetic on amounts, collections or state transitions. Flag the boundary cases the tests never try.',
  type: 'rubric',
  body: `A test that feeds one typical value proves the middle of the input range works. The
bugs live at the edges. For every input the changed code compares, counts or
transforms, check that the tests try its boundaries.

**Boundaries by input kind:**
- Numbers and money: \`0\`, a negative value, exactly the limit (\`amount === remaining\`),
  one unit over it, fractional cents and rounding, a very large value.
- Strings and ids: empty, whitespace only, unicode, the maximum length, a case or
  format variant.
- Collections: empty, one element, duplicates, unsorted input.
- Optional values: \`undefined\`, \`null\` and a missing key, separately.
- Time: midnight and month end, a time-zone or DST change, the moment a deadline
  passes.
- State: the same operation twice (idempotency), an object already in its final
  state (refunded, cancelled, settled), two calls racing.

**The off-by-one rule:** when the code compares with \`>\`, \`>=\`, \`<\` or \`<=\`, the tests
must hit both sides of that line — the exact boundary value and its neighbour. A
\`amount > remaining\` check needs a test at \`amount === remaining\` (allowed) and at
\`remaining + 1\` (rejected).

**Report each gap:**
- Cite the production line where the boundary is decided (the comparison, the
  validation, the rounding).
- Name the missing case and the outcome the code should produce for it.

**Severity:** a missing boundary on validation, money or state is a WARNING; a
missing boundary on formatting or display is a SUGGESTION.`,
};

export const MOCKING_DISCIPLINE_SKILL: SeedSkill = {
  name: 'mocking-discipline',
  description:
    'Apply when a test in the diff uses vi.mock, vi.fn, vi.spyOn or a hand-written fake. Flag mocks that replace the unit under test and assertions that only check what a mock was told to do.',
  type: 'convention',
  body: `Mock the edges of the system, never the logic under test. A test that mocks too much
stays green when the code it claims to test is broken.

**Rules:**
1. Mock only I/O boundaries: the database, the network, payment gateways, the clock,
   the filesystem, queues. Never mock the module under test or the pure helpers it
   calls — run them for real.
2. Every test asserts an observable outcome: the return value, the thrown error, the
   state left behind. \`expect(mock).toHaveBeenCalled()\` or \`toHaveBeenCalledWith(…)\`
   with no outcome assertion is a gap: the test passes even if the result is wrong.
3. No tautologies: asserting that the result equals the value the test itself gave a
   mock (\`mockResolvedValue(x)\` … \`expect(result).toBe(x)\` with nothing in between
   that could change it) proves nothing.
4. A mock that returns data has the real shape. \`{} as any\`, or a partial object
   cast to the full type, hides the fields the code reads.
5. Prefer one in-memory fake at the boundary over a chain of \`mockReturnValueOnce\`
   calls that encodes the implementation's call order — the chain breaks on every
   refactor and never on a bug.
6. Follow the repo's own mocking convention when the diff or the test helpers show
   one, and flag a test that breaks it.

**Report each gap:** cite the test line of the mock or the assertion, name what a
regression in the production code could do while the test stays green, and suggest
the outcome assertion or the boundary fake.

**Severity:** a test that cannot fail because of its mocks is a WARNING; mock shape
or style issues are a SUGGESTION.`,
};

/** Linked to the Test Quality Reviewer, in this prompt order. */
export const TEST_QUALITY_SKILLS: readonly SeedSkill[] = [
  BRANCH_COVERAGE_SKILL,
  EDGE_CASE_CHECKLIST_SKILL,
  MOCKING_DISCIPLINE_SKILL,
];

/*
 * API Contract Reviewer skills (HW2). Mirrored in `docs/agent-skills/<name>.md` like the
 * Test Quality ones above; `test/seed-docs-sync.test.ts` checks both sets.
 */

export const API_BREAKING_CHANGE_SKILL: SeedSkill = {
  name: 'api-breaking-change',
  description:
    "Apply when the diff changes a public API surface — an HTTP route's method or path, its path, query or header parameters, its request body, its status or error codes, or a function, type or constant other packages import. Flag every change after which a request or call that worked before fails or behaves differently.",
  type: 'rubric',
  body: `A public contract is everything a caller outside this PR relies on: the routes an
HTTP client calls, what they accept, the status and error codes the client branches
on, and the functions, types and constants other packages import. A change is
breaking when a caller that is not updated in the same release fails, or quietly
gets a different result.

**Breaking — flag it:**
- Removing or renaming a route, an HTTP method, a path, query or header parameter, a
  request field, an enum value the caller sends, or an exported symbol.
- Adding a required input, making an optional input required, or narrowing what is
  accepted (a shorter max length, a stricter format, fewer enum values).
- Changing an input's type, unit or format (\`number\` → \`string\`, cents → dollars,
  ISO date → epoch seconds).
- Changing the status code of an existing outcome (\`200\` → \`201\`, \`404\` → \`400\`), an
  error code callers match on, or the default of an optional input.
- Changing an exported function's parameter order, arity or return type.

**Check, for each changed route, schema or export:**
1. Write the contract before and after from the removed and added lines.
2. Name one request or call that worked before and what it gets now
   (\`POST /v1/payouts {"amount": 500}\` → 422 "amount_cents is required").
3. Look for a compatible path in the diff: the old name still accepted, the new input
   optional with a default, or the change shipped under a new route version (\`/v2\`).
   A change that keeps such a path is not breaking.

**Report each break:**
- Cite the added line that changes the contract (the schema field, the route
  declaration). For a route or field that is only removed, cite the nearest changed
  line of the same hunk and name what was removed.
- Give old → new, the caller that breaks, and the compatible alternative.
- Response-shape changes belong to \`api-response-schema\` when that skill is attached;
  report each change once.

**Severity:** a break on a public route or export is CRITICAL; a break on a surface
the diff does not show is public is a WARNING.

**Not a finding:** a new route, a new optional input, wider accepted input, or a
change to internal code no caller outside the PR can reach.

**Bad** — the request contract changes in place:

\`\`\`ts
const CreatePayoutBody = z.object({
  account_id: z.string(),
  amount_cents: z.number().int().positive(), // was \`amount\`
  method: z.enum(['standard', 'instant']), // new and required
});
\`\`\`

Every client still sending \`{ "account_id": "acct_1", "amount": 500 }\` now gets a 422.

**Good** — the new names arrive without breaking the old request:

\`\`\`ts
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
\`\`\``,
};

export const API_RESPONSE_SCHEMA_SKILL: SeedSkill = {
  name: 'api-response-schema',
  description:
    "Apply when the diff changes what an endpoint returns — a handler's reply object, a serializer or mapper, a response schema (zod, JSON Schema, OpenAPI) or a response DTO type. Flag removed or renamed fields, changed types, units or formats, fields that become optional or nullable, and new enum values clients may not handle.",
  type: 'rubric',
  body: `Clients parse a response with fixed expectations: a typed SDK, a mobile app that
ships once a month, \`JSON.parse\` followed by arithmetic. A response that changes
shape breaks them at run time, often silently: a missing field reads as \`undefined\`,
and a number that became a string still parses.

**Compare the response before and after, field by field:**
1. A removed or renamed field: every caller reading the old name gets \`undefined\`.
2. A changed type, unit or format: \`number\` → \`string\`, integer cents → a decimal
   string, epoch → ISO date, an object → an array, one item → a list.
3. A field that was always present becoming optional or nullable: a caller that
   dereferences it crashes on the new \`null\`.
4. A new value in a response enum: a caller with an exhaustive \`switch\` falls into
   its error branch.
5. A changed envelope: a bare array wrapped in \`{ data: [...] }\`, a new pagination
   wrapper, a different error body.
6. Where the shape is built: the handler's returned object or \`reply.send(...)\`, a
   mapper such as \`toDto()\`, and the declared response schema. Check the change in
   all of them — a schema that still says \`z.number()\` while the handler returns a
   string is a contract the service no longer keeps.

**Report each change:**
- Cite the added line of the changed field (for a removed field, the nearest changed
  line of the same object).
- Give old → new and what a caller written for the old shape does with the new one
  (\`total += payout.amount\` builds a string; \`payout.destination_id\` is \`undefined\`).
- Suggest the additive path: keep the old field and add the new one beside it
  (\`amount\` stays cents, \`amount_decimal\` is new), or version the response.

**Severity:** a removed, renamed or retyped field on a public endpoint is CRITICAL; a
field that becomes optional or nullable, a new enum value or a changed envelope is a
WARNING.

**Not a finding:** a new optional field, or a field added to an object clients
already treat as open.

**Bad** — the payout response changes shape in place:

\`\`\`ts
return {
  id: payout.id,
  amount: (payout.amountCents / 100).toFixed(2), // was the integer amountCents
  destination: payout.bankAccountId, // was destination_id
};
\`\`\`

A client doing \`total += payout.amount\` now builds a string, and one reading
\`payout.destination_id\` gets \`undefined\`.

**Good** — the old fields stay, the new one is added beside them:

\`\`\`ts
return {
  id: payout.id,
  amount: payout.amountCents, // unchanged: integer cents
  amount_decimal: (payout.amountCents / 100).toFixed(2), // new
  destination_id: payout.bankAccountId, // unchanged
};
\`\`\``,
};

export const API_SEMVER_DISCIPLINE_SKILL: SeedSkill = {
  name: 'api-semver-discipline',
  description:
    'Apply when the diff changes a public API surface, whether or not it also changes a version (package.json version, OpenAPI info.version, an API version constant, a changelog heading). Flag a breaking change released under a minor or patch bump, or with no bump at all.',
  type: 'convention',
  body: `A version number is a promise to the people who upgrade: \`MAJOR.MINOR.PATCH\`. A
client that takes every minor and patch release automatically (\`^2.3.1\`) trusts that
none of them breaks it.

**Classify every public change in the diff:**
- MAJOR — any breaking change: a removed or renamed route, field, parameter or
  export, a changed type or format, a new required input, narrower accepted input,
  a changed status code for an existing outcome.
- MINOR — a backwards-compatible addition: a new route, a new optional field or
  parameter, a deprecation marker on something that still works.
- PATCH — a fix that keeps the contract.

**Rules:**
1. The bump must be at least the highest class in the release. One breaking change
   makes the release MAJOR, whatever else it contains.
2. Below \`1.0.0\` the minor digit acts as the major one: a break in \`0.4.2\` needs \`0.5.0\`.
3. A breaking change with no version change at all is the same gap: the release that
   ships it must be MAJOR.
4. A MAJOR release lists its breaking changes in the changelog, with a migration note
   for each.
5. The way out of a MAJOR bump is to make the change compatible: keep the old name
   as an alias, make the new input optional, or add the change under a new route
   version. Name the one that fits.

**Report:** ONE finding per release, not one per breaking change. Cite the version
line when the diff changes it (\`"version": "2.4.0"\`); otherwise cite the first
breaking line and say the release needs a major bump. List the breaking changes that
force it and suggest the right version (\`3.0.0\`) or the compatible alternative. The
breaks themselves are reported at their own lines by \`api-breaking-change\` and
\`api-response-schema\`.

**Severity:** a breaking change under a minor, patch or missing bump is a WARNING.

**Not a finding:** a bump larger than the change needs, or a version file the diff
leaves alone when every change is compatible.

**Bad** — \`1.7.2\` → \`1.8.0\`, while the same diff deletes \`GET /v1/payouts/:id/statement\`:

\`\`\`json
{
  "name": "@acme/payouts-api",
  "version": "1.8.0"
}
\`\`\`

Every client on \`^1.7.2\` takes this release automatically and starts getting 404s.

**Good** — the release says what it is:

\`\`\`json
{
  "name": "@acme/payouts-api",
  "version": "2.0.0"
}
\`\`\`

with a changelog entry such as \`## 2.0.0 — Breaking: GET /v1/payouts/:id/statement
removed, use GET /v1/payouts/:id/documents\`. Or the route stays, deprecated, and the
release ships as \`1.8.0\`.`,
};

export const API_DEPRECATION_POLICY_SKILL: SeedSkill = {
  name: 'api-deprecation-policy',
  description:
    'Apply when the diff removes or renames a route, field, parameter, enum value or exported symbol, or marks one as deprecated. Flag a removal that skips the deprecation step, and a deprecation that gives clients no marker, replacement or removal date.',
  type: 'convention',
  body: `Removing part of a public contract takes two releases, not one. First the old route,
field or export is deprecated: it keeps working, and clients are told what replaces
it and when it goes away. Only after that window does a major release remove it.

**A deprecation is complete when it has all of:**
1. Unchanged behaviour: the deprecated route, field or function still works as before.
2. A marker a client or a tool can read:
   - HTTP: a \`Deprecation\` header (RFC 9745), a \`Sunset\` header with the removal
     date (RFC 8594) and \`Link: <…>; rel="successor-version"\`;
   - OpenAPI or JSON Schema: \`deprecated: true\`;
   - TypeScript: a \`/** @deprecated Use … */\` JSDoc on the export or field.
3. A named replacement.
4. A removal date or version, and a "Deprecated" line in the changelog.

**Flag:**
- A public route, field, parameter, enum value or export that the diff removes or
  renames in one step, with no deprecated predecessor in sight — clients find out
  from a 404 or an \`undefined\`.
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

\`\`\`ts
export async function payoutRoutes(app: FastifyInstance) {
  app.get('/v1/payouts/:id', getPayout);
  // GET /v1/payouts/:id/statement was deleted here; clients learn it from a 404
}
\`\`\`

**Good** — the route keeps working and says when it goes and what replaces it:

\`\`\`ts
app.get<{ Params: { id: string } }>('/v1/payouts/:id/statement', async (req, reply) => {
  reply
    .header('Deprecation', '@1790812800') // deprecated since 2026-10-01
    .header('Sunset', 'Thu, 01 Apr 2027 00:00:00 GMT')
    .header('Link', '</v1/payouts/' + req.params.id + '/documents>; rel="successor-version"');
  return getStatement(req.params.id); // unchanged until the sunset date
});
\`\`\``,
};

/** Linked to the API Contract Reviewer, in this prompt order. */
export const API_CONTRACT_SKILLS: readonly SeedSkill[] = [
  API_BREAKING_CHANGE_SKILL,
  API_RESPONSE_SCHEMA_SKILL,
  API_SEMVER_DISCIPLINE_SKILL,
  API_DEPRECATION_POLICY_SKILL,
];
