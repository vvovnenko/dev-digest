#!/usr/bin/env node
// Publishes the self-review verdict as a GitHub commit status, so a ruleset on
// main can require it and keep "Merge" disabled until it is green.
//
//   node publish-status.mjs [--sha <commit>]     after pushing (default HEAD)
//   node publish-status.mjs --hook               Claude Code PostToolUse (stdin: hook JSON)
//
// The status mirrors the push gate's decision for that commit (gate.mjs →
// checkCommit), under the context `devdigest/pr-self-review`. It can only be
// posted after the push: GitHub rejects a status for a commit it doesn't have.
// Token: PR_SELF_REVIEW_GITHUB_TOKEN — a fine-grained PAT for this repository
// only, with "Commit statuses: write". Never the app's GITHUB_TOKEN.
// The status is self-reported: a discipline gate, not a trust boundary.

import { isAbsolute, resolve } from 'node:path';
import { checkCommit, classify } from './gate.mjs';
import { gitTry, isMain, parseArgs, readStdin, revParse } from './lib.mjs';
import { githubRepo } from './pr-description.mjs';

export const CONTEXT = 'devdigest/pr-self-review';

export async function publish(root, sha, { token = process.env.PR_SELF_REVIEW_GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, message: 'PR_SELF_REVIEW_GITHUB_TOKEN is not set — nothing published' };
  const gh = githubRepo(root);
  if (!gh) return { ok: false, message: 'origin is not a GitHub remote' };
  const onRemote = (gitTry(['branch', '-r', '--contains', sha], { cwd: root }) ?? '').trim();
  if (!onRemote) return { ok: false, message: `${sha.slice(0, 12)} is not on any remote branch yet — push first` };
  const decision = checkCommit(root, sha, 'origin');
  const state = decision.ok ? 'success' : 'failure';
  const description = decision.reason.length > 140 ? `${decision.reason.slice(0, 137)}…` : decision.reason;
  const res = await fetchImpl(`https://api.github.com/repos/${gh.owner}/${gh.repo}/statuses/${sha}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'devdigest-pr-self-review',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ state, context: CONTEXT, description }),
  });
  if (!res.ok) return { ok: false, message: `GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { ok: true, message: `published ${state} for ${sha.slice(0, 12)} as ${CONTEXT}` };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['hook'] });
  if (args.hook) {
    let input;
    try {
      input = JSON.parse(readStdin());
    } catch {
      process.exit(0);
    }
    const pushes = classify(String(input?.tool_input?.command ?? '')).filter((a) => a.kind === 'push' && !a.contentless);
    for (const a of pushes) {
      const cwd = input.cwd || process.cwd();
      const dir = a.dir ? (isAbsolute(a.dir) ? a.dir : resolve(cwd, a.dir)) : cwd;
      const root = gitTry(['rev-parse', '--show-toplevel'], { cwd: dir });
      const sha = root && revParse(root, 'HEAD');
      if (!sha) continue;
      gitTry(['fetch', '--quiet', 'origin'], { cwd: root });
      const r = await publish(root, sha);
      process.stderr.write(`pr-self-review: ${r.message}\n`);
    }
    process.exit(0);
  }
  const root = gitTry(['rev-parse', '--show-toplevel']);
  const sha = revParse(root, args.sha ?? 'HEAD');
  const r = await publish(root, sha);
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
