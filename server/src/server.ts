import { buildApp, SHUTDOWN_GRACE_MS } from './app.js';
import { loadConfig } from './platform/config.js';

/** Production/dev entrypoint. `pnpm dev` runs `tsx watch src/server.ts`. */
async function main() {
  const config = loadConfig();
  const app = await buildApp({ config });

  // Backstop: a promise nobody awaited must not take the API — and every
  // in-flight review — down with it (Node's default). Log it and keep serving.
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled promise rejection');
  });

  // Graceful shutdown: on SIGTERM/SIGINT close the server, which runs the
  // onClose hooks (drains in-flight requests/SSE, closes the postgres pool).
  // Guarded so a second signal during shutdown doesn't double-close.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown(signal));
  }
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received — shutting down`);
    // close() waits for open connections; a stuck one must not keep the
    // process alive forever. Past the grace period, give up on it.
    setTimeout(() => {
      app.log.error('shutdown is taking too long — exiting');
      process.exit(1);
    }, 2 * SHUTDOWN_GRACE_MS).unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'error during shutdown');
      process.exit(1);
    }
  }

  try {
    await app.listen({ port: config.apiPort, host: config.apiHost });
    app.log.info(`DevDigest API listening on http://${config.apiHost}:${config.apiPort}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
