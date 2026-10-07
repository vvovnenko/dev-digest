import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, uniqueIndex, unique, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';

// ============================================================ Tenancy & core

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    createdAt: now(),
  },
  // The auth provider looks users up by email: one user per address.
  (t) => ({ emailUq: uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`) }),
);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: now(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) }),
);

/** Non-secret prefs/config. Secrets go via SecretsProvider, NOT here. */
export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value'),
  },
  (t) => ({
    // NULLS NOT DISTINCT: a workspace-wide setting (user_id null) is one row, not one per write.
    uq: unique('settings_ws_user_key_uq').on(t.workspaceId, t.userId, t.key).nullsNotDistinct(),
  }),
);
