import 'dotenv/config';
import { z } from 'zod';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

/**
 * Central, zod-validated environment config. Loaded once at startup.
 *
 * NOTE: secret keys (OPENAI/ANTHROPIC/OPENROUTER/GITHUB_TOKEN) are deliberately
 * NOT in this schema. Feature code must access secrets through SecretsProvider,
 * never via process.env or AppConfig — the SecretsProvider is the one chokepoint
 * that reads process.env directly (see adapters/secrets/local.ts). Listing them
 * here would be dead config that never reaches AppConfig.
 */
const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgres://devdigest:devdigest@localhost:5432/devdigest'),
  // Memory/RAG embeddings run on OpenAI (text-embedding-3-small, 1536-dim — the
  // pgvector columns are locked to that). Default OFF so the app makes ZERO
  // OpenAI requests; set EMBEDDINGS_ENABLED=true to turn memory retrieval on.
  EMBEDDINGS_ENABLED: z.string().optional(),
  // repo-intel facade (Tier 1). Default ON — reviews get repo skeleton +
  // callers context. Set REPO_INTEL_ENABLED=false to opt out, in which case
  // every consumer degrades to ripgrep-identical behavior (acceptance #10).
  // Note: even when on, sections only populate once the repo is indexed; an
  // unindexed repo degrades gracefully. Per-agent override: agents.repo_intel.
  REPO_INTEL_ENABLED: z.string().optional(),
  // Hermetic e2e only: every LLM call is answered by a deterministic fake
  // (adapters/llm/fake.ts) — no key, no network. Refused under production.
  DEVDIGEST_FAKE_LLM: z.enum(['0', '1']).optional(),
  API_PORT: z.coerce.number().int().default(3001),
  // The API has no authentication (LocalNoAuthProvider), so it listens on
  // loopback only unless you opt in, e.g. API_HOST=0.0.0.0 for a trusted LAN.
  // `localhost` makes Fastify listen on both 127.0.0.1 and ::1.
  API_HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('localhost')),
  WEB_PORT: z.coerce.number().int().default(3000),
  DEVDIGEST_CLONE_DIR: z.string().optional(),
  // Where BYO keys from the Settings UI are stored. Tests point it at a
  // throwaway file so they never read or write the developer's real keys.
  DEVDIGEST_SECRETS_PATH: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // `.env` (and .env.example) ship `LOG_LEVEL=` empty; an empty string is not a
  // valid enum member, so coerce '' → undefined to fall through to the default.
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
  // A review run prepares the PR's intent first (derives it when the PR has none). Default ON;
  // set DEVDIGEST_INTENT_ON_REVIEW=false to review without it (vitest does, to keep the tests' LLM calls countable).
  DEVDIGEST_INTENT_ON_REVIEW: z.string().optional(),
  // How many review requests run at once; the rest wait their turn (each one's
  // agents already run one after another).
  REVIEW_CONCURRENCY: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(20).default(2)),
  // Delete run traces older than this many days (at boot, then daily); 0 keeps them all.
  TRACE_RETENTION_DAYS: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).default(90)),
});

export type AppConfig = {
  databaseUrl: string;
  apiPort: number;
  /** Interface the API listens on — loopback by default (the API has no auth). */
  apiHost: string;
  webPort: number;
  /** Absolute path where repos are cloned (~/.devdigest/workspace by default). */
  cloneDir: string;
  /** Absolute path to the writable secrets store (BYO keys from the UI). */
  secretsPath: string;
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
  /** Allowed CORS origin for the Next.js dev server. */
  webOrigin: string;
  /** Whether memory/RAG embeddings (OpenAI) are enabled. Default false. */
  embeddingsEnabled: boolean;
  /**
   * Whether the repo-intel facade (Tier 1: phantom-gate, callers-in-prompt) is
   * active. Default ON — set REPO_INTEL_ENABLED=false to opt out, in which case
   * every facade method returns its degraded result (`[]`) so consumers behave
   * EXACTLY like the ripgrep-only baseline.
   */
  repoIntelEnabled: boolean;
  /** DEVDIGEST_FAKE_LLM=1: reviews run against a deterministic fake LLM (hermetic e2e). */
  fakeLlm: boolean;
  /** DEVDIGEST_INTENT_ON_REVIEW (default true): a review run derives the PR's intent first when it has none. */
  intentOnReview: boolean;
  /** REVIEW_CONCURRENCY: review requests that run at once (default 2); the rest queue. */
  reviewConcurrency: number;
  /** TRACE_RETENTION_DAYS (default 90): prune older run traces; null (set to 0) keeps every trace. */
  traceRetentionDays: number | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  if (parsed.DEVDIGEST_FAKE_LLM === '1' && parsed.NODE_ENV === 'production') {
    throw new Error('DEVDIGEST_FAKE_LLM=1 is for tests only — refusing to start with NODE_ENV=production');
  }
  const cloneDirRaw =
    parsed.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  const cloneDir = isAbsolute(cloneDirRaw) ? cloneDirRaw : resolve(process.cwd(), cloneDirRaw);
  return {
    databaseUrl: parsed.DATABASE_URL,
    apiPort: parsed.API_PORT,
    apiHost: parsed.API_HOST,
    webPort: parsed.WEB_PORT,
    cloneDir,
    secretsPath: parsed.DEVDIGEST_SECRETS_PATH
      ? resolve(process.cwd(), parsed.DEVDIGEST_SECRETS_PATH)
      : join(homedir(), '.devdigest', 'secrets.json'),
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL ?? (parsed.NODE_ENV === 'test' ? 'silent' : 'info'),
    webOrigin: `http://localhost:${parsed.WEB_PORT}`,
    embeddingsEnabled: parsed.EMBEDDINGS_ENABLED === 'true',
    repoIntelEnabled: parsed.REPO_INTEL_ENABLED !== 'false',
    fakeLlm: parsed.DEVDIGEST_FAKE_LLM === '1',
    intentOnReview: parsed.DEVDIGEST_INTENT_ON_REVIEW !== 'false',
    reviewConcurrency: parsed.REVIEW_CONCURRENCY,
    traceRetentionDays: parsed.TRACE_RETENTION_DAYS === 0 ? null : parsed.TRACE_RETENTION_DAYS,
  };
}
