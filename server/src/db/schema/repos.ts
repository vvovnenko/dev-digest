import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces, users } from './core';

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    clonePath: text('clone_path'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    /** Newest PR `updated_at` a poll has imported; the next poll reads GitHub only down to it. Null = never polled. */
    pullsSyncedThrough: timestamp('pulls_synced_through', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    // GitHub names are case-insensitive: `Acme/App` and `acme/app` are one repo (and one clone dir).
    uq: uniqueIndex('repos_ws_fullname_lower_uq').on(t.workspaceId, sql`lower(${t.fullName})`),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
  }),
);
