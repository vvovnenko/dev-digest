import type { ConventionCandidate, ConventionScan, ConventionsState, Skill } from '@devdigest/shared';
import { clampConfidence, type ConventionRecord, type ConventionScanRecord } from './domain.js';
import type { CreatedSkill } from './ports.js';

/** Stored records → API DTOs. Legacy rows may lack the evidence columns. */

export function toCandidateDto(row: ConventionRecord): ConventionCandidate {
  const start = row.evidenceStartLine ?? 1;
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_start_line: start,
    evidence_end_line: row.evidenceEndLine ?? start,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: clampConfidence(row.confidence ?? 0),
    status: row.status,
    accepted: row.status === 'accepted',
  };
}

export function toScanDto(row: ConventionScanRecord): ConventionScan {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    sample_files: row.sampleFiles,
    provider: row.provider,
    model: row.model,
    candidates_found: row.candidatesFound,
    candidates_kept: row.candidatesKept,
    cost_usd: row.costUsd,
    created_at: row.createdAt.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

/** `scan`: the latest done scan; `latest_scan`: the newest of any status. */
export function toStateDto(
  latestDone: ConventionScanRecord | undefined,
  latest: ConventionScanRecord | undefined,
  candidates: ConventionRecord[],
): ConventionsState {
  return {
    scan: latestDone ? toScanDto(latestDone) : null,
    latest_scan: latest ? toScanDto(latest) : null,
    candidates: candidates.map(toCandidateDto),
  };
}

/** A just-created skill: no agent links it yet. */
export function toSkillDto(row: CreatedSkill): Skill {
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
    agent_count: 0,
  };
}
