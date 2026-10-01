#!/usr/bin/env node
// The push gate: a commit may leave the machine only with a PASS self-review.
//
//   gate.mjs --git-pre-push <remote> <url>   git's pre-push hook (stdin: one line per ref)
//   gate.mjs --claude                        Claude Code PreToolUse hook (stdin: hook JSON)
//   gate.mjs --check [<commit>]              would a push of <commit> (default HEAD) pass?
//
// It looks only at the commit being pushed — never HEAD or the working copy —
// so pushing another branch or a detached HEAD is judged correctly. A push
// passes when: the commit adds nothing over the merge-base; or a full-mode
// PASS verdict exists for the commit's tree, reviewed against a base that is
// an ancestor of today's merge-base; or no reviewer skill applies (docs only)
// and the cheap deterministic checks pass. Secrets are scanned in every commit
// being pushed, not only the final tree: a key added and later removed still leaks.

import { isAbsolute, resolve } from 'node:path';
import { collectDiff } from './collect-diff.mjs';
import { cheapChecks, scanPushedCommits } from './checks.mjs';
import {
  ZERO_SHA,
  git,
  gitTry,
  isAncestor,
  isMain,
  mergeBase,
  readJson,
  readStdin,
  revParse,
  verdictPath,
} from './lib.mjs';
import { linkSpecs } from './specs.mjs';
import { loadRouting, route } from './select-skills.mjs';

// The skill is user-invoked only (`disable-model-invocation`), so Claude can't start
// it: the hint tells Claude to hand it to the user.
const HINT =
  'Ask the user to run /pr-self-review (it is user-invoked; Claude can\'t start it), fix or — with the user\'s reason — waive its CRITICALs, commit exactly the reviewed state, then push again.';

