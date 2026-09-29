# e2e — insights

Things that are true about `e2e/` but not visible in the code. Append-only:
when an entry goes stale, add a dated note under it instead of deleting it.
Cross-package findings go in the [root file](../INSIGHTS.md).
Agents write here only through the `engineering-insights` skill, whose script
inserts lines and never changes existing ones.

Entry format: `- **YYYY-MM-DD** — claim. Evidence: \`path:line\``

## What works

## What doesn't work

## Codebase patterns

- **2026-09-23** — The seed writes PR #482's review and findings only when it creates the PR, so deleting the seeded review (the accordion's trash icon) is permanent for that DB — `pnpm db:seed` won't bring it back and flow 04 then fails → never delete it in a DB you run flows against; the hermetic stack always starts empty. Evidence: `../server/src/db/seed.ts:99`.

## Tool & library notes

- **2026-09-23** — Flows fail with `spawn agent-browser ENOENT` without the global
  CLI. Instead of `npm i -g agent-browser && agent-browser install`, which downloads
  Chrome for Testing, point the runner at any install and at the system Chrome:
  `AGENT_BROWSER_BIN=<path>/agent-browser
  AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  npm run e2e:hermetic` → 7/7 passed. Evidence: `run.ts:40`, `README.md:52-53`.
- **2026-09-28** — agent-browser 0.27 `find … click` clicks by coordinates and does not scroll the app shell's inner pane: in the default ~1280×577 viewport, `find role button click --name Accept` on a button at y≈952 exited 0 and sent no request. `scrollintoview` and `find … hover` did not scroll it either, and `find … focus` (listed in `find --help`) fails with `Unknown subaction: focus` → start such a flow with `set viewport 1280 1600`. Evidence: `specs/08-review-journey.flow.json:5,17`.
- **2026-09-28** — `find label "<text>"` matches only elements tied to a `<label>`, not an `aria-label`: the Timeline's icon button labelled "Open run trace & logs" gave `Element not found`, while `find role button click --name "Open run trace & logs"` works. Evidence: `specs/08-review-journey.flow.json:19`, `../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:230`.
- **2026-09-28** — `wait --text` sees rendered text, so CSS `text-transform` changes what matches: "Live review", a `SectionLabel` (uppercased), timed out after 60 s, while "Review in progress…", shown under the same `reviewRunning` condition in plain case, passes → assert on copy that isn't CSS-transformed. Evidence: `../client/src/vendor/ui/primitives/SectionLabel.tsx:22`, `specs/08-review-journey.flow.json:15`.

## Recurring errors & fixes

- **2026-09-23** — `scripts/e2e.sh` installs deps only for `server/`, `client/` and `reviewer-core/`, then runs `npm test` in `e2e/` → on a fresh clone run `cd e2e && npm install` first or the runner can't start (`tsx` missing). Evidence: `../scripts/e2e.sh:106-117,163`.
  - **2026-09-28** — Fixed: the script also runs `npm ci` in `e2e/` when its `node_modules` is missing. Evidence: `../scripts/e2e.sh:142`.
- **2026-09-28** — The hermetic API was not hermetic for secrets: it read the developer's `~/.devdigest/secrets.json` and the `GITHUB_TOKEN` that `dotenv` loads from `server/.env`, so every flow made real GitHub calls for `acme/payments-api` (404 warnings in the log) and used the dev clone dir; CI has neither. `e2e.sh` now points `DEVDIGEST_SECRETS_PATH` / `DEVDIGEST_CLONE_DIR` at a `mktemp -d` and sets both tokens to empty (dotenv keeps a set-but-empty variable); the next run logged 0 `api.github.com` calls. Evidence: `../scripts/e2e.sh:50-56`, `../server/src/adapters/secrets/local.ts:54-58`.

## Doc drift

- **2026-09-23** — README's example and coverage table show flow 01 asserting the
  seeded PR `#482`; the real flow 01 is order-independent and only checks the
  redirect to `/pulls` plus the "Pull Requests" heading — `#482` is asserted in
  02. Evidence: `README.md:21,96`, `specs/01-app-boot.flow.json`.
  - **2026-09-29** — Fixed in place: the example and the 01 row assert "Pull Requests"; `specs/flows.md` dropped its README-drift note. Evidence: `README.md:16-22,113`.
- **2026-09-23** — `CLAUDE.md` says "read stderr" for a failing step, but `run.ts` prints only the first line of the thrown error and drops the rest of agent-browser's output → to see it all, rerun the failing command by hand (`agent-browser wait --text …`) against a live stack. Evidence: `run.ts:81`, `CLAUDE.md:40`.
  - **2026-09-28** — Fixed: `run.ts` now prints agent-browser's whole stderr and stdout under the `✗` line (the old CLAUDE.md line stays, with a superseding line added). Evidence: `run.ts:58-66,113-115`.
- **2026-09-23** — README's coverage row for flow 04 says "expand → FindingCard", but the flow never expands: it relies on the newest review run being open by default. Evidence: `README.md:99`, `../client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:175`.
  - **2026-09-29** — Fixed in place: the 04 row says the newest run opens by default, no click. Evidence: `README.md:116`.

## Session notes

- **2026-09-23** — Findings-by-severity implementation: +1 (Tool & library notes)
- **2026-09-23** — HW1 fixes, block F (docs/hermetic-runner.md, specs/flows.md): +4 (Doc drift ×2, Recurring errors & fixes, Codebase patterns)
- **2026-09-28** — Wave 4 (flow 08 review journey on the fake LLM, per-flow sessions, full failure output, isolated secrets/clones): +6 (Tool & library notes ×3, Recurring errors & fixes + fix note, Doc drift fix note)
- **2026-09-29** — Wave 5 (README example and coverage rows, flows.md drift note): +2 (Doc drift fix notes)

## Open questions
