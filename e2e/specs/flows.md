# Flows — contract

**Status:** contract — describes the shipped flows and the app behaviour they pin. Change a flow, the UI copy it asserts, or the seed together with this file.

This file is prose; the executable flows are the eight `NN-name.flow.json` next to
it, and `run.ts` loads only names ending in `.flow.json` (`run.ts:74`). Step format:
[`../README.md`](../README.md); the stack: [`../docs/hermetic-runner.md`](../docs/hermetic-runner.md);
routes and tabs: [`../../client/specs/pages.md`](../../client/specs/pages.md).
Citations are `path:line`, relative to `e2e/`.

## Seeded data the flows rely on

`pnpm db:seed` on the hermetic runner's empty DB (`../scripts/e2e.sh:150-153`):

| Data | Value | Flows | Seed |
| ---- | ----- | ----- | ---- |
| repo | `acme/payments-api`, the only repo | 01, 02, 04, 05 | `../server/src/db/seed.ts:73-91` |
| PR | #482 "Add rate limiting to public API endpoints", head `a1b2c3d4e5f6`, no `last_reviewed_sha` | 02, 04, 05 | `../server/src/db/seed.ts:94-117` |
| `pr_files` | 4 rows, one of them `src/config.ts`, the only one with a patch (4 added lines) | 05, 08 | `../server/src/db/seed.ts:120-125,231-243` |
| `pr_commits` | 1 commit | — | `../server/src/db/seed.ts:128-133` |
| review | `request_changes`, score 61, `model: 'seed'`, no agent, no run | 04 | `../server/src/db/seed.ts:136-148` |
| findings | CRITICAL "Hardcoded Stripe secret key in commit", WARNING "N+1 query in user list endpoint" | 04 | `../server/src/db/seed.ts:150-175` |
| agents | General, Security and Performance Reviewer | 03, 08 | `../server/src/db/seed.ts:180-221` |

- **List status is derived.** The seed puts `'needs_review'` in the merge-state column
  (`../server/src/db/seed.ts:114`); the list derives `needs_review` from the null `last_reviewed_sha`
  (`../server/src/modules/pulls/domain.ts:128-134`, `:11-14,53-55`).
  The list defaults to `?status=needs_review` (`../client/src/app/(shell)/repos/[repoId]/pulls/_components/PullsListView/PullsListView.tsx:35`,
  `../client/src/app/(shell)/repos/[repoId]/pulls/constants.ts:57`).
- **No `agent_runs` rows** (`../server/src/db/seed.ts:31-224`), so the accordion header
  reads `Agent` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:66`,
  `../client/messages/en/prReview.json:160`).
- **Review and findings are written only with a new PR #482** (`../server/src/db/seed.ts:99`):
  re-seeding a DB that still has the PR does not restore a deleted seeded review.

## Flows

Each flow runs in its own browser session, closed when it ends (`run.ts:50,122-125`), and each starts with `open`.
Several asserted strings appear twice on a page; the preceding `wait --url` proves the navigation.

### 01 — App boots and lands on a repo's PR list

`open /`, `networkidle`, then:

- `wait --url /pulls`: the root redirects to `/repos/<first repo>/pulls` only when the
  API returns a repo (`../client/src/app/(shell)/_components/HomeView/HomeView.tsx:19-23`), else shows an empty state.
- `wait --text "Pull Requests"`: the list heading (`../client/messages/en/prReview.json:81`,
  `../client/src/app/(shell)/repos/[repoId]/pulls/_components/PullsListView/PullsListView.tsx:71`). The sidebar shows it on every page, the
  root too (`../client/src/vendor/ui/nav.ts:25`, `../client/src/vendor/ui/shell/NavItem.tsx:54`).

### 02 — Open a PR from the list and load its review detail

`open /`, `wait --url /pulls`, then:

- `wait --text` + `find text … click` "Add rate limiting to public API endpoints", the
  row title, a `<Link>` (`../server/src/db/seed.ts:106`, `../client/src/app/(shell)/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:47-49`).
- `wait --url /pulls/482`: the link goes to `/repos/<id>/pulls/<number>`; a click elsewhere on
  the row pushes the same URL (`../client/src/app/(shell)/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:35,40`).
- `networkidle`, then the same title again, now in the detail header
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:39`).

### 03 — Agents list renders the seeded reviewer agents

`open /agents`, `wait --url /agents`, `networkidle`, `wait --text "Security Reviewer"`:
the seeded agent (`../server/src/db/seed.ts:194`) in its card
(`../client/src/app/(shell)/agents/_components/AgentCard/AgentCard.tsx:46`; a `<button>` when the
card opens the agent, as on the list, else a plain `<span>` at `:49`).

### 04 — PR detail shows the seeded review run, verdict, and findings

`open /`, `wait --url /pulls`, click the PR title, `wait --url /pulls/482`, `networkidle`, then:

