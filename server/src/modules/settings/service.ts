import type {
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import { SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';
import type { SettingsDeps } from './ports.js';

/**
 * Settings use cases: non-secret preferences, which provider keys are set, and
 * the connection test that is also how a BYO key is saved.
 */
export class SettingsService {
  constructor(private deps: SettingsDeps) {}

  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.deps.store.list(workspaceId));
  }

  async update(workspaceId: string, userId: string, patch: SettingsUpdate): Promise<Settings> {
    const entries = Object.entries(patch).map(([key, value]) => ({ key, value }));
    await this.deps.store.upsertMany(workspaceId, userId, entries);
    return this.get(workspaceId);
  }

  /** Which provider keys are configured — booleans only, never the values. */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.deps.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /**
   * Test a provider key. A key from the UI is tested first and saved only when
   * the test passes, so a typo can't replace a working key; without one, the
   * stored key is tested.
   */
  async testConnection(provider: ConnTestProvider, key?: string): Promise<ConnTestResult> {
    const { secrets } = this.deps;
    if (key && !secrets.set) return { provider, ok: false, message: 'Secrets backend is read-only' };
    let message: string;
    try {
      message = await this.deps.checkCredentials(provider, key);
    } catch (err) {
      return {
        provider,
        ok: false,
        message: key ? `${(err as Error).message} — the key was not saved` : (err as Error).message,
      };
    }
    if (key && secrets.set) {
      await secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
      this.deps.invalidateSecretCaches();
    }
    return { provider, ok: true, message };
  }
}
