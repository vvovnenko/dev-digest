# Review pipeline — how the engine runs today

`reviewPullRequest` (`src/review/run.ts:161-280`) is the only entry point: diff +
agent inputs + an injected `LLMProvider` in, a grounded `Review` and run telemetry
out. Diagram and exports: [`../README.md`](../README.md) (`src/index.ts:40-64`).
Rules that must stay true:
[`../specs/grounding-and-scoring.md`](../specs/grounding-and-scoring.md). Cited paths are relative to `reviewer-core/`.

## Inputs and outputs

| Input | Engine default | What the server passes (`../server/src/modules/reviews/run-executor.ts:187-214`) |
| ----- | -------------- | ---- |
| `systemPrompt`, `model`, `diff`, `llm` | required (`run.ts:62-70`) | the agent row; the PR diff from `deps.diffs` — `git diff base...head`, else the stored `pr_files` patches (`run-executor.ts:90`, `../server/src/adapters/git/pr-diff.ts:19-30`); `deps.llm(agent.provider)`, the container's `llm` |
| `strategy` | `'auto'` (`run.ts:167`) | `agent.strategy`. The DB default is `single-pass` (`../server/src/db/schema/agents.ts:22-24`), so `auto` runs only when set in the Agent editor |
| `failOn` | `'critical'` (`run.ts:264`) | `agent.ciFailOn` (`run-executor.ts:196`) — the gate that turns the kept findings into the verdict |
| `maxRetries` | 2 (`run.ts:43-44,163`) | not passed |
| `mapThresholdLines` | 400 changed lines (`run.ts:41-42,162`) | not passed |
| `maxTokens` | 8192 output tokens per call (`run.ts:45-46,230`) | not passed |
| `maxDiffChars` | 2,000,000 characters (`run.ts:47-48,164-165`) | not passed |
| `singlePassMaxChars` | 400,000 characters (`run.ts:49-50,170`) | not passed |
| `signal` | none | the run's `AbortSignal` from the run bus (`deps.runs.track`), aborted by a cancel or a shutdown (`run-executor.ts:146,213`) |
| `task` | none | `taskLine(pull)` + a repo-intel rank note (`run-executor.ts:181`) |
| `prDescription`, `repoMap`, `callers` | omitted | the PR body; repo-intel digests when the agent has repo intel on (`run-executor.ts:165-179,199-204`) |
| `skills`, `memory`, `specs` | omitted | never passed today |
| `sessionId` | none | `owner/name#number:agent` (`run-executor.ts:208`) |
| `onEvent`, `checkCancelled` | none | the run log / SSE bridge; a check that throws `RunCancelledError` once the run is cancelled or the API is shutting down (`run-executor.ts:209-212`) |

`ReviewOutcome` (`run.ts:125-143`): the grounded `review`, `grounding`, `dropped`
(with reasons), `mode`, the trace's `assembly` and chunk labels, summed tokens and
`costUsd`, and all raw outputs joined with `\n---\n` (`run.ts:278`).

## 1. Mode selection

A diff longer than `maxDiffChars` throws `DiffTooLargeError` before any call
(`run.ts:164-165`, `src/llm/errors.ts:19-25`). Then `selectMode` (`run.ts:145-159`):

- Whatever the strategy, a multi-file diff longer than `singlePassMaxChars` goes
  map-reduce: a single pass must fit the model's context (`run.ts:151-153`).
- `single-pass` — one call with the whole diff (`run.ts:154`).
- `map-reduce` — one call per file, but only when the diff has more than one file.
  A one-file diff falls back to single-pass (`run.ts:155`).
- `auto` — map-reduce only when additions + deletions exceed the threshold **and**
  there is more than one file (`run.ts:156-158`).

The server defaults to single-pass on purpose: one file's failed call fails the
whole run (`../server/src/modules/reviews/constants.ts:5-12`).

## 2. Chunk loop

Chunks are `[{ label: 'all files', diffText: diff.raw }]`, or one per file cut
with `sliceDiff` (`run.ts:190-193`). The loop is sequential: map-reduce calls do not
run in parallel (`run.ts:206-244`). For each chunk:

1. `checkCancelled()` — a throw aborts the run before the next call (`run.ts:208`).
2. A chunk with no diff text is skipped with an `info` event (`run.ts:209-212`).
3. A `tool` event, then `assemblePrompt` with the chunk's diff text (`run.ts:215-220`).
   Each chunk also gets the full task, PR description, repo skeleton and callers.
4. `llm.completeStructured({ schema: Review, schemaName: 'Review', maxRetries, maxTokens,
   sessionId, signal })` (`run.ts:224-233`).
