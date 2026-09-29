import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { createDb, type DbHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { dbUrl, PG_IMAGE, TEMPLATE_DB } from './pg-shared.js';

export { dockerAvailable } from './pg-shared.js';

/**
 * Testcontainers helper: a migrated Postgres + pgvector database and a Drizzle
 * client, on the same `pgvector/pgvector:pg16` image as docker-compose so the
 * `vector` extension is available.
 *
 * In the `integration` project the container is shared: `pg-global-setup.ts`
 * starts it once and migrates a template, and `startPg` gives each test file its
 * own copy of that template, dropped again by `stop()`.
 *
 * Integration tests gate on `dockerAvailable()` and skip cleanly when Docker is
 * not reachable (a local machine without a Docker daemon).
 */
export interface PgFixture {
  handle: DbHandle;
  url: string;
  stop: () => Promise<void>;
}

async function asAdmin(adminUrl: string, statement: string): Promise<void> {
  const admin = postgres(adminUrl, { max: 1 });
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end();
  }
}

export async function startPg(): Promise<PgFixture> {
  const adminUrl = inject('pgAdminUrl');
  if (!adminUrl) return startOwnPg();

  const database = `it_${randomUUID().replace(/-/g, '')}`;
  await asAdmin(adminUrl, `CREATE DATABASE ${database} TEMPLATE ${TEMPLATE_DB}`);
  const url = dbUrl(adminUrl, database);
  const handle = createDb(url, { max: 5 });
  return {
    handle,
    url,
    stop: async () => {
      await handle.close();
      await asAdmin(adminUrl, `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    },
  };
}

/** Outside the integration project (no shared server): a container of its own. */
async function startOwnPg(): Promise<PgFixture> {
  const container = await new PostgreSqlContainer(PG_IMAGE)
    .withDatabase('devdigest')
    .withUsername('devdigest')
    .withPassword('devdigest')
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  const handle = createDb(url, { max: 5 });
  return {
    handle,
    url,
    stop: async () => {
      await handle.close();
      await container.stop();
    },
  };
}
