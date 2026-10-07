/**
 * Generated migrations must not destroy data by accident. drizzle-kit turns a
 * renamed or retyped column into DROP + ADD without asking twice — that is how
 * 0009 dropped `agent_runs.cost_usd` and 0010 re-added it empty. A migration
 * that really means to drop a table or a column goes on the allowlist below,
 * together with how its data is carried over (or why it can go).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '../src/db/migrations');

/** file → why dropping data there is fine. */
const ALLOWED: Record<string, string> = {
  '0009_complex_runaways.sql': 'historical: dropped agent_runs.cost_usd before this check existed',
};

const DESTRUCTIVE = /\bDROP\s+(TABLE|COLUMN|SCHEMA)\b|\bTRUNCATE\b/i;

/** SQL without `--` line comments and block comments, so prose can't trip the check. */
const code = (sql: string) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

describe('migrations', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

  it('are found', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never drop a table or a column unless allowlisted', () => {
    const offenders = files
      .filter((f) => !(f in ALLOWED))
      .flatMap((f) =>
        code(readFileSync(join(MIGRATIONS, f), 'utf8'))
          .split('\n')
          .filter((line) => DESTRUCTIVE.test(line))
          .map((line) => `${f}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    expect(Object.keys(ALLOWED).filter((f) => !files.includes(f))).toEqual([]);
  });
});
