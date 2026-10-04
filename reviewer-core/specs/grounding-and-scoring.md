# Grounding and scoring — contract

**Status:** contract — describes shipped behaviour that must stay true. Change the code and this file in the same commit.

What happens to the model's `Review` after the LLM call: which findings survive, how
score, verdict, blockers and the GitHub event are derived, how cost adds up. Each rule
cites code and its test, or says **untested**; paths are relative to `reviewer-core/`.
Walkthrough: [`../docs/pipeline.md`](../docs/pipeline.md) · diagram: [`../README.md`](../README.md) ·
prompt conventions: [agent-prompts](../../docs/agent-prompts/README.md#how-the-engine-uses-the-output-why-the-conventions-matter) ·
server side: [`../../server/specs/review-flow.md`](../../server/specs/review-flow.md).

## Grounding

### G1 — The file must be in the diff
`groundFindings` drops a finding whose `file` is not exactly a `diff.files[].path`,
with `file '<f>' not present in diff` (`src/grounding.ts:60-76`). The server's parser
takes a file's path from `+++ b/` (else `rename to`, else the `diff --git` header) and
leaves deleted files out (`+++ /dev/null` or `deleted file mode`), so a deleted file, or a
renamed file's old path, never grounds (`../server/src/adapters/git/diff-parser.ts:50,133-140`).
This check runs before the kind check, so file-level kinds need it too.
Tests: `../server/test/grounding.test.ts:56-60`; the parser's deleted-file and rename cases
`../server/test/diff-parser.test.ts:122,141`.

### G2 — File-level kinds skip the line check, only when the caller opts in
With `{ fileLevelKinds: true }`, `kind` ∈ {`secret_leak`, `lethal_trifecta`, `phantom`, `hook`}
is kept once G1 passes, whatever its lines (`src/grounding.ts:17,71,78-82`). Without it — the
default, and what `reviewPullRequest` uses for model output (`src/review/run.ts:254`) — every kind
goes to G3: the model picks `kind` itself, so a file-level kind would keep a finding at any line
of any file in the diff. Only deterministic scanners may opt in.
Tests: `test/grounding.test.ts:58-75`, `../server/test/grounding.test.ts:62-77`.

### G3 — The lines must overlap a covered new-side line
Kept when any line in `[min(start,end), max(start,end)]` is covered in its file
(`src/grounding.ts:47-54,84-87`). The check walks the file's covered lines, never the range:
both ends come from the model, and counting through e.g. `1..2^53` would block the process; else dropped with `lines S-E do not intersect any
diff hunk in '<f>'` (`src/grounding.ts:88-91`). Covered = each hunk's `newLineNumbers`:
added **and** context lines, never deleted ones (`src/grounding.ts:30-45`,
`../server/src/adapters/git/diff-parser.ts:76,85-87`). A hunk with empty `newLineNumbers`
(pure deletion, `+N,0`) falls back to its declared range, i.e. line `N`
(`src/grounding.ts:37-39`). So an unchanged context line, or a wide range touching one
changed line, is enough.
Tests: `../server/test/grounding.test.ts:41-45` (line 12 is context), `:47-54` (drop),
`:79-85` (range); `test/run.test.ts:46-64`; `test/grounding.test.ts:39-55` (huge and reversed
ranges). **Untested:** the fallback. A hunk ends when its declared line counts are used
up, and `\ No newline at end of file` is no line at all, so coverage never runs past a
hunk (`../server/src/adapters/git/diff-parser.ts:92,98`; tests
`../server/test/diff-parser.test.ts:54,69`).

### G4 — The summary is `kept/total passed`
`groundingSummary` returns `${kept}/${kept + dropped} passed` (`src/grounding.ts:99-102`).
The engine emits one `info` event per drop, then `Citation grounding: …` (`src/review/run.ts:256-259`).
The server stores it on the run and in trace stats; failed or cancelled runs get
`0/0 passed` (`../server/src/modules/reviews/run-executor.ts:286,261,335`).
Tests: `../server/test/grounding.test.ts:87-96`, `test/run.test.ts:61,69`, `../server/test/reviews.it.test.ts:213,220`.

### G5 — Grounding runs once, after reduce, on the whole diff
It runs on the reduced findings against the full `input.diff` in both modes
(`src/review/run.ts:247-254`), so a map chunk's findings aren't limited to its slice.
Kept findings keep the model's order (`src/grounding.ts:70-93`); `outcome.review.findings`
is exactly the kept list (`run.ts:269`), and the server persists only that
(`run-executor.ts:238,300`). Never add a bypass.
Tests: `../server/test/reviews.it.test.ts:205-207`; map-reduce keeps a finding one chunk
reports about another chunk's file (`test/run-limits.test.ts:92-104`). Order: **untested**.

### G6 — Inline comments anchor to a covered line
Given a diff, `toReviewPayload` anchors each inline comment to the covered line in range
nearest `end_line`; with none, the comment is dropped and the finding stays in the body.
Without a diff it uses `end_line` (`src/output/to-review.ts:124-163,169`).
Tests: `test/to-review.test.ts:135-155`.

## Score

### S1 — Score = clamp(0, 100, 100 − Σ penalty) over the kept findings
CRITICAL 35, WARNING 12, SUGGESTION 3 (`src/review/reduce.ts:13-17,27-30`), applied to
`ground.kept` (`src/review/run.ts:269`). `confidence`, `category` and `kind` don't count.
An exact duplicate — same file, lines and normalised title — is removed in reduce first,
in both modes, so it counts once (`src/review/reduce.ts:44-52,59-60`). Examples: none → 100;
one SUGGESTION → 97; one WARNING → 88; one CRITICAL → 65; one CRITICAL + two WARNING → 41;
three CRITICAL → 0 (−5 clamped).
Tests: `test/run.test.ts:67` (one CRITICAL → 65), `test/run.test.ts:72-89` (none → 100),
`../server/test/reviews.it.test.ts:203`, `test/run-limits.test.ts:103` (a duplicate counts
once), `test/reduce.test.ts:58-69`. **Untested:** the 12 and 3 penalties, the clamp.

### S2 — The model's score is never kept
S1 overwrites the model's score (single-pass) or the rounded mean of partial scores
(map-reduce, `src/review/reduce.ts:65-67`) at `run.ts:269`. The `Reduced to … verdict=…,
score=…` event fires before grounding and prints the discarded values (`run.ts:248-251`),
so the run log can disagree with the stored score and verdict.
Test: `test/run.test.ts:72-89` (model says 10, engine stores 100). The event: **untested**.

### S3 — The model's score must still be valid
`Review.score` is an integer 0–100 (`../server/src/vendor/shared/contracts/findings.ts:69-76`).
A fractional or out-of-range score fails validation and costs a reprompt
(`src/llm/structured.ts:74-83`), though S2 discards it. **Untested.**

## Verdict and gate

### V1 — The verdict is derived from the kept findings
After grounding, `verdictFromFindings(ground.kept, failOn ?? 'critical')` replaces the
model's verdict (`src/review/run.ts:264,269`): no kept findings → `approve`; one at or
above the gate (V2) → `request_changes`; otherwise `comment` (`src/output/to-review.ts:48-51`).
The server passes the agent's `ciFailOn` (`../server/src/modules/reviews/run-executor.ts:213`)
and stores the result (`run-executor.ts:295`). When it differs from the model's verdict
— single-pass as returned, map-reduce the worst partial (`src/review/reduce.ts:33-37,61-64`) —
the engine emits an `info` event (`run.ts:265-267`). So verdict, score, blockers and the
GitHub event (V3) always agree; the prompt's [verdict convention](../../docs/agent-prompts/README.md#required-conventions-every-reviewer-prompt)
only keeps the run log readable.
Tests: `test/run-limits.test.ts:122-133` (each outcome, a `warning` gate, a finding dropped
by grounding), `../server/test/reviews.it.test.ts:200`, `test/reduce.test.ts:68` (worst partial).

### V2 — Blockers are kept findings at or above the gate
`countBlockers` counts findings whose rank (SUGGESTION 1, WARNING 2, CRITICAL 3) is at
least the gate's minimum (`never` ∞, `critical` 3, `warning` 2, `any` 1)
(`src/output/to-review.ts:23-31,65-68`); `gateTriggered` is true exactly when that count
is > 0 (`to-review.ts:37-40`). The server counts kept findings against `agent.ciFailOn`
(`run-executor.ts:243`), DB default `critical` (`../server/src/db/schema/agents.ts:27-29`).
Failed and cancelled runs store `NULL` blockers
(`../server/src/modules/reviews/domain.ts:121-122`, `../server/src/modules/reviews/repository/run.repo.ts:241`).
Tests: `test/to-review.test.ts:73-91,157-165`. The server wiring: **untested**.

### V3 — The GitHub event follows the derived verdict
`toReviewPayload` re-derives the verdict from `review.findings` under its own `failOn`
(default `critical`) and maps it: no findings → `APPROVE`; gate tripped → `REQUEST_CHANGES`;
else `COMMENT` (`src/output/to-review.ts:53-57,168,173`). It never reads `review.verdict`,
so under the same gate it matches V1. The body header follows the event
(`to-review.ts:96-101`). The server doesn't call it today.
Tests: `test/to-review.test.ts:28-71`.

## Cost

### C1 — Run cost = the sum of chunk costs; one `null` makes it `null`
Usage starts at zero and each chunk's is added with `addUsage`; a `null` cost on either
side makes the total `null` for good (`src/review/run.ts:203,240`, `src/llm/errors.ts:47-54`).
`0` is a real price (a free model), not unknown.
Tests: `../server/test/reviews.it.test.ts:256-264` (one $0.001 chunk), `:333-346` (a
`null` chunk → `NULL`), `test/run-limits.test.ts:137-156` (two chunks summed; an unknown
cost after a priced chunk → `null`). **Untested:** the sum over several successful chunks.

### C2 — A call costs `usage.cost`, else the estimate, else `null`
`OpenRouterProvider` requests `usage.cost` only when its id is `openrouter`
(`src/llm/openrouter.ts:101`) and sums it over the call's repair attempts
(`openrouter.ts:113-117`). If no attempt reports it, it calls the injected
`estimateCost(model, tokensIn, tokensOut)` on the summed tokens; no estimator or an
unknown model gives `null` (`openrouter.ts:77-81`). Reprompts are billed. Every failure —
the SDK call throwing (an aborted `signal` included), no `choices`, an answer cut off at
the token limit, a schema that never validates — throws `LlmCallError` carrying that usage
(`openrouter.ts:105-111,122-137,154-157`).
Tests: `test/openrouter.test.ts:43-82`. **Untested:** the `estimateCost` fallback.

### C3 — The server's estimator is the PriceBook
Every provider gets `PriceBook.estimatorFor(<its id>)`
(`../server/src/platform/container.ts:269,277,282`): live OpenRouter prices cached 6 h, the
static table while cold, `null` when neither knows the model
(`../server/src/platform/price-book.ts:7,64-73`, `../server/src/adapters/llm/pricing.ts:54-58`).
The OpenAI and Anthropic APIs return tokens, never USD, so their providers price every call
with it, and their models are looked up under the catalog alias (`claude-opus-5-5` →
`anthropic/claude-opus-5.5`, `gpt-5.5` → `openai/gpt-5.5`; `price-book.ts:17-22`). Without an
injected estimator the static table prices them (`../server/src/adapters/llm/openai.ts:56,126`,
`../server/src/adapters/llm/anthropic.ts:93,220`).
Tests: `../server/test/price-book.test.ts:15-92`, `../server/test/adapters.test.ts:102-110`,
`../server/test/anthropic-provider.test.ts:198-242`.

### C4 — Failed and cancelled runs store what their calls spent
A failed chunk is rethrown as `LlmCallError` carrying the earlier chunks' usage plus the
failed call's; a call that reported none keeps the tokens but makes the cost `null`
(`src/review/run.ts:234-239`, `src/llm/errors.ts:37-38`). The server reads it with
`usageOf(err)` and stores those tokens and cost on the failed or cancelled run; an error
with no usage stores 0 tokens and a `NULL` cost (`run-executor.ts:322,331-333`,
`run.repo.ts:231-248`). The server's OpenAI/Anthropic providers attach usage to a schema
failure too (`../server/src/adapters/llm/openai.ts:139`, `../server/src/adapters/llm/anthropic.ts:239`).
Tests: `test/run-limits.test.ts:137-156`, `../server/test/run-lifecycle.it.test.ts:331-343`
(failed), `:247-272` (cancelled: the aborted call's tokens), `../server/test/reviews.it.test.ts:351-359`
(no usage → `NULL`), `:286-315` (a failed run adds nothing to the PR's cost).

## Not covered by tests

- Grounding: `lethal_trifecta`, `phantom`, `hook` (G2); `start > end`, the fallback (G3);
  kept-finding order (G5).
- Score and verdict: penalties 12 and 3, the clamp (S1); the event value (S2); S3;
  the server's `countBlockers` call (V2).
- Map-reduce: `auto` mode selection by changed-line count.
- Cost: the sum over several successful chunks (C1), the `estimateCost` fallback (C2).

## When you change this

- Update the rule here in the same commit, and add or fix the test it cites. Engine
  tests are hermetic: stub the `LLMProvider` as `test/run.test.ts:107-132` does.
- Score or verdict semantics: also update the "How the engine uses the output" section
  of [agent-prompts](../../docs/agent-prompts/README.md) and the gotchas in [`../CLAUDE.md`](../CLAUDE.md).
- A new file-level kind: add it to `FindingKind` (`../server/src/vendor/shared/contracts/findings.ts:17-23`)
  and the client copy, then to `FULL_FILE_KINDS` (`src/grounding.ts:17`).
- Cost or blockers: check what the server stores and shows ([`01-run-cost-badge.md`](../../server/specs/01-run-cost-badge.md)).
