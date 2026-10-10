import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@devdigest/shared': path.resolve(__dirname, 'src/vendor/shared'),
      '@devdigest/reviewer-core': path.resolve(__dirname, '../reviewer-core/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // No `include` here: the projects in vitest.workspace.ts set it, and
    // `extends` concatenates arrays — a base include would add to both projects.
    // Hermetic whatever server/.env says (dotenv never overrides a variable
    // that is already set): no real provider key, not the developer's stored
    // keys, and not the dev database — an app built without an explicit `db`
    // gets an unreachable one, so its boot reaper can't fail live dev runs.
    env: {
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
      GITHUB_TOKEN: '',
      GITHUB_PAT: '',
      // The reviews tests count LLM calls: the intent pre-work (its own model call) is switched on per test.
      DEVDIGEST_INTENT_ON_REVIEW: 'false',
      DEVDIGEST_SECRETS_PATH: path.join(mkdtempSync(path.join(tmpdir(), 'devdigest-test-')), 'secrets.json'),
      DATABASE_URL: 'postgres://devdigest:devdigest@127.0.0.1:1/unreachable',
    },
    // Report only (no thresholds): `pnpm coverage`.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/vendor/**', 'src/db/migrations/**', 'src/**/*.test.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
