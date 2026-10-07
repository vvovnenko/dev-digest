#!/usr/bin/env node
// Installs the pre-push gate for this clone (all its worktrees).
//
//   node install-hooks.mjs             install or update
//   node install-hooks.mjs --status    is it installed, and is the copy current?
//   node install-hooks.mjs --uninstall
//
// The hook goes to <git-common-dir>/hooks/pre-push, not to `core.hooksPath`: a
// relative hooksPath resolves inside each worktree (branches that predate the
// skill would skip it silently) and turns `.git/hooks` off. The gate's scripts
// are copied to <git-common-dir>/pr-self-review/bin/, so pushing a branch that
// doesn't have the skill is still gated. Rerun after updating the skill.
// The shim fails closed: no `node` on PATH (GUI git clients) → push refused.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_DIR, TOOL_VERSION, commonDir, gitTry, isMain, parseArgs, repoRoot, sha256, storeDir } from './lib.mjs';

const MARKER = '# pr-self-review pre-push gate';

const SHIM = `#!/bin/sh
${MARKER} — installed by .claude/skills/pr-self-review/scripts/install-hooks.mjs
# Refuses a push whose commits have no PASS self-review verdict.
# The user can bypass it by hand with \`git push --no-verify\`; Claude may not.
GATE="$(git rev-parse --git-common-dir)/pr-self-review/bin/scripts/gate.mjs"
if ! command -v node >/dev/null 2>&1; then
  echo "pr-self-review: node is not on PATH, so the push gate can't run — push refused." >&2
  echo "  Make node visible to your git client, or push with --no-verify knowingly." >&2
  exit 1
fi
if [ ! -f "$GATE" ]; then
  echo "pr-self-review: gate missing at $GATE — push refused." >&2
  echo "  Reinstall: node .claude/skills/pr-self-review/scripts/install-hooks.mjs" >&2
  exit 1
fi
exec node "$GATE" --git-pre-push "$@"
`;

function sourceFiles() {
  const scripts = readdirSync(join(SKILL_DIR, 'scripts')).filter((f) => f.endsWith('.mjs'));
  return [...scripts.map((f) => [join(SKILL_DIR, 'scripts', f), join('scripts', f)]), [join(SKILL_DIR, 'routing.json'), 'routing.json']];
}

function fingerprint(files) {
  return sha256(files.map(([src]) => readFileSync(src, 'utf8')).join('\0')).slice(0, 12);
}

export function status(root) {
  const hook = join(commonDir(root), 'hooks', 'pre-push');
  const bin = join(storeDir(root), 'bin');
  const hooksPath = gitTry(['config', '--get', 'core.hooksPath'], { cwd: root });
  const installed = existsSync(hook) && readFileSync(hook, 'utf8').includes(MARKER);
  const stamp = existsSync(join(bin, 'VERSION')) ? readFileSync(join(bin, 'VERSION'), 'utf8').trim() : null;
  const current = `${TOOL_VERSION} ${fingerprint(sourceFiles())}`;
  return { hook, bin, hooksPath, installed, stamp, current, upToDate: installed && stamp === current, foreignHook: existsSync(hook) && !installed };
}

function install(root, { force }) {
  const s = status(root);
  if (s.hooksPath && !force) {
    console.error(`core.hooksPath is set (${s.hooksPath}), so git ignores ${s.hook}. Unset it or rerun with --force to install anyway.`);
    process.exit(1);
  }
  if (s.foreignHook) {
    if (!force) {
      console.error(`${s.hook} exists and is not ours. Rerun with --force to back it up and replace it.`);
      process.exit(1);
    }
    copyFileSync(s.hook, `${s.hook}.backup-${Date.now()}`);
  }
  rmSync(s.bin, { recursive: true, force: true });
  const files = sourceFiles();
  for (const [src, rel] of files) {
    mkdirSync(join(s.bin, rel, '..'), { recursive: true });
    copyFileSync(src, join(s.bin, rel));
  }
  writeFileSync(join(s.bin, 'VERSION'), `${s.current}\n`);
  mkdirSync(join(s.hook, '..'), { recursive: true });
  writeFileSync(s.hook, SHIM);
  chmodSync(s.hook, 0o755);
  console.log(`installed the pre-push gate (${s.current}) → ${s.hook}`);
}

function uninstall(root) {
  const s = status(root);
  if (s.installed) rmSync(s.hook);
  rmSync(s.bin, { recursive: true, force: true });
  console.log(s.installed ? `removed ${s.hook}` : 'the gate was not installed');
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['status', 'uninstall', 'force'] });
  const root = repoRoot();
  if (args.status) {
    const s = status(root);
    if (!s.installed) console.log(`not installed${s.foreignHook ? ' (another pre-push hook is there)' : ''} — run: node .claude/skills/pr-self-review/scripts/install-hooks.mjs`);
    else console.log(s.upToDate ? `installed, current (${s.current})` : `installed but outdated (${s.stamp} ≠ ${s.current}) — rerun install-hooks.mjs`);
    if (s.hooksPath) console.log(`warning: core.hooksPath=${s.hooksPath} — git runs hooks from there, not ${s.hook}`);
    process.exit(s.upToDate ? 0 : 1);
  }
  if (args.uninstall) uninstall(root);
  else install(root, { force: Boolean(args.force) });
}
