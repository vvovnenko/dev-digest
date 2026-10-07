import type { ConnTestProvider, SecretsProvider } from '@devdigest/shared';

/** One persisted, non-secret preference. */
export interface SettingEntry {
  key: string;
  value: unknown;
}

export interface SettingsStore {
  list(workspaceId: string): Promise<SettingEntry[]>;
  /** Upsert every entry for this user in one statement — all or none. */
  upsertMany(workspaceId: string, userId: string, entries: SettingEntry[]): Promise<void>;
}

export interface SettingsDeps {
  store: SettingsStore;
  secrets: SecretsProvider;
  /**
   * Test credentials without saving them: a candidate `key` when given, else
   * the stored one. Resolves to a short success message; throws on failure.
   */
  checkCredentials(provider: ConnTestProvider, key?: string): Promise<string>;
  /** Drop cached provider clients after a key changes. */
  invalidateSecretCaches(): void;
}
