import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import {
  validatorCompiler,
  serializerCompiler,
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { loadConfig, type AppConfig } from './platform/config.js';
import { createDb, type Db } from './db/client.js';
import { appliedMigrations, shippedMigrations } from './db/migration-status.js';
import { Container, type ContainerOverrides } from './platform/container.js';
import { AppError } from './platform/errors.js';
import { modules } from './modules/index.js';

/** Host names that mean "this machine" — the only ones accepted while listening on loopback. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** API error codes for the 4xx errors Fastify and its plugins raise themselves. */
const CLIENT_ERROR_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  406: 'not_acceptable',
  408: 'request_timeout',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a shutdown waits for running reviews and jobs to record how they ended. */
export const SHUTDOWN_GRACE_MS = 10_000;

// Attach the DI container to every request/instance.
declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}

export interface BuildAppOptions {
  config?: AppConfig;
  db?: Db;
  overrides?: ContainerOverrides;
}

/**
 * buildApp() — exported so tests can use `app.inject()` without a real port.
 * Wires the zod type provider (request validation + response serialization),
 * the security/transport plugins (helmet, cors, rate-limit, SSE) ahead of the
 * DI container and the statically-registered feature modules, plus a structured
 * error handler returning the ApiErrorBody envelope.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const handle = opts.db ? null : createDb(config.databaseUrl);
  const db = opts.db ?? handle!.db;

  const app = Fastify({
    // Explicit 1MB cap on request bodies (PR comments, settings payloads are
    // small). Protects against oversized/abusive payloads.
    bodyLimit: 1_048_576,
    // A client gets this long to send its whole request (headers + body) — a
    // slow-loris guard. It doesn't limit the response, so SSE streams stay open.
    requestTimeout: 30_000,
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            // Credentials never reach the log: request auth headers, and the
            // request headers SDK errors carry (Octokit, OpenAI).
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'err.request.headers.authorization',
                'err.headers.authorization',
                'err.config.headers.Authorization',
              ],
              censor: '[redacted]',
            },
            ...(config.nodeEnv === 'development'
              ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
              : {}),
          },
  });

  // Use zod schemas directly for request validation + response serialization.
  // Routes opt in per-module via `app.withTypeProvider<ZodTypeProvider>()`.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = new Container(config, db, opts.overrides, app.log);
  app.decorate('container', container);

  // Reap runs left 'running' by a previous (now-dead) process — otherwise they
  // show as perpetually "running" in the UI and can't be cancelled (no runner).
  //
  // AWAITED before the server accepts requests: a fresh process has no in-flight
  // runs of its own yet (runs only start via POST /review once listening), so
  // every 'running' row here is genuinely orphaned. Awaiting also closes the
  // race where a brand-new run could be created (and wrongly reaped) in the gap
  // between listening and an async reaper finishing.
  // NOTE: assumes a SINGLE API instance per DB. With multiple replicas this
  // would need per-instance scoping / heartbeats (not this app's deployment).
  try {
    const reaped = await container.reviewRepo.reapStaleRunningRuns();
    if (reaped > 0) app.log.info({ reaped }, 'reaped stale running agent_runs on boot');
    // Same for background jobs: their queue lived in the dead process's memory.
    const reapedJobs = await container.jobs.reapStale();
    if (reapedJobs > 0) app.log.info({ reaped: reapedJobs }, 'reaped stale queued/running jobs on boot');
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'stale-run reaping failed (non-fatal)');
  }

  // Trace retention (TRACE_RETENTION_DAYS, 90 days by default, 0 = off): prune at boot, then daily.
  const retentionDays = config.traceRetentionDays;
  if (retentionDays) {
    const prune = async () => {
      try {
        const pruned = await container.reviewRepo.pruneRunTraces(new Date(Date.now() - retentionDays * DAY_MS));
        if (pruned > 0) app.log.info({ pruned, retentionDays }, 'pruned old run traces');
      } catch (err) {
        app.log.warn({ err: (err as Error).message }, 'run-trace pruning failed (non-fatal)');
      }
    };
    await prune();
    const timer = setInterval(() => void prune(), DAY_MS);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  // Graceful shutdown, before the server stops taking connections: end every
  // open run stream (or close() waits on them forever), stop reviews and jobs,
  // and give them a moment to record how they ended — the DB closes in onClose.
  app.addHook('preClose', async () => {
    container.runBus.shutdown();
    await Promise.all([container.runBus.whenIdle(SHUTDOWN_GRACE_MS), container.jobs.close(SHUTDOWN_GRACE_MS)]);
  });

  // Security headers (X-Content-Type-Options, X-Frame-Options, …). The API
  // serves JSON only, so the default CSP is fine.
  await app.register(helmet);
  await app.register(cors, { origin: [config.webOrigin], credentials: true });
  await app.register(FastifySSEPlugin);

  // DNS-rebinding guard. CORS doesn't stop a page whose domain re-resolves to
  // 127.0.0.1 from driving this unauthenticated API, but its requests carry
  // that domain in Host. While we listen on loopback only, only loopback names
  // are legitimate; an explicit API_HOST=0.0.0.0 opts out.
  if (LOOPBACK_HOSTS.has(config.apiHost)) {
    app.addHook('onRequest', async (req) => {
      if (!LOOPBACK_HOSTS.has(req.hostname)) {
        throw new AppError('forbidden_host', `Host '${req.hostname}' is not allowed`, 403);
      }
    });
  }

  // Global rate limit. Disabled under test so integration suites can hammer
  // endpoints via inject(); per-route overrides live on the routes themselves
  // (the UI's polling reads opt out). A hit is a 429 `rate_limited` envelope.
  if (config.nodeEnv !== 'test') {
    await app.register(rateLimit, {
      max: 120,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        message: `Too many requests — retry in ${ctx.after}`,
      }),
    });
  }

  // Liveness check (no module, no DB, no rate limit).
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  // Readiness check — the DB is reachable and has every migration this build
  // ships (migrations don't run on boot; a missing one surfaces as `relation …
  // does not exist` on some later request). 503 (not 500) so orchestrators
  // treat it as "not ready yet", not a crash.
  const shipped = shippedMigrations();
  shipped.catch(() => undefined);
  app.get('/health/ready', { config: { rateLimit: false } }, async (req, reply) => {
    try {
      await db.execute(sql`select 1`);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'readiness check failed: db unreachable');
      return reply.status(503).send({ ready: false, reason: 'db_unreachable' });
    }
    const pending = (await shipped) - (await appliedMigrations(db));
    if (pending > 0) {
      req.log.warn({ pending }, 'readiness check failed: migrations pending (pnpm db:migrate)');
      return reply.status(503).send({ ready: false, reason: 'migrations_pending', pending });
    }
    return { ready: true };
  });

  // Structured error handler. Registered BEFORE modules so encapsulated
  // module plugins inherit it. Request validation → 422; AppError → its status;
  // Fastify's own 4xx (bad JSON, 413, 415, 429…) → their status with a stable
  // code; anything else → a generic 500 whose details only go to the log (a
  // raw message can carry SQL, constraint names or file paths).
  app.setErrorHandler((err: unknown, req, reply) => {
    // Request validation failure from the zod type provider (schema.body/params).
    if (hasZodFastifySchemaValidationErrors(err)) {
      reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: err.validation,
        },
      });
      return;
    }
    // Response failed its own serialization schema — never leak the raw object;
    // log it and return a generic 500.
    if (isResponseSerializationError(err)) {
      req.log.error({ err }, 'response serialization failed');
      reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
      return;
    }
    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err }, err.message);
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    // Requests are validated by their route schemas (above), so a ZodError here
    // is our own data failing a parse — stored JSON, a provider's answer — which
    // is a server fault, not the client's. `instanceof` can fail across
    // duplicate zod instances (shared vs api), so also match by shape.
    const maybeZod = err as { name?: string; issues?: unknown };
    const isZodError = err instanceof z.ZodError || (maybeZod?.name === 'ZodError' && Array.isArray(maybeZod.issues));
    const e = err as { statusCode?: number; message?: string };
    if (!isZodError && typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      reply.status(e.statusCode).send({
        error: { code: CLIENT_ERROR_CODES[e.statusCode] ?? 'client_error', message: e.message ?? 'Bad request' },
      });
      return;
    }
    req.log.error({ err }, 'unhandled error');
    reply.status(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  // Unknown routes answer with the same envelope as every other error.
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` } });
  });

  // Register feature modules from the static registry (src/modules/index.ts).
  // Each module is a Fastify plugin in modules/<name>/routes.ts.
  for (const plugin of Object.values(modules)) {
    await app.register(plugin);
  }

  // Close the db handle we created on shutdown.
  if (handle) app.addHook('onClose', async () => handle.close());

  return app;
}
