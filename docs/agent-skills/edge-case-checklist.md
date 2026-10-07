---
name: edge-case-checklist
description: Apply when a test in the diff calls a function with one typical input, or when the diff adds validation, limits, arithmetic on amounts, collections or state transitions. Flag the boundary cases the tests never try.
type: rubric
---
A test that feeds one typical value proves the middle of the input range works. The
bugs live at the edges. For every input the changed code compares, counts or
transforms, check that the tests try its boundaries.

**Boundaries by input kind:**
- Numbers and money: `0`, a negative value, exactly the limit (`amount === remaining`),
  one unit over it, fractional cents and rounding, a very large value.
- Strings and ids: empty, whitespace only, unicode, the maximum length, a case or
  format variant.
- Collections: empty, one element, duplicates, unsorted input.
- Optional values: `undefined`, `null` and a missing key, separately.
- Time: midnight and month end, a time-zone or DST change, the moment a deadline
  passes.
- State: the same operation twice (idempotency), an object already in its final
  state (refunded, cancelled, settled), two calls racing.

**The off-by-one rule:** when the code compares with `>`, `>=`, `<` or `<=`, the tests
must hit both sides of that line — the exact boundary value and its neighbour. A
`amount > remaining` check needs a test at `amount === remaining` (allowed) and at
`remaining + 1` (rejected).

**Report each gap:**
- Cite the production line where the boundary is decided (the comparison, the
  validation, the rounding).
- Name the missing case and the outcome the code should produce for it.

**Severity:** a missing boundary on validation, money or state is a WARNING; a
missing boundary on formatting or display is a SUGGESTION.