- `find role button click --name "Agent runs"`: the tab label
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:91`, `../client/messages/en/prReview.json:177`),
  a `<button>` that also holds the findings count (`../client/src/vendor/ui/kit/Tabs.tsx:25-50`).
- `wait --url tab=findings`: the key goes into `?tab` via `router.replace`
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx:37-42`).
- `wait --text "request changes"`: the accordion badge, one lower-case message per verdict
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:69`,
  `../client/messages/en/prReview.json:162`); the banner below says "Request changes"
  (`../client/messages/en/prReview.json:24`).
- `wait --text "2 findings"`: the accordion header, an ICU plural
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:73`,
  `../client/messages/en/prReview.json:166`); the banner repeats it (`../client/messages/en/prReview.json:27`).
- `wait --text "Hardcoded Stripe secret key in commit"`: the FindingCard title
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:62`);
  no click: the newest review opens when the reviews load (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsTab/useOpenRuns.ts:23-29`,
  applied at `../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:138`).

### 05 — PR detail Files changed tab renders the seeded diff

Same path to `/pulls/482` as 04, then:

- `find role button click --name "Files changed"`, then `wait --url tab=diff`
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:95`, `../client/messages/en/prReview.json:178`).
- `wait --text "src/config.ts"`: the diff viewer's file header
  (`../client/src/components/diff-viewer/FileCard/FileCard.tsx:61`) over `pr.files`
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailView/PrDetailView.tsx:109`); without GitHub
  the API serves the seeded `pr_files` (`../server/src/modules/pulls/service.ts:54-55`,
  `../server/src/modules/pulls/domain.ts:143-173`).

### 06 — Onboarding add-repository screen renders

`open /onboarding`, `wait --url /onboarding`, then `wait --text "Add a repository"`
(heading) and `"Repository URL"` (field label), both messages
(`../client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx:58,76`,
`../client/messages/en/shell.json:77,79`). Never submits. The root empty state also says
"Add a repository" (`../client/src/app/(shell)/_components/HomeView/HomeView.tsx:37`,
`../client/messages/en/shell.json:62`).

### 07 — Settings renders the API Keys and Feature Models sections

`open /settings/api-keys`, `wait --url`, `networkidle`, `wait --text "API Keys"`; then
`open /settings/models`, `wait --url`, `wait --text "Feature Models"`. Section titles:
`../client/messages/en/settings.json:6,24`. The vendored list (`../client/src/vendor/ui/nav.ts:40-41`)
puts the same labels in the settings nav and breadcrumb (`../client/src/app/(shell)/settings/[section]/_components/SettingsView/SettingsView.tsx:22,28-35`),
so the text passes even if a section body fails to render.

### 08 — Run a review on PR #482, watch it live, accept its finding and open its trace

The one flow that writes, so it sorts last. It needs the API's fake LLM
(`DEVDIGEST_FAKE_LLM=1`, `../scripts/e2e.sh:47-49`, `../.github/workflows/e2e-web.yml:7-9`):
`../server/src/platform/container.ts:234` hands every agent a `FakeReviewLlm`, which answers
with one WARNING titled "Fake finding on the first added line" on the first added line of
the prompt's diff (`../server/src/adapters/llm/fake.ts:17-18,21,45`). With no clone the diff
comes from the stored patches (`../server/src/adapters/git/pr-diff.ts:19-29`), so the seed's one
patch is what makes the review possible; without it every run fails with "The diff has no
reviewable text" (`../reviewer-core/src/llm/errors.ts:30`).

`set viewport 1280 1600` first: agent-browser clicks by coordinates and does not scroll the
shell's inner pane, so an Accept button below a 577 px viewport was clicked silently in
vain. Then the path to `/pulls/482?tab=findings` as in 04, and:

- `find role button click --name "Run Review"`, then `find text "Run all enabled agents" click`
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx:65,87`, `../client/messages/en/prReview.json:49,52`):
  one run per enabled agent, three with the seed.
- `wait --text "Review in progress"`: the live banner while any run is `running`
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:93`, `../client/messages/en/prReview.json:148`). Not
  "Live review": that `SectionLabel` is CSS-uppercased and `wait --text` matches the rendered
  "LIVE REVIEW". The fake answers after 1.5 s per run, so the banner shows for about 4.5 s.
- `wait --text "Fake finding on the first added line"`: a finished run's card; the grounding
  gate kept it, since the line is in the patch's hunk.
- `find role button click --name Accept`: the first expanded card's Accept
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:110,112`, `../client/messages/en/prReview.json:6`) →
  `POST /findings/:id/accept`, applied optimistically (`../client/src/lib/hooks/reviews.ts:158-181`).
- `wait --text "accepted"`: the card's tag (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:64`,
  `../client/messages/en/prReview.json:3`).
- `find role button click --name "Open run trace & logs"`: the Timeline icon button's
  `aria-label` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:229-230`, `../client/messages/en/prReview.json:125`);
  `find label` finds only `<label>` elements, not `aria-label`.
- `wait --text "Prompt assembly"`: a section title of the persisted trace
  (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:74`, `../client/messages/en/runs.json:22`).

