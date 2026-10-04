import type { Skill, SkillAgentUse, SkillImportPreview, SkillVersion } from '@devdigest/shared';
import type { SkillRecord, SkillVersionRecord } from './domain.js';
import type { ParsedUpload } from './import-parser.js';
import type { SkillUse } from './ports.js';

/** Stored records → API DTOs. */

export function toSkillDto(row: SkillRecord, agentCount: number): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    source: row.source,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    agent_count: agentCount,
  };
}

export function toSkillVersionDto(row: SkillVersionRecord): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    name: row.name,
    description: row.description,
    type: row.type,
    body: row.body,
    note: row.note,
    created_at: row.createdAt.toISOString(),
  };
}

export function toSkillAgentUseDto(use: SkillUse): SkillAgentUse {
  return {
    agent_id: use.agentId,
    agent_name: use.agentName,
    agent_enabled: use.agentEnabled,
    order: use.order,
  };
}

export function toImportPreviewDto(parsed: ParsedUpload, nameTaken: boolean): SkillImportPreview {
  return {
    draft: parsed.draft,
    source_file: parsed.sourceFile,
    skipped: parsed.skipped.map((s) => ({ path: s.path, reason: s.reason })),
    warnings: parsed.warnings.map((w) => ({ code: w.code, detail: w.detail ?? null })),
    name_taken: nameTaken,
  };
}
