import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

const JOURNAL = join(dirname(fileURLToPath(import.meta.url)), 'migrations', 'meta', '_journal.json');

/** How many migrations this build ships (drizzle-kit's journal). */
export async function shippedMigrations(): Promise<number> {
  const journal = JSON.parse(await readFile(JOURNAL, 'utf8')) as { entries: unknown[] };
  return journal.entries.length;
}

/** How many migrations the database has applied (0 before the first `db:migrate`). */
export async function appliedMigrations(db: Db): Promise<number> {
  const [table] = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  );
  if (!table?.exists) return 0;
  const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return row?.n ?? 0;
}
