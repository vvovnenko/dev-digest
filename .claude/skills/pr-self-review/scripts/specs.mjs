// Feature specs (`<pkg>/specs/NN-*.md`) a diff relates to, and their
// "Unchanged" zones. Used by select-skills (the spec reviewer) and checks (D8).

import { git, showFile } from './lib.mjs';

const SPEC_PATH = /^(client|server|reviewer-core)\/specs\/(\d{2}-[a-z0-9-]+)\.md$/;

/** Names too common to tie a spec to a file. */
const GENERIC = new Set([
  'index', 'styles', 'helpers', 'constants', 'types', 'page', 'layout', 'routes', 'service',
  'repository', 'domain', 'ports', 'schema', 'config', 'utils', 'api', 'test', 'readme', 'claude',
]);

export function listSpecs(root, tree) {
  const out = git(['ls-tree', '-r', '--name-only', tree, '--', 'client/specs', 'server/specs', 'reviewer-core/specs'], {
    cwd: root,
  });
  return out
    .split('\n')
    .filter((p) => SPEC_PATH.test(p))
    .map((path) => ({ path, slug: SPEC_PATH.exec(path)[2], pkg: SPEC_PATH.exec(path)[1], text: showFile(root, tree, path) ?? '' }));
}

/** Words a spec would use to name a changed file. */
export function fileTokens(path) {
  const parts = path.split('/');
  const tokens = new Set([path, parts.slice(1).join('/')]);
  const file = parts[parts.length - 1];
  const stem = file.replace(/\.[^.]+$/, '').replace(/\.test$/, '');
  if (!GENERIC.has(stem.toLowerCase()) && stem.length > 3) tokens.add(file);
  for (const dir of parts.slice(0, -1)) if (/^[A-Z][A-Za-z0-9]{3,}$/.test(dir)) tokens.add(dir);
  if (/^[A-Z][A-Za-z0-9]{3,}$/.test(stem)) tokens.add(stem);
  return [...tokens].filter((t) => t.length > 3);
}

function mentions(text, token) {
  const at = text.indexOf(token);
  if (at === -1) return false;
  const before = text[at - 1] ?? ' ';
  const after = text[at + token.length] ?? ' ';
  return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
}

/**
 * Specs linked to the diff, each with why and which changed files it names.
 * Linked when the spec itself changed, its slug is in the branch name or a
 * commit message, or it names a changed file.
 */
export function linkSpecs(root, diff) {
  const specs = listSpecs(root, diff.tree);
  const changed = diff.files.filter((f) => !f.excluded && !f.generated && f.status !== 'D');
  const messages = [diff.branch ?? '', ...diff.commits.map((c) => `${c.subject}\n${c.body}`)].join('\n');
  const linked = [];
  for (const spec of specs) {
    const reasons = [];
    if (diff.files.some((f) => f.path === spec.path)) reasons.push('the spec changed');
    if (messages.includes(spec.slug)) reasons.push(`"${spec.slug}" is in the branch name or a commit`);
    const named = changed.filter((f) => f.path !== spec.path && fileTokens(f.path).some((t) => mentions(spec.text, t)));
    if (named.length) reasons.push(`names ${named.length} changed file(s)`);
    // Active: this diff works on the spec (edits it or names it in a commit or the
    // branch). Only an active spec's "Unchanged" zone binds; a finished spec that
    // merely names a file a later refactor touches does not.
    const active = reasons.length > (named.length ? 1 : 0);
    if (reasons.length) linked.push({ ...spec, reasons, active, files: named.map((f) => f.path) });
  }
  return linked;
}

/**
 * Backticked names listed under a spec's "Unchanged" heading or bold line, up
 * to the next blank line that is followed by something other than a list item.
 * Amendments may take items off this list; the verifier reads them.
 */
export function unchangedZone(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s*(\*\*|#+\s*)Unchanged\b/i.test(l));
  if (start === -1) return { line: null, items: [] };
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      if (items.length && !/^\s*[-*]\s/.test(lines[i + 1] ?? '')) break;
      continue;
    }
    if (/^#|^\*\*/.test(l.trim())) break;
    for (const m of l.matchAll(/`([^`]+)`/g)) items.push(m[1]);
  }
  return { line: start + 1, items };
}

/** Does a changed path fall in one "Unchanged" item (a path, a glob-ish dir, or a component name)? */
export function inZone(path, item) {
  const clean = item.replace(/\/\*\*$/, '').replace(/\*+$/, '');
  if (clean.includes('/') || clean.includes('.')) {
    return path === clean || path.endsWith(`/${clean}`) || path.includes(`/${clean}/`) || path.startsWith(`${clean}/`);
  }
  return path.split('/').some((seg) => seg === clean || seg.replace(/\.[^.]+$/, '') === clean);
}
