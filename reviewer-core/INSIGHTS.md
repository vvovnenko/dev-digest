# reviewer-core — insights

Things that are true about `reviewer-core/` but not visible in the code.
Append-only: when an entry goes stale, add a dated note under it instead of
deleting it. Cross-package findings go in the [root file](../INSIGHTS.md).
Agents write here only through the `engineering-insights` skill, whose script
inserts lines and never changes existing ones.

Entry format: `- **YYYY-MM-DD** — claim. Evidence: \`path:line\``

## What works

## What doesn't work

- **2026-09-23** — No test exercises map-reduce: the server test whose name says "map-reduce" reviews a one-file diff with the default strategy, and a one-file diff always falls back to single-pass → a map-reduce change needs a new multi-file test (mode selection, `sliceDiff`, `reduceReviews`). Evidence: `../server/test/reviews.it.test.ts:160`, `src/review/run.ts:117`.
  - **2026-09-28** — Fixed: a two-file diff now goes through map-reduce in the engine's own tests (each chunk gets its file's slice; a finding both chunks return is reported once), and an over-budget single pass switches to per-file chunks. Evidence: `test/run-limits.test.ts:92,106`
- **2026-09-23** — `sliceDiff` picks a file's blocks by substring (`b/<path>` or ` <path>` anywhere in the `diff --git` line), so the map-reduce slice for `x.ts` also carries `lib/x.ts` (confirmed by running it) → match the exact `b/<path>` header when touching it. Evidence: `src/review/reduce.ts:63-64`.
  - **2026-09-28** — Fixed: a block is kept only when its `diff --git` line ends with ` b/<path>`, so `x.ts` no longer carries `lib/x.ts`. Evidence: `src/review/reduce.ts:82`, `test/reduce.test.ts:45`
- **2026-09-28** — The grounding gate walks every integer from `start_line` to `end_line`, and both come from the model with no bounds in the `Finding` schema, so one hallucinated or injected range freezes the single API process (1000..3e8 took 3.2 s in the audit's probe; 2^53 never ends) → check ranges against the file's covered-line set, not by counting, and reject `start_line < 1` or absurd spans. Evidence: `src/grounding.ts:41-46`, `../server/src/vendor/shared/contracts/findings.ts:53-54`
  - **2026-09-28** — Fixed: `rangeIntersects` walks the file's covered-line set, so `1..Number.MAX_SAFE_INTEGER` grounds in microseconds; the engine's own test covers huge and reversed ranges. Evidence: `src/grounding.ts:52`, `test/grounding.test.ts:39`
- **2026-09-28** — `wrapUntrusted` escapes only the exact string `</untrusted>`, so `</UNTRUSTED>`, `</untrusted >` or `</ untrusted>` in a diff or PR body still close the block (the audit's probe got 2 closing tags); `docs/pipeline.md:73` says content "can't close" its block → escape with a case/whitespace-insensitive regex or a per-run nonce tag, and test the variants. Evidence: `src/prompt.ts:32`
  - **2026-09-28** — Fixed: every opening or closing `untrusted` tag, any case/spacing/attributes, becomes `&lt;…`; tests cover `</UNTRUSTED>`, `</untrusted >`, `</ untrusted>`, a forged opening tag, and look-alikes left untouched. Evidence: `src/prompt.ts:31-39`, `test/prompt.test.ts:69`
- **2026-09-28** — The model can skip line grounding by choosing `kind`: `FULL_FILE_KINDS` (`hook`, `secret_leak`, `phantom`, `lethal_trifecta`) bypass the line check, and `kind` is part of the LLM's structured-output schema — the same line-500 finding was kept as `hook` and dropped as `finding` → force `kind: 'finding'` on LLM output; only scanners may set file-level kinds. Evidence: `src/grounding.ts:16`, `../server/src/vendor/shared/contracts/findings.ts:59`
  - **2026-09-28** — Fixed: file-level kinds skip the line check only with `groundFindings(…, { fileLevelKinds: true })`, which no caller passes; `reviewPullRequest` uses the default, so model output is always line-grounded. Evidence: `src/grounding.ts:71`, `src/review/run.ts:200`
- **2026-09-28** — `OpenRouterProvider.listModels` fetched `/models` with the raw global `fetch`, so neither the provider's timeout (the SDK's, 90 s) nor an injected `fetch` applied to it — a hanging `/models` hung the model list and the PriceBook refresh. Fixed: it uses the injected fetch with `AbortSignal.timeout(timeoutMs)`; the test proves a hang now fails. Evidence: `src/llm/openrouter.ts:167-169`, `test/openrouter.test.ts:85`

## Codebase patterns

## Tool & library notes

## Recurring errors & fixes

## Doc drift

- **2026-09-23** — README names functions that don't exist under those names:
  `toReview()`, `run`, `reduce`. The real exports are `toReviewPayload`,
  `reviewPullRequest`, `reduceReviews`. Evidence: `README.md:33,41-42,48`,
  `src/index.ts`.
  - **2026-09-29** — Fixed in place: README uses `reviewPullRequest`, `reduceReviews` / `sliceDiff` and `toReviewPayload`, lists the real inputs the server passes, and `docs/pipeline.md` no longer translates the old names. Evidence: `README.md:32-38,42-49`, `docs/pipeline.md:5-6`.

## Session notes

- **2026-09-23** — HW1 fixes, block F (docs/pipeline.md, specs/grounding-and-scoring.md): +3 (What doesn't work ×2, Open questions nuance)
- **2026-09-28** — Whole-project audit (grounding, prompt-injection, kind bypass): +3 (What doesn't work)
- **2026-09-28** — Wave 0 fixes (grounding loop, wrapUntrusted, kind opt-in, pr-meta block): +4 (What doesn't work ×3 fixed, Open questions resolved)
- **2026-09-28** — Wave 1 engine changes (verdict from findings, limits, usage on failure, abort signal, dedupe): +2 (What doesn't work ×2 fixed)
- **2026-09-28** — Wave 2 (listModels timeout): +1 (What doesn't work, fixed)
- **2026-09-29** — Wave 5 (README names and inputs, pipeline intro): +1 (Doc drift fix note)

## Open questions

- **2026-09-23** — (security) `INJECTION_GUARD` claims the PR title sits inside
  `<untrusted>` blocks, but the server puts `pull.title` and `pull.author`
  verbatim into the unwrapped `task` line. Wrap them, or fix the guard's wording?
  Evidence: `src/prompt.ts:16-28`, `../server/src/modules/reviews/helpers.ts:82-84`.
  - **2026-09-23** — The server evidence has moved: the task line is `taskLine()` with title and author at `../server/src/modules/reviews/helpers.ts:89-91` (was cited as `:82-84`). Evidence: `../server/src/modules/reviews/helpers.ts:89-91`.
  - **2026-09-28** — Resolved: the server's task line names only the PR number; title and author go through `reviewPullRequest`'s `pr` into their own `pr-meta` untrusted block, so the guard's claim is now true. Evidence: `src/prompt.ts:120-123`, `../server/src/modules/reviews/run-executor.ts:207`
