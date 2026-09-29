/**
 * Routes call services; they don't query the DB or drive adapters through the
 * container themselves (onion-architecture skill, SA-12). `pnpm arch` can't see
 * this — `app.container.db` is a property, not an import — so this counts it:
 * `container.db` anywhere, and a method called on a container member
 * (`container.jobs.enqueue(`, `container.repoIntel.getIndexState(`). Wiring a
 * service (`jobs: container.jobs`, `github: () => container.github()`) is fine.
 *
 * The counts may only go down: lower one here when you remove a use.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODULES = join(import.meta.dirname, '../src/modules');

/** Known uses, per routes file. repo-intel is do-not-touch (server/CLAUDE.md). */
const ALLOWED: Record<string, number> = {
  'repo-intel/routes.ts': 2,
};

const DIRECT_USE = /\bcontainer\.db\b|\bcontainer\.\w+\.\w+\(/g;

function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const mod of readdirSync(MODULES)) {
    const file = join(MODULES, mod, 'routes.ts');
    if (!existsSync(file)) continue;
    const n = readFileSync(file, 'utf8').match(DIRECT_USE)?.length ?? 0;
    if (n > 0) out[`${mod}/routes.ts`] = n;
  }
  return out;
}

describe('routes use services, not container internals', () => {
  it('no routes file gains a direct DB or adapter call, and fixed ones are ratcheted down', () => {
    expect(counts()).toEqual(ALLOWED);
  });
});