function baseRefFor(root, remote) {
  const head = gitTry(['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`], { cwd: root });
  if (head && revParse(root, head)) return head.replace(/^refs\/remotes\//, '');
  if (revParse(root, `${remote}/main`)) return `${remote}/main`;
  return null;
}

/** Decide one commit. Returns { ok, reason }. */
export function checkCommit(root, sha, remote = 'origin') {
  const short = sha.slice(0, 12);
  const baseRef = baseRefFor(root, remote);
  if (!baseRef) return { ok: false, reason: `can't tell what ${short} is compared with (no ${remote}/HEAD or ${remote}/main). Fetch the remote first.` };
  const mb = mergeBase(root, baseRef, sha);
  if (!mb) return { ok: false, reason: `${short} shares no history with ${baseRef}` };
  const tree = git(['rev-parse', `${sha}^{tree}`], { cwd: root });
  if (tree === git(['rev-parse', `${mb}^{tree}`], { cwd: root })) return { ok: true, reason: `${short} changes nothing over ${baseRef}` };

  const leaks = scanPushedCommits(root, sha, remote);
  if (leaks.length) {
    const list = leaks.slice(0, 5).map((l) => `${l.commit.slice(0, 8)} ${l.path}: ${l.rule} (${l.token})`).join('; ');
    return {
      ok: false,
      reason: `secret-shaped token(s) in commits being pushed — ${list}. Remove them from history (they stay in every commit that has them) and rotate the keys; this can't be waived.`,
    };
  }

  const verdict = readJson(verdictPath(root, tree), null);
  if (verdict) {
    if (verdict.mode !== 'full') return { ok: false, reason: `the verdict for ${short} is a --quick one; run a full /pr-self-review` };
    if (verdict.status !== 'PASS') {
      const c = verdict.counts ?? {};
      return { ok: false, reason: `self-review of ${short} is ${verdict.status}${c.blocking ? ` (${c.blocking} blocking CRITICAL)` : ''}${verdict.reasons?.length ? `: ${verdict.reasons.join('; ')}` : ''}. ${HINT}` };
    }
    if (!isAncestor(root, verdict.base_sha, mb)) {
      return { ok: false, reason: `${short} was reviewed against ${verdict.base_sha.slice(0, 12)}, but its merge-base with ${baseRef} is now ${mb.slice(0, 12)}. ${HINT}` };
    }
    return { ok: true, reason: `PASS verdict for tree ${tree.slice(0, 12)} (${verdict.created_at})` };
  }

  // No verdict: let a change no reviewer skill applies to through, if the
  // cheap deterministic checks pass.
  const diff = collectDiff(root, { base: baseRef, commit: sha, remote });
  const { routing } = loadRouting(root, diff);
  const { bySkill } = route(diff, routing);
  const skills = Object.keys(bySkill);
  const specs = linkSpecs(root, diff);
  if (!skills.length && !specs.length) {
    const blocking = cheapChecks(root, diff).flatMap((c) => c.findings).filter((f) => f.severity === 'CRITICAL');
    if (!blocking.length) return { ok: true, reason: `no reviewer skill applies to ${short} (docs only) and the deterministic checks pass` };
    return { ok: false, reason: `${blocking.length} CRITICAL from deterministic checks on ${short}: ${blocking.slice(0, 3).map((f) => `${f.file} ${f.rule_id}`).join('; ')}. ${HINT}` };
  }
  return {
    ok: false,
    reason: `no self-review verdict for ${short} (tree ${tree.slice(0, 12)}; reviewers due: ${skills.slice(0, 6).join(', ')}${skills.length > 6 ? ', …' : ''}). ${HINT}`,
  };
}

function remoteName(root, arg) {
  const remotes = (gitTry(['remote'], { cwd: root }) ?? '').split('\n').filter(Boolean);
  return remotes.includes(arg) ? arg : 'origin';
}

function prePush(root, remoteArg) {
  const remote = remoteName(root, remoteArg);
  const lines = readStdin().split('\n').filter(Boolean);
  const denials = [];
  for (const line of lines) {
    const [localRef, localSha] = line.split(' ');
    if (!localSha || ZERO_SHA.test(localSha) || localRef.startsWith('refs/tags/')) continue;
    const r = checkCommit(root, localSha, remote);
    if (!r.ok) denials.push(`${localRef}: ${r.reason}`);
  }
  if (denials.length) {
    process.stderr.write(`\npr-self-review: push refused.\n${denials.map((d) => `  ✗ ${d}`).join('\n')}\n\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- Claude Code

/** Push / PR-creation commands in a (possibly compound) shell command. */
export function classify(command) {
  const parts = command.split(/&&|\|\||;|\n/).map((p) => p.trim());
  const found = [];
  let cd = null;
  for (const p of parts) {
    const cdm = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*$/.exec(p);
    if (cdm) {
      cd = cdm[1].replace(/^["']|["']$/g, '');
      continue;
    }
    const gitm = /^(?:\w+=\S+\s+)*git((?:\s+(?:-C\s+\S+|-c\s+\S+|--[\w-]+(?:=\S+)?))*)\s+push\b(.*)$/.exec(p);
    if (gitm) {
      const opts = gitm[1];
      const rest = gitm[2];
      const dir = /-C\s+(\S+)/.exec(opts)?.[1] ?? null;
      found.push({
        kind: 'push',
        dir: dir ?? cd,
        noVerify: /(^|\s)--no-verify\b/.test(rest),
        hooksPath: /core\.hookspath/i.test(opts),
        contentless: /(^|\s)(--delete|-d|--tags)\b/.test(rest) || /\s:\S+/.test(rest),
      });
    }
    if (/^(?:\w+=\S+\s+)*gh\s+pr\s+create\b/.test(p)) found.push({ kind: 'pr', dir: cd });
    if (/\bgit\b.*-c\s*core\.hookspath/i.test(p) && !gitm) found.push({ kind: 'hooks-path', dir: cd });
  }
  return found;
}

function claude() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  if (input?.tool_name !== 'Bash') return;
  const command = String(input.tool_input?.command ?? '');
  const actions = classify(command);
  if (!actions.length) return;
  const cwd = input.cwd || process.cwd();
  const deny = (reason) => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `pr-self-review gate: ${reason}`,
        },
      }),
    );
    process.exit(0);
  };
  for (const a of actions) {
    if (a.noVerify || a.hooksPath || a.kind === 'hooks-path') {
      deny('pushing past the pre-push gate (--no-verify / -c core.hooksPath) is not allowed from Claude. Ask the user to run /pr-self-review instead; only the user may bypass the gate, by hand.');
    }
    if (a.contentless) continue;
    const dir = a.dir ? (isAbsolute(a.dir) ? a.dir : resolve(cwd, a.dir)) : cwd;
    const root = gitTry(['rev-parse', '--show-toplevel'], { cwd: dir });
    if (!root) continue;
    const head = revParse(root, 'HEAD');
    if (!head) continue;
    const r = checkCommit(root, head, 'origin');
    if (!r.ok) deny(`${a.kind === 'pr' ? 'opening a PR' : 'pushing'} is blocked — ${r.reason}`);
  }
}

if (isMain(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--git-pre-push') {
    prePush(git(['rev-parse', '--show-toplevel']), rest[0] ?? 'origin');
  } else if (mode === '--claude') {
    claude();
  } else if (mode === '--check') {
    const root = git(['rev-parse', '--show-toplevel']);
    const sha = revParse(root, rest[0] ?? 'HEAD');
    const r = checkCommit(root, sha, 'origin');
    console.log(`${r.ok ? 'PASS' : 'REFUSED'} — ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  } else {
    process.stderr.write('usage: gate.mjs --git-pre-push <remote> <url> | --claude | --check [<commit>]\n');
    process.exit(2);
  }
}
