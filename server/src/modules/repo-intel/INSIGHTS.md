# repo-intel — insights

Things that are true about `server/src/modules/repo-intel/` but not visible in
the code. Append-only: when an entry goes stale, add a dated note under it
instead of deleting it. Other server findings go in
[`server/INSIGHTS.md`](../../../INSIGHTS.md); cross-package findings go in the
[root file](../../../../INSIGHTS.md).
Agents write here only through the `engineering-insights` skill, whose script
inserts lines and never changes existing ones.

Entry format: `- **YYYY-MM-DD** — claim. Evidence: \`path:line\``

## What works

## What doesn't work

## Codebase patterns

- **2026-10-04** — `getConventionSamples(repoId, n)` returns only top-ranked *source* paths: it goes through `JUNK_PATH_PATTERNS`, which drops any path containing `.config.`, `eslint` or `prettier` (and tests), and `file_rank` covers only `.ts/.tsx/.js/.jsx/.mjs/.cjs`, so `tsconfig.json`, `.eslintrc*` and `.prettierrc` can never come from it → a caller samples configs itself (the conventions module looks them up by name in the top files' directories). It also returns `[]` when repo-intel is disabled, which a caller can't tell from "not indexed yet". Evidence: `server/src/modules/repo-intel/service.ts:629-631`, `server/src/modules/repo-intel/service.ts:723-727`, `server/src/modules/conventions/domain.ts:148`
  - **2026-10-04** — Line evidence moved: the conventions config lookup is now `server/src/modules/conventions/domain.ts:194`. Evidence: `server/src/modules/conventions/domain.ts:194`
- **2026-10-04** — `getConventionSamples` is deterministic and favours hubs: its order is the stored `file_rank.rank` (PageRank + hotness), so every call returns the same files until a re-index, and the top of the list is barrel `index.js` / constants files from one top-level folder — on `burnjohn/quick-blog` all top 20 are `client/` (161 client vs 49 `server/` files ranked). Conventions re-scans therefore read the same 13 files; with every decided rule excluded (up to 30 listed in the prompt, all by fingerprint) the model found 15 candidates at 0 rejected, 2–3 at 34–37 → to surface new conventions, vary or stratify the sample (e.g. per top-level folder, skip barrels), don't just re-scan. Evidence: `server/src/modules/repo-intel/service.ts:631,647`, `server/src/modules/conventions/prompt.ts:92`, `server/src/modules/conventions/service.ts:209,255`

## Tool & library notes

## Recurring errors & fixes

## Doc drift

## Session notes

- **2026-10-04** — HW2 Conventions Extractor (first caller of getConventionSamples; README signature fixed in place): +1 (Codebase patterns)
- **2026-10-04** — Why Re-scan finds 2–3 conventions (fixed top-ranked sample + decided-rule exclusion): +1 (Codebase patterns)

## Open questions
