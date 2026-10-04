---
name: flaky-test-patterns
description: Apply when a test in the diff waits on real time, reads the clock or randomness, touches the network or shared state, or depends on test order. Flag the pattern that makes it pass or fail by chance.
type: custom
license: MIT
allowed-tools: Bash(sh scripts/find-sleeps.sh *)
---
A flaky test fails for reasons unrelated to the code under test. Teams learn to
re-run it, then to skip it, and the regression it was meant to catch ships.

**Patterns to flag:**
1. Real sleeps — `setTimeout`, `sleep(…)` or `await new Promise((r) => setTimeout(r, n))`
   used to wait for async work. Use fake timers (`vi.useFakeTimers()` plus
   `vi.advanceTimersByTime`) or await the promise itself / `vi.waitFor`.
2. The wall clock — code under test reads `Date.now()` or `new Date()` and the test
   asserts on dates without `vi.setSystemTime`. It breaks at midnight, at month end
   and on DST days.
3. Randomness — `Math.random()` or `crypto.randomUUID()` feed an asserted value with
   no stub or seed.
4. Shared state — module-level variables, singletons or database rows a previous
   test left behind; a test that passes only in file order; a leftover `it.only`
   or `it.skip`.
5. The real network or filesystem — an actual HTTP call, a fixed port, a temp
   directory that is never removed.
6. Unawaited assertions — `expect(promise).rejects…` or `resolves…` without
   `await`: the assertion runs after the test has already passed.
7. Machine-tuned timeouts — `{ timeout: 50 }` or a polling loop with a short
   deadline that a slow CI runner misses.

**Report each one:** cite the test line, say what makes the outcome depend on chance,
and give the deterministic replacement.

**Severity:** a test whose result depends on timing, order or the environment is a
WARNING; a sleep that only slows the suite down is a SUGGESTION.

To list real sleeps across a whole checkout, run `scripts/find-sleeps.sh <dir>`.
