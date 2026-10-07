import { readFile, writeFile, mkdir, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { SecretsProvider, SecretKey } from '@devdigest/shared';
import { ConfigError } from '../../platform/errors.js';

/** The secrets file: key → value, nothing else. */
const SecretsFile = z.record(z.string(), z.string());

/**
 * LocalSecretsProvider — writable MVP secrets backend.
 *
 * Reads stored overrides from a JSON file on disk (BYO keys entered via the
 * UI), falling back to process.env when a key has not been set. Writes persist
 * to the same file (mode 0600) so keys survive restarts. GITHUB_TOKEN is the
 * canonical key; GITHUB_PAT is still read as a fallback for back-compat.
 *
 * Stored values take precedence over env so a key entered in the UI wins.
 * Swap for a VaultSecretsProvider later without touching call sites.
 */
export class LocalSecretsProvider implements SecretsProvider {
  private cache: Record<string, string> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.cache = {}; // no stored overrides yet
      return this.cache;
    }
    // A broken file must fail loudly: treating it as empty would silently drop every stored key.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ConfigError(`Secrets file ${this.filePath} is not valid JSON — fix or remove it`);
    }
    const result = SecretsFile.safeParse(parsed);
    if (!result.success) {
      throw new ConfigError(`Secrets file ${this.filePath} must map key names to string values`);
    }
    this.cache = result.data;
    return this.cache;
  }

  async get(key: SecretKey): Promise<string | undefined> {
    const stored = (await this.load())[key as string];
    if (stored) return stored;
    if (key === 'GITHUB_TOKEN') return this.env.GITHUB_TOKEN ?? this.env.GITHUB_PAT;
    return this.env[key as string];
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const data = { ...(await this.load()), [key as string]: value };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    // Write a private temp file, then rename over the real one: a crash mid-write
    // can't truncate it, and `mode` on writeFile only applies to a NEW file.
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.filePath);
    this.cache = data;
  }
}
