/**
 * What the integration global setup (main process) and `startPg` (workers) share.
 * No `vitest` import here: the global setup runs outside a test worker, where
 * importing `inject` fails with "Vitest failed to access its internal state".
 */

export const PG_IMAGE = 'pgvector/pgvector:pg16';
/** The database the global setup migrates once; every test file copies it. */
export const TEMPLATE_DB = 'devdigest_template';

/** `url` pointed at another database on the same server. */
export function dbUrl(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

let dockerCache: boolean | undefined;

/** Cheap check: can we reach a Docker daemon? */
export async function dockerAvailable(): Promise<boolean> {
  if (dockerCache !== undefined) return dockerCache;
  try {
    const { execSync } = await import('node:child_process');
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    dockerCache = true;
  } catch {
    dockerCache = false;
  }
  // Locally a missing Docker skips the DB suites; in CI it must fail them — a
  // green integration job that ran nothing looks exactly like a passing one.
  if (!dockerCache && process.env.CI) {
    throw new Error('Docker is required for the *.it.test.ts suites in CI (docker info failed)');
  }
  return dockerCache;
}
