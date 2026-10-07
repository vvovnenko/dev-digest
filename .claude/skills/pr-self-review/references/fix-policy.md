# `--fix` policy

`--fix` turns a BLOCKED verdict into edits: Claude fixes each confirmed CRITICAL
(with `--fix=all`, each WARNING too) from its `suggestion`, the user sees every edit
as a normal Edit, and the review reruns. It is a shortcut through the boring part,
not a licence to rewrite the branch — so it has hard limits.

## Loop

1. Take the blocking findings from the report (`verdict.mjs show`), most severe first.
2. For each: read the cited lines and the rule (`severity.md` catalog → skill section),
   make the smallest change that removes the problem, and keep behaviour that depends
   on the code (effects, shortcuts, fallbacks — see frontend-ui-architecture → Scope
   discipline). One finding, one focused edit.
3. Stale citations (D9): `node .claude/skills/pr-self-review/scripts/citations.mjs --run <id> --fix`
   rewrites shifted or renamed full-path citations in docs and specs; bare `:N`
   shorthand and every `CLAUDE.md` stay manual.
4. Rerun the review (`select-skills` → `checks` → reviewers → `finalize`). Only files
   whose content changed are reviewed again; the rest comes from the cache.
5. At most **two** fix iterations. If CRITICALs remain, stop and hand the list back to
   the user with what you tried.

## Never

- **Do-not-touch paths**: `server/clones/**`, `**/src/vendor/**` (except a deliberate
  contract change in `server/src/vendor/shared/` mirrored to the client), lockfiles,
  `.env`, `next-env.d.ts`, `src/modules/repo-intel/` internals.
- **`INSIGHTS.md`**: only through `engineering-insights`' `append-insight.mjs`; never
  edit or delete a line, not even to "fix" a finding.
- **`CLAUDE.md`**: add-only; changing an existing line needs the user's explicit OK.
- **Migrations by hand**: change the schema, then `cd server && pnpm db:generate`.
  Never edit an applied migration or the journal.
- **History**: no rebase, amend, reset or force-push. For a leaked secret (D1),
  remove it from the code, tell the user to **rotate the key**, and — if the commit
  is not pushed yet — show the commands to drop it from history
  (`git rebase -i <base>` and edit the commit) without running them.
- **Baselines and ratchets**: never grow `server/.dependency-cruiser-known-violations.json`
  or an `ALLOWED` map to make a check pass; fix the import or the route instead.
- **Waivers**: `--fix` never waives. A false positive goes to the user, who gives the
  reason for `--waive`.
- **Scope**: don't refactor neighbouring code, rename things or "clean up" while
  fixing. List other problems you notice; fix only the findings.

## After fixing

Commit nothing yourself unless the user asks. The gate compares the pushed commit's
tree with the reviewed one, so the user should commit exactly what the last
review saw (`git add -A && git commit`), then push.
