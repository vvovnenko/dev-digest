import type { GlobalSetupContext } from 'vitest/node';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate.js';
import { dbUrl, dockerAvailable, PG_IMAGE, TEMPLATE_DB } from './pg-shared.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin URL of the Postgres the integration project shares; unset without Docker. */
    pgAdminUrl: string;
  }
}

/**
 * One Postgres for the whole `integration` project (vitest.workspace.ts): start
 * the container once and migrate a template database once. Each test file then
 * copies that template into its own database (`startPg`), so files stay isolated
 * without paying a container start and a migration run each.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  // Locally, no Docker → nothing to share and every suite skips itself; in CI it throws.
  if (!(await dockerAvailable())) return undefined;

  const container = await new PostgreSqlContainer(PG_IMAGE)
    .withDatabase('devdigest')
    .withUsername('devdigest')
    .withPassword('devdigest')
    .start();
  const adminUrl = container.getConnectionUri();
  const admin = postgres(adminUrl, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }
  // The migration run closes its connection, so the template has no sessions when copied.
  await runMigrations(dbUrl(adminUrl, TEMPLATE_DB));

  provide('pgAdminUrl', adminUrl);
  return async () => {
    await container.stop();
  };
}
