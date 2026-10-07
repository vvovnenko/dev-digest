import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingEntry, SettingsStore } from './ports.js';

/** Settings persistence: key/value preference rows per workspace and user. */
export class SettingsRepository implements SettingsStore {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SettingEntry[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  async upsertMany(workspaceId: string, userId: string, entries: SettingEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db
      .insert(t.settings)
      .values(entries.map(({ key, value }) => ({ workspaceId, userId, key, value })))
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: sql`excluded.value` },
      });
  }
}
