import { describe, it, expect } from 'vitest';
import type { ConnTestProvider, SecretKey, SecretsProvider } from '@devdigest/shared';
import { SettingsService } from '../src/modules/settings/service.js';
import type { SettingEntry, SettingsStore } from '../src/modules/settings/ports.js';

/** In-memory settings store: one list per workspace. */
class InMemorySettings implements SettingsStore {
  rows = new Map<string, SettingEntry[]>();
  async list(workspaceId: string) {
    return this.rows.get(workspaceId) ?? [];
  }
  async upsertMany(workspaceId: string, _userId: string, entries: SettingEntry[]) {
    const byKey = new Map((this.rows.get(workspaceId) ?? []).map((r) => [r.key, r]));
    for (const e of entries) byKey.set(e.key, e);
    this.rows.set(workspaceId, [...byKey.values()]);
  }
}

class InMemorySecrets implements SecretsProvider {
  constructor(public values: Record<string, string> = {}) {}
  async get(key: SecretKey) {
    return this.values[key as string];
  }
  async set(key: SecretKey, value: string) {
    this.values[key as string] = value;
  }
}

function service(opts: { secrets?: SecretsProvider; valid?: (key?: string) => boolean } = {}) {
  const secrets = opts.secrets ?? new InMemorySecrets({ OPENROUTER_API_KEY: 'working-key' });
  const store = new InMemorySettings();
  let invalidations = 0;
  const svc = new SettingsService({
    store,
    secrets,
    checkCredentials: async (_provider: ConnTestProvider, key?: string) => {
      if (!(opts.valid ?? ((k) => k !== 'typo'))(key)) throw new Error('401 Unauthorized');
      return 'OK — 3 models available';
    },
    invalidateSecretCaches: () => {
      invalidations++;
    },
  });
  return { svc, secrets, store, invalidations: () => invalidations };
}

describe('SettingsService.testConnection', () => {
  it('saves a key from the UI only after it passes the test', async () => {
    const { svc, secrets, invalidations } = service();
    const res = await svc.testConnection('openrouter', 'new-key');
    expect(res).toEqual({ provider: 'openrouter', ok: true, message: 'OK — 3 models available' });
    expect(await secrets.get('OPENROUTER_API_KEY')).toBe('new-key');
    expect(invalidations()).toBe(1);
  });

  it('keeps the working key when the new one fails', async () => {
    const { svc, secrets, invalidations } = service();
    const res = await svc.testConnection('openrouter', 'typo');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/401.*not saved/);
    expect(await secrets.get('OPENROUTER_API_KEY')).toBe('working-key');
    expect(invalidations()).toBe(0);
  });

  it('tests the stored key when none is given, and refuses to save into a read-only backend', async () => {
    expect((await service().svc.testConnection('openrouter')).ok).toBe(true);
    const readOnly: SecretsProvider = { get: async () => undefined };
    expect(await service({ secrets: readOnly }).svc.testConnection('openrouter', 'k')).toEqual({
      provider: 'openrouter',
      ok: false,
      message: 'Secrets backend is read-only',
    });
  });
});

describe('SettingsService.update', () => {
  it('stores the patch and returns the merged settings', async () => {
    const { svc } = service();
    await svc.update('ws', 'u', { theme: 'light' });
    expect(await svc.update('ws', 'u', { density: 'compact' })).toEqual({ theme: 'light', density: 'compact' });
  });
});
