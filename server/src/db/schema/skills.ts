import { pgTable, uuid, text, integer, boolean, jsonb, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

const SKILL_TYPES = ['rubric', 'convention', 'security', 'custom'] as const;

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type', { enum: SKILL_TYPES }).notNull(),
    // 'imported' = an uploaded .md/.zip confirmed in the UI (L02); a TS-only enum, no CHECK.
    source: text('source', {
      enum: ['manual', 'imported_url', 'extracted', 'community', 'imported'],
    }).notNull(),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    evidenceFiles: jsonb('evidence_files').$type<string[]>(),
    createdAt: now(),
  },
  // A skill's name is its handle in the UI and the prompt heading: one per workspace.
  (t) => ({ wsNameUq: uniqueIndex('skills_ws_name_uq').on(t.workspaceId, t.name) }),
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    // Every field that reaches the prompt is snapshotted, so a version is reproducible.
    name: text('name').notNull().default(''),
    description: text('description').notNull().default(''),
    type: text('type', { enum: SKILL_TYPES }).notNull().default('custom'),
    body: text('body').notNull(),
    /** What changed: "Created", "Edited body, description", "Restored v3"… */
    note: text('note').notNull().default(''),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
