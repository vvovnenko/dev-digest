import type { SkillSource } from '@devdigest/shared';
import type { SkillChange, SkillContent, SkillRecord, SkillVersionRecord } from './domain.js';

export interface NewSkill extends SkillContent {
  workspaceId: string;
  source: SkillSource;
  enabled: boolean;
  /** Files the skill was derived from (a skill made from conventions). */
  evidenceFiles?: string[] | null;
}

/** An agent that has a skill linked and enabled. */
export interface SkillUse {
  agentId: string;
  agentName: string;
  agentEnabled: boolean;
  order: number;
}

/** The skills repository. Every method is scoped to the workspace. */
export interface SkillStore {
  list(workspaceId: string): Promise<SkillRecord[]>;
  getById(workspaceId: string, id: string): Promise<SkillRecord | undefined>;
  nameExists(workspaceId: string, name: string): Promise<boolean>;
  /** Skill id → agents with it linked and enabled (missing = 0); all skills when `skillIds` is omitted. */
  agentCounts(workspaceId: string, skillIds?: string[]): Promise<Map<string, number>>;
  /** Creates version 1 and its snapshot together; 'name_taken' when the name exists. */
  insert(values: NewSkill, note: string): Promise<SkillRecord | 'name_taken'>;
  /**
   * Apply `decide(current)` under a row lock: the column values and, when it
   * carries one, the new version's snapshot commit together. Undefined when the
   * skill isn't in the workspace; 'name_taken' when a rename hits another skill.
   */
  update(
    workspaceId: string,
    id: string,
    decide: (current: SkillRecord) => SkillChange | null,
  ): Promise<SkillRecord | 'name_taken' | undefined>;
  /** Links and versions go with it (cascade). */
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  /** Newest first. */
  listVersions(
    workspaceId: string,
    skillId: string,
    page: { limit: number; offset: number },
  ): Promise<SkillVersionRecord[]>;
  getVersion(workspaceId: string, skillId: string, version: number): Promise<SkillVersionRecord | undefined>;
  /** Agents with the skill linked and enabled, by agent name. */
  agentsUsing(workspaceId: string, skillId: string): Promise<SkillUse[]>;
}

export interface SkillsDeps {
  skills: SkillStore;
  fetcher: SkillFileFetcher;
}

/** A file fetched for a URL import. */
export interface FetchedFile {
  bytes: Uint8Array;
  /** The response's `content-type`, when it sent one. */
  contentType: string | null;
  /** The URL the bytes came from, after redirects. */
  finalUrl: URL;
}

/**
 * Fetches a skill file over https: public addresses only (every redirect hop
 * re-checked), at most `maxBytes`, never an HTML page. Satisfied structurally by
 * the `SafeHttpsFetcher` adapter, wired as `container.urlFetcher`.
 */
export interface SkillFileFetcher {
  fetch(url: URL, limits: { maxBytes: number }): Promise<FetchedFile>;
}
