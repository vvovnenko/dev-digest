# Intent Layer

**Status:** shipped

The feature spans the API and the UI. The endpoints, the sources, the confidence rule, the
triggers and the out-of-scope filter are in
[`server/specs/06-intent-layer.md`](../../server/specs/06-intent-layer.md); this spec is the UI half.
The route's contract is in [`pages.md`](./pages.md#reposrepoidpullsnumber).

## Problem

The reviewer now works from a derived intent of the PR (what it is for, what belongs to it, what
does not). The author has to be able to see how the system read the task, to correct it by deriving
again, and to see which findings the reviewer flagged as outside it.

## Scope

- **Route** `/repos/:repoId/pulls/:number`, tab **Overview** (the default tab). No new route and
  no sidebar change.
- **Component, new:** `IntentCard` in
  `src/app/(shell)/repos/[repoId]/pulls/[number]/_components/IntentCard/`
  (`IntentCard.tsx`, `index.ts`, `styles.ts`, `helpers.ts`, `constants.ts`, `IntentCard.test.tsx`).
  It is presentational: its props are `state`, `loading`, `onDerive` and `deriving`
  (`IntentCard.tsx:15-22`).
- **Components, changed:**
  - `OverviewTab` takes `prId`, calls `usePrIntent` and `useDeriveIntent`, and renders `IntentCard`
    above the Description section (`OverviewTab/OverviewTab.tsx:15-26`); `PrDetailView` passes `prId`
    (`PrDetailView/PrDetailView.tsx:92`).
  - `FindingCard` shows an **out of scope** badge when the finding has `out_of_scope`
    (`FindingCard/FindingCard.tsx:64`, `FindingCard/styles.ts:47-55`).
- **Data layer, new:** `src/lib/hooks/intent.ts` (`usePrIntent`, `useDeriveIntent`),
  `src/lib/intent.ts` (`isIntentActive`), `prKeys.intent` in `src/lib/hooks/keys.ts:14`, one export
  line in `src/lib/hooks/index.ts:9`.
- **Copy:** `messages/en/brief.json:19-41` (the `intent` object; the card title is the existing
  `block.intent`, `:3`) and `messages/en/prReview.json:190-192` (`scope.outOfScope`). New keys sit at
  the end of each file so no existing citation moves.
- **Settings → Models:** the `review_intent` row, "PR Review · Intent", now defaults to
  `openrouter` / `openai/gpt-5.4-nano` (`src/lib/feature-models.ts:22-27`, mirroring
  `server/src/vendor/shared/contracts/platform.ts:52-57`).
- **Contracts:** `src/vendor/shared/` is a byte-for-byte copy of the server's (`diff -r` is empty);
  the card reads `PrIntentState`, `PrIntentRecord` and `IntentSource`, and `FindingCard` reads
  `Finding.out_of_scope`.

**Unchanged (no diff at all):**
- `client/src/lib/api.ts`, `client/src/lib/hooks/reviews.ts`, `client/src/lib/providers.tsx`;
- `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**`: the drawer does
  not render the prompt's `intent` slot;
- `client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`,
  `.../DiffTab/DiffTab.tsx`, `.../FindingsTab/FindingsTab.tsx`, `.../FindingsPanel/FindingsPanel.tsx`;
- `client/src/vendor/ui/**` (the card is built from the vendored kit as it is);
- `e2e/**`: the Overview copy is not asserted by any flow.

**Out of scope:** Risk areas, Blast radius, the PR brief card and Review focus (L04–L05); showing
the intent in the run trace drawer; an automatic re-derive.

## API / Data

**Hooks** — `src/lib/hooks/intent.ts`

| Hook | Endpoint | Behaviour |
| ---- | -------- | --------- |
| `usePrIntent(prId)` (`:19-26`) | `GET /pulls/:id/intent` → `PrIntentState` | key `prKeys.intent(prId)` = `["pr", prId, "intent"]`; runs only with a `prId`; refetches every 2 s (`INTENT_POLL_MS`) while the state is `queued` or `running` (`isIntentActive`, `src/lib/intent.ts:9-11`), so it also picks up an attempt started in another tab or before a reload |
| `useDeriveIntent()` (`:33-39`) | `POST /pulls/:id/intent` → 202 `PrIntentState` | `onSuccess` writes the returned state into the cache, which starts the polling; no `onError` toast of its own (the global handler shows a failed request) |

