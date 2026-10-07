import { defineWorkspace } from 'vitest/config';

/**
 * Two projects over one config (vitest.config.ts: aliases, hermetic env,
 * coverage): `unit` — hermetic, default timeouts, so a hanging unit test fails
 * fast; `integration` — the Testcontainers `*.it.test.ts` files, sharing one
 * Postgres started by the global setup, with time to pull and start it. `pnpm test` runs both; CI runs them as separate jobs.
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
      exclude: ['**/*.it.test.ts', '**/node_modules/**'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['test/**/*.it.test.ts'],
      // One Postgres for every file; each file copies a migrated template database.
      globalSetup: ['./test/helpers/pg-global-setup.ts'],
      testTimeout: 120_000,
      hookTimeout: 120_000,
    },
  },
]);
