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