The key sits under the PR's `["pr", prId]` prefix, so the invalidation that ends a review run
(`useRunSettled` → `prKeys.all`, `src/lib/hooks/reviews.ts:51-58`) also refreshes the card: an intent
a review derived inline appears without a reload.

**The card** — `IntentCard.tsx`. The title is the section label **Intent** with the `Target` icon.

| State | Condition | What shows |
| ----- | --------- | ---------- |
| loading | no state yet and the first read is in flight (`:57-64`) | a skeleton; no button |
| none | status `none`, no intent, not active (`:66-80`) | "No intent derived yet." and a **Derive intent** button → `onDerive` |
| deriving | status `queued` or `running`, or the POST is being sent (`:53,104-110`) | "Deriving…" with skeleton lines; the previous intent, if any, stays below; no confidence badge, no ↻ |
| done | an intent exists (`:123-153`) | the summary as a quote, in plain text, never Markdown; two columns **In scope** and **Out of scope**, "Nothing listed." for an empty list; a confidence badge **High / Medium / Low confidence** with its colour (`constants.ts:4-8`); ↻ **Re-derive intent** (`:92-98`) |
| low confidence | `confidence === 'low'` (`:134`) | the badge plus the hint "Derived from title and changed files — add a description or link a spec for a sharper intent" |
| sources | the intent has linked documents, or `missing_context` (`:135-151`) | one line: each linked document's `ref` in mono type, an unavailable one as "{ref} — unavailable ({reason})" with an ✖ icon, then "Missing: {items}". Only linked documents are listed (`helpers.ts:5-7`, `constants.ts:11`); the title, description and files sources are not |
| failed | status `failed`, not active (`:111-116`) | "Deriving the intent failed." — a fixed text, not the server's `error` — and ↻; a previous intent stays visible |
| stale | `state.stale` with an intent, not active (`:117-122`) | a banner with a warning icon: "The PR changed after this intent was derived — re-derive it." (`head_changed`), "The description changed after this intent was derived — re-derive it." (`description_changed`), or "This intent may be out of date — re-derive it." (`staleKey`, `helpers.ts:15-17`); ↻ |

**Finding card.** A finding with `out_of_scope: true` shows a small grey tag **out of scope** next to
its category, before the accepted / rejected tags. A finding without the flag, or with `false`, shows
none (`FindingCard.tsx:64`). The flag is the model's; with a stale or `low` intent findings are only
tagged, and with a fresh one the dropped findings are not in the list at all
([server spec](../../server/specs/06-intent-layer.md)).

## Acceptance criteria

1. With no intent, the card offers **Derive intent**, and a click calls `onDerive` once
   (`IntentCard.test.tsx:55`). While the first read is in flight it shows no button (`:62`).
2. A done intent shows the summary, both scope columns, the confidence badge, the linked sources, an
   unavailable one marked, "Missing: …" and a working **Re-derive intent**; a High intent shows no
   low-confidence hint (`IntentCard.test.tsx:67`).
3. A `low` intent shows "Low confidence" and the hint (`:84`).
4. While an attempt is `queued` or `running` the card says "Deriving…", keeps the previous intent and
   has no re-derive button (`:92`).
5. A failed attempt shows the error and lets the user re-derive (`:99`); a stale intent shows the
   banner for its reason, with re-derive (`:107`).
6. `usePrIntent` reads the intent and waits for a PR id (`src/lib/hooks/intent.test.tsx:49`), polls
   every 2 s only while the attempt is `queued` or `running` (`:62`); `useDeriveIntent` posts, puts the
   202 state in the cache and the polling runs until `done` (`:88`).
7. The out-of-scope tag shows only for a finding marked `out_of_scope`
   (`FindingCard.test.tsx:64`).
8. Live: open a PR's Overview, **Derive intent** → "Deriving…" → a done card; Run Review → the
   findings the model flagged show the tag. The seeded PR #482 already has a `medium` intent
   (server spec, criterion 1). Needs `OPENROUTER_API_KEY` for a real derive.