5. A failed call is rethrown as `LlmCallError`, prefixed with the chunk label and carrying
   the usage of the earlier chunks plus the failed call's — cost `null` when the provider
   reported none (`run.ts:234-239`).
6. Usage is summed with `addUsage` (one `null` cost makes the total `null`), the raw text
   and the partial `Review` are kept, and a `result` event reports the candidate count
   (`run.ts:240-243`).

If no chunk produced a partial (an empty diff), the run throws `NothingToReviewError`
instead of approving a review of nothing (`run.ts:246`, `src/llm/errors.ts:27-33`).

`sliceDiff` (`src/review/reduce.ts:78-86`) keeps only the `diff --git` block whose header
ends with ` b/<path>`, so the slice for `x.ts` does not also take `lib/x.ts`. No block →
`''`, and the loop skips that chunk (`reduce.ts:72-77`).

Trace caveat: `assembly` starts as the whole-diff prompt and is replaced by the
prompt actually sent only in single-pass (`run.ts:187-188,221`). In map-reduce the
trace shows a whole-diff prompt that was never sent.

## 3. Prompt assembly

`assemblePrompt` (`src/prompt.ts:99-159`) builds two messages: the agent prompt plus
`INJECTION_GUARD` as system (`prompt.ts:100`), and the user sections in the order
[agent-prompts](../../docs/agent-prompts/README.md#how-a-prompt-is-assembled) shows.

- The task line is pushed **unwrapped** (`prompt.ts:119`), so it must hold no PR text: the
  PR's title and author arrive as `pr` and get their own `pr-meta` block (`prompt.ts:120-123`).
  Skills (joined bodies) and memory (`- ` bullets) are unwrapped too (`prompt.ts:102-107`).
  The PR title/author, PR description, repo skeleton, each spec chunk (`spec-<i>`), callers
  and the diff go through `wrapUntrusted` (`prompt.ts:108-111,122,125,130,135,138`).
- `wrapUntrusted` neutralises every opening or closing `untrusted` tag in the content,
  whatever its case, spacing or attributes (`<` becomes `&lt;`), so content can neither
  close its own block nor fake a new one (`prompt.ts:31-39`).
- Empty slots are left out: the PR description, repo map and callers when blank
  after trim; skills, memory and specs when the array is empty (`prompt.ts:102-137`).
  The diff section is always last (`prompt.ts:138`).
- The PR description is cut to 4000 characters and the title to 256 (`prompt.ts:42,45,113-116,121`).
- The trace record stores `callers` and `repo_map` as passed, unwrapped. `specs` and
  `user` are stored wrapped (`prompt.ts:147-156`).

The guard says the PR title sits inside `<untrusted>` (`prompt.ts:17-18`), and it does: the
server passes title and author as `pr` (`../server/src/modules/reviews/run-executor.ts:206`),
and its task line carries only the PR number (`../server/src/modules/reviews/helpers.ts:76-86`).

## 4. Provider call

The server builds `OpenRouterProvider` (`src/llm/openrouter.ts`) for agents on
`openrouter` — every seeded agent (`../server/src/db/seed.ts:12-13`) — and its own
OpenAI/Anthropic classes otherwise (`../server/src/platform/container.ts:229-263`).
`OpenRouterProvider`:

- It is the OpenAI SDK pointed at `https://openrouter.ai/api/v1`, with a 90 s timeout
  and 2 SDK retries on timeout/5xx/429 (`openrouter.ts:34,52-66`).
- It sends `temperature` 0, `max_tokens` when the request has `maxTokens`, and a strict
  JSON-schema `response_format` from `toJsonSchema` (`openrouter.ts:69,90-95`).
- `session_id` and `usage: { include: true }` are sent only when the provider id
  is `openrouter` (`openrouter.ts:98,101`).
- `req.signal` goes to the SDK, so an abort cancels the HTTP request (`openrouter.ts:103`).
- An HTTP 200 with no `choices` throws right away with the upstream message. It is
  not reprompted (`openrouter.ts:119-128`).
- An answer cut off at the token limit (`finish_reason: 'length'`) throws right away
  too: a reprompt would pay for the same oversized answer (`openrouter.ts:130-137`).
- Every failure is an `LlmCallError` carrying the tokens and cost billed so far
  (`openrouter.ts:76-81,105-111`).
- `completeStructured` and `listModels` (USD per 1M tokens, negative prices as unknown,
  cheapest output first) work; `complete` and `embed` throw (`openrouter.ts:165-207`).
  `listModels` fetches `/models` raw, so it uses the injected `fetch` and the same timeout
  through an abort signal (`openrouter.ts:166-170`).

The retry layers multiply. Each chunk gets up to `maxRetries + 1` = 3 reprompt
attempts (`openrouter.ts:83`), and each attempt gets up to 3 HTTP tries from the SDK.

## 5. Structured output and repair

`src/llm/structured.ts`:

- `toJsonSchema` converts the Zod `Review` with the SDK's `zodResponseFormat`
  (`structured.ts:19-22`).
- `parseWithRepair` first runs `JSON.parse` on the raw text. If that fails, it tries
  `extractJson`, which takes the first fenced block or else the first balanced
  `{…}`/`[…]` (`structured.ts:25-48,61-65`). The strict parse goes first because
  fences or braces inside JSON strings can fool `extractJson` (`structured.ts:57-60`).
- Invalid JSON or a Zod mismatch returns a reprompt. The provider appends the bad
  output as an assistant turn, adds the reprompt and tries again
  (`structured.ts:66-83`, `openrouter.ts:151-152`).
- After the last attempt the provider throws (`openrouter.ts:154-157`). The error leaves
  `reviewPullRequest`, and the server marks the run failed and stores the usage it
  carries (`run-executor.ts:293-321`).

Tokens and `usage.cost` add up across attempts (`openrouter.ts:113-117`).

## 6. Reduce

`reduceReviews` (`reduce.ts:58-70`) passes a single partial through — the single-pass
case — with only its duplicate findings removed (`reduce.ts:59`). Otherwise it
concatenates and de-duplicates findings, keeps the worst verdict, takes the rounded
mean score and joins summaries (`reduce.ts:60-69`). A duplicate is the same file,
start and end line, and title after trimming, lower-casing and collapsing spaces
(`reduce.ts:44-52`). The `Reduced to N finding(s); verdict=…, score=…` event fires
before grounding (`run.ts:248-251`), so its count, verdict and score are pre-grounding values.

## 7. Grounding and the final score

`groundFindings(merged.findings, input.diff)` runs once, on the whole diff, in
either mode (`run.ts:253-254`). It emits one `info` event per dropped finding, then
`Citation grounding: k/n passed` (`run.ts:256-259`). The returned review keeps the
reduced summary, swaps in the kept findings, recomputes the score from them and
derives the verdict from them under `failOn` — no findings `approve`, the gate tripped
`request_changes`, else `comment` — with an `info` event when that changes the model's
verdict (`run.ts:261-269`). The exact rules are in [the contract](../specs/grounding-and-scoring.md).

## 8. Output helpers

`src/output/to-review.ts`: `toReviewPayload` (body, inline comments anchored to a
real diff line, an event mapped from the derived verdict), `verdictFromFindings`,
`gateTriggered`, `countBlockers`. Besides `reviewPullRequest`, the server imports only
`countBlockers` and `usageOf` (`../server/src/modules/reviews/run-executor.ts:2,224,303`);
the rest is for the CI runner, back in L06 (`README.md:32-35`).

## Testing

- `test/run.test.ts` drives the pipeline with the engine's own doubles, `fixtureLlm` and
  `CONFIG_DIFF` from `test/helpers/fixtures.ts` (`test/run.test.ts:4`): no test imports
  `server/` source. Only `@devdigest/shared` still resolves to the server's copy
  (`vitest.config.ts:9`), so the engine tests need that folder beside them.
- `fixtureLlm` `safeParse`s its fixture and throws on a mismatch, never calling
  `parseWithRepair` (`test/helpers/fixtures.ts:29-34`). `test/openrouter.test.ts:42-83`
  drives `OpenRouterProvider` against a fake `fetch`: the billed cost, the `length`
  cut-off, the reprompt loop summing its attempts, an aborted signal; `:85-94`, a
  `/models` that never answers giving up after the timeout.
  `parseWithRepair` / `extractJson` are unit-tested in `../server/test/prompt-structured.test.ts:39-55`.
- The engine runs with a stub provider on a two-file diff in `test/run-limits.test.ts`:
  map-reduce slices and de-duplication (`test/run-limits.test.ts:91-119`), the derived
  verdict (`test/run-limits.test.ts:121-134`), what a failed run spent
  (`test/run-limits.test.ts:136-157`) and the limits (`test/run-limits.test.ts:159-184`);
  `test/reduce.test.ts:44-70` covers `sliceDiff` and `reduceReviews`.
  `../server/test/reviews.it.test.ts:170` has "map-reduce" in its name, but its diff has
  one file and its agent keeps the default strategy, so it runs single-pass (`run.ts:154`).
