---
name: branch-coverage
description: Apply when the diff adds or changes production code that branches (if/else, early return, throw, switch case, ternary, ?? or || default, catch). Flag every new branch that no test in the diff drives into and asserts on.
type: rubric
---
Every branch the diff adds to production code needs a test whose input reaches that
branch and whose assertion would fail if the branch were deleted or inverted.

**Check, for each changed production function:**
1. List its branches: each `if` / `else`, early `return`, `throw`, `switch` case,
   ternary arm, `??` / `||` default, `catch` block and guard clause.
2. For each branch, find a test in the diff whose input reaches it AND whose
   assertion checks what that branch does (its return value, error or side effect).
3. A branch with no such test is a gap. A suite that only runs the happy path
   leaves every guard, error and early-return branch untested.

**Report each gap:**
- Cite the production line of the branch itself (the `if`, `throw` or `return`),
  not the test file — that line is in the diff.
- Name the input that reaches it ("amount is 0", "currency differs from the
  charge") and what the code does there.
- Suggest the missing test as input → expected outcome
  (`refund(0)` → throws `InvalidAmountError`).
- When more than three branches of one function are untested, report ONE finding
  that cites the function's line range and lists the branches.

**Severity:** an untested branch that changes the result, throws or moves money is
a WARNING; an untested branch that only logs is a SUGGESTION.

**Not a gap:** a branch a test outside the diff plainly covers, or defensive code
the function's typed inputs cannot reach.
