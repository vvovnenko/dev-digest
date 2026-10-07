import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSecretsProvider } from '../src/adapters/secrets/local.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'devdigest-secrets-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalSecretsProvider', () => {
  it('writes a private file in a private directory', async () => {
    const file = join(root, 'nested', 'secrets.json');
    const secrets = new LocalSecretsProvider(file, {});
    await secrets.set('OPENAI_API_KEY', 'sk-1');
    await secrets.set('GITHUB_TOKEN', 'ghp-2');

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ OPENAI_API_KEY: 'sk-1', GITHUB_TOKEN: 'ghp-2' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'nested'))).mode & 0o777).toBe(0o700);
    expect(await new LocalSecretsProvider(file, {}).get('GITHUB_TOKEN')).toBe('ghp-2');
  });

  it('falls back to the environment when there is no file', async () => {
    const secrets = new LocalSecretsProvider(join(root, 'missing.json'), { OPENROUTER_API_KEY: 'from-env' });
    expect(await secrets.get('OPENROUTER_API_KEY')).toBe('from-env');
  });

  it('fails loudly on a broken file instead of silently dropping every key', async () => {
    const file = join(root, 'secrets.json');
    await mkdir(root, { recursive: true });
    await writeFile(file, '{ not json');
    await expect(new LocalSecretsProvider(file, {}).get('OPENAI_API_KEY')).rejects.toThrow(/not valid JSON/);
    await writeFile(file, JSON.stringify({ OPENAI_API_KEY: 42 }));
    await expect(new LocalSecretsProvider(file, {}).get('OPENAI_API_KEY')).rejects.toThrow(/string values/);
  });
});