After 08, #482 has three more runs, an accepted finding and a `last_reviewed_sha`, so it
leaves the default `needs_review` list (see **Rules for new flows**).

## Copy and URLs that must not change

| String / URL fragment | Flows | Lives in |
| --------------------- | ----- | -------- |
| `/pulls` | 01, 02, 04, 05, 08 | route `../client/src/app/(shell)/repos/[repoId]/pulls/` (the `(shell)` group adds nothing to the URL); redirect `../client/src/app/(shell)/_components/HomeView/HomeView.tsx:21` |
| `/pulls/482` | 02, 04, 05, 08 | `../client/src/app/(shell)/repos/[repoId]/pulls/_components/PRRow/PRRow.tsx:35` + seed PR number `../server/src/db/seed.ts:105` |
| `tab=findings`, `tab=diff` | 04, 08 · 05 | hardcoded tab keys, `../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:90,95` (parsed by `../client/src/app/(shell)/repos/[repoId]/pulls/[number]/helpers.ts:15`) |
| `/agents`, `/onboarding`, `/settings/api-keys`, `/settings/models` | 03, 06, 07 | app routes; section keys vendored, `../client/src/vendor/ui/nav.ts:40-41` |
| Pull Requests | 01 | messages, `../client/messages/en/prReview.json:81` (also vendored `../client/src/vendor/ui/nav.ts:25`) |
| Add rate limiting to public API endpoints | 02, 04, 05, 08 | seed, `../server/src/db/seed.ts:106` |
| Agent runs · Files changed (button names) | 04, 08 · 05 | messages `../client/messages/en/prReview.json:177-178`, used at `../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:91,95` |
| request changes | 04 | seed verdict `../server/src/db/seed.ts:142`, message `../client/messages/en/prReview.json:162` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:69`) |
| 2 findings | 04 | ICU plural `../client/messages/en/prReview.json:166` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:73`) over the seed's two findings |
| Hardcoded Stripe secret key in commit | 04 | seed, `../server/src/db/seed.ts:158` |
| src/config.ts | 05 | seed, `../server/src/db/seed.ts:123` |
| Security Reviewer | 03 | seed, `../server/src/db/seed.ts:194` |
| Add a repository · Repository URL | 06 | messages `../client/messages/en/shell.json:77,79` (`../client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx:58,76`) |
| Run Review · Run all enabled agents | 08 | messages `../client/messages/en/prReview.json:52,49` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx:87,65`) |
| Review in progress | 08 | message `../client/messages/en/prReview.json:148` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:93`) |
| Fake finding on the first added line | 08 | `FAKE_FINDING_TITLE`, `../server/src/adapters/llm/fake.ts:17` |
| Accept · accepted | 08 | messages `../client/messages/en/prReview.json:6,3` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:112,64`) |
| Open run trace & logs (`aria-label`) | 08 | message `../client/messages/en/prReview.json:125` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunHistory/RunHistory.tsx:230`) |
| Prompt assembly | 08 | message `../client/messages/en/runs.json:22` (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:74`) |
| API Keys · Feature Models | 07 | messages `../client/messages/en/settings.json:6,24` + vendored `../client/src/vendor/ui/nav.ts:40-41` |

## Rules for new flows

- **Read-only against the seed**, except 08 (below). No submit, create, delete or re-run. The accordion's
  delete button (`../client/src/app/(shell)/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:94-107`)
  would remove a review that re-seeding does not restore (`../server/src/db/seed.ts:99`).
- **No model calls.** 08 runs reviews only because the API answers with the fake LLM; a real
  one would bill a key. The seeded agents run on OpenRouter (`../server/src/db/seed.ts:12-13`),
  and a finished run stores the head SHA as `last_reviewed_sha`
  (`../server/src/modules/reviews/run-executor.ts:282-284`,
  `../server/src/modules/reviews/repository/run.repo.ts:231`,
  `../server/src/modules/reviews/repository/pull.repo.ts:40-45`). #482 then reads
  `reviewed` or `stale` (`../server/src/modules/pulls/domain.ts:55-58`) and leaves the default
  `?status=needs_review` list, which breaks 02, 04 and 05.
- **Deterministic locators only**: `--url`, `--text`, `find role|text|label`, never
  `chat` (`README.md:35-36`). Start with `open`, and put a `wait --url` before any text
  the sidebar, settings nav or breadcrumb also shows.
- **Writes run last.** 08 leaves #482 reviewed, so a new read-only flow that needs the pristine
  seed must sort before it: renumber 08 rather than take `09`.
- **Next free number is `09`**: `09-<kebab>.flow.json` with a sentence `name`
  (`CLAUDE.md:34-35`). Add its section and table rows here in the same change;
  verify with `npm run e2e:hermetic`.
