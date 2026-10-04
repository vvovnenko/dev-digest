---
name: mocking-discipline
description: Apply when a test in the diff uses vi.mock, vi.fn, vi.spyOn or a hand-written fake. Flag mocks that replace the unit under test and assertions that only check what a mock was told to do.
type: convention
---
Mock the edges of the system, never the logic under test. A test that mocks too much
stays green when the code it claims to test is broken.

**Rules:**
1. Mock only I/O boundaries: the database, the network, payment gateways, the clock,
   the filesystem, queues. Never mock the module under test or the pure helpers it
   calls — run them for real.
2. Every test asserts an observable outcome: the return value, the thrown error, the
   state left behind. `expect(mock).toHaveBeenCalled()` or `toHaveBeenCalledWith(…)`
   with no outcome assertion is a gap: the test passes even if the result is wrong.
3. No tautologies: asserting that the result equals the value the test itself gave a
   mock (`mockResolvedValue(x)` … `expect(result).toBe(x)` with nothing in between
   that could change it) proves nothing.
4. A mock that returns data has the real shape. `{} as any`, or a partial object
   cast to the full type, hides the fields the code reads.
5. Prefer one in-memory fake at the boundary over a chain of `mockReturnValueOnce`
   calls that encodes the implementation's call order — the chain breaks on every
   refactor and never on a bug.
6. Follow the repo's own mocking convention when the diff or the test helpers show
   one, and flag a test that breaks it.

**Report each gap:** cite the test line of the mock or the assertion, name what a
regression in the production code could do while the test stays green, and suggest
the outcome assertion or the boundary fake.

**Severity:** a test that cannot fail because of its mocks is a WARNING; mock shape
or style issues are a SUGGESTION.
