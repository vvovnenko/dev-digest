import type {
  Skill,
  SkillAgentUse,
  SkillCreate,
  SkillImportPreview,
  SkillImportRequest,
  SkillImportUrlRequest,
  SkillUpdate,
  SkillVersion,
} from '@devdigest/shared';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import {
  applySkillPatch,
  createNote,
  importFilenameFromUrl,
  importNoteUrl,
  parseImportUrl,
  restoreNote,
  type SkillPatch,
  type SkillRecord,
} from './domain.js';
import { toImportPreviewDto, toSkillAgentUseDto, toSkillDto, toSkillVersionDto } from './helpers.js';
import { parseSkillUpload } from './import-parser.js';
import type { SkillsDeps } from './ports.js';
import { MAX_IMPORT_BYTES } from './constants.js';
import { skillTextFlagged } from '../_shared/prompt-injection.js';

/**
 * Skills Lab — reusable instruction blocks an agent's prompt includes. The DB is
 * the source of truth; every content change is a new immutable version, so a
 * run's trace (which records name + version) can always be traced back to text.
 */
export class SkillsService {
  constructor(private deps: SkillsDeps) {}

  async list(workspaceId: string): Promise<Skill[]> {
    const [rows, counts] = await Promise.all([
      this.deps.skills.list(workspaceId),
      this.deps.skills.agentCounts(workspaceId),
    ]);
    return rows.map((r) => toSkillDto(r, counts.get(r.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Skill> {
    return this.withCount(workspaceId, await this.load(workspaceId, id));
  }

  async create(workspaceId: string, input: SkillCreate): Promise<Skill> {
    const source = input.source ?? 'manual';
    const row = await this.deps.skills.insert(
      {
        workspaceId,
        name: input.name,
        description: input.description ?? '',
        type: input.type ?? 'custom',
        body: input.body,
        source,
        enabled: input.enabled ?? true,
      },
      createNote(source === 'imported' ? input.imported_from : undefined),
    );
    if (row === 'name_taken') throw nameTaken(input.name);
    return toSkillDto(row, 0);
  }

  async update(workspaceId: string, id: string, input: SkillUpdate): Promise<Skill> {
    const patch: SkillPatch = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    };
    // Decided under the row lock: the gate checks the text the write would leave (a throw rolls back).
    const row = await this.deps.skills.update(workspaceId, id, (current) => {
      const blocked =
        patch.enabled === true &&
        skillTextFlagged({ description: patch.description ?? current.description, body: patch.body ?? current.body });
      return applySkillPatch(current, patch, undefined, blocked);
    });
    if (row === undefined) throw new NotFoundError('Skill not found');
    if (row === 'name_taken') throw nameTaken(input.name ?? '');
    return this.withCount(workspaceId, row);
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    if (!(await this.deps.skills.deleteById(workspaceId, id))) throw new NotFoundError('Skill not found');
  }

  async versions(workspaceId: string, id: string, page: { limit: number; offset: number }): Promise<SkillVersion[]> {
    await this.load(workspaceId, id);
    const rows = await this.deps.skills.listVersions(workspaceId, id, page);
    return rows.map(toSkillVersionDto);
  }

  /** A new version carrying vN's content; nothing changes when vN equals the current content. */
  async restore(workspaceId: string, id: string, version: number): Promise<Skill> {
    await this.load(workspaceId, id);
    const snapshot = await this.deps.skills.getVersion(workspaceId, id, version);
    if (!snapshot) throw new NotFoundError('Skill version not found');
    const content = { name: snapshot.name, description: snapshot.description, type: snapshot.type, body: snapshot.body };
    const row = await this.deps.skills.update(workspaceId, id, (current) =>
      applySkillPatch(current, content, restoreNote(version)),
    );
    if (row === undefined) throw new NotFoundError('Skill not found');
    if (row === 'name_taken') throw nameTaken(snapshot.name);
    return this.withCount(workspaceId, row);
  }

  async agents(workspaceId: string, id: string): Promise<SkillAgentUse[]> {
    await this.load(workspaceId, id);
    const uses = await this.deps.skills.agentsUsing(workspaceId, id);
    return uses.map(toSkillAgentUseDto);
  }

  /** Parse an upload into a draft for the user to confirm. Writes nothing. */
  async previewImport(workspaceId: string, input: SkillImportRequest): Promise<SkillImportPreview> {
    const parsed = parseSkillUpload({
      filename: input.filename,
      bytes: new Uint8Array(Buffer.from(input.content_base64, 'base64')),
    });
    const taken = await this.deps.skills.nameExists(workspaceId, parsed.draft.name);
    return toImportPreviewDto(parsed, taken);
  }

  /**
   * Fetch an https file and save it as a skill at once (no preview): fetched and
   * parsed before any write, saved enabled with source 'imported_url'. A flagged
   * skill is saved too; its DTO says `injection_detected: true`.
   */
  async importFromUrl(workspaceId: string, input: SkillImportUrlRequest): Promise<Skill> {
    const url = parseImportUrl(input.url);
    const file = await this.deps.fetcher.fetch(url, { maxBytes: MAX_IMPORT_BYTES });
    const { draft } = parseSkillUpload({
      filename: importFilenameFromUrl(file.finalUrl),
      bytes: file.bytes,
      preferHeadingName: true,
    });
    const name = input.name ?? draft.name;
    const row = await this.deps.skills.insert(
      { workspaceId, ...draft, name, source: 'imported_url', enabled: true },
      createNote(importNoteUrl(url)),
    );
    if (row === 'name_taken') throw nameTaken(name);
    return toSkillDto(row, 0);
  }

  private async load(workspaceId: string, id: string): Promise<SkillRecord> {
    const row = await this.deps.skills.getById(workspaceId, id);
    if (!row) throw new NotFoundError('Skill not found');
    return row;
  }

  private async withCount(workspaceId: string, row: SkillRecord): Promise<Skill> {
    const counts = await this.deps.skills.agentCounts(workspaceId, [row.id]);
    return toSkillDto(row, counts.get(row.id) ?? 0);
  }
}

function nameTaken(name: string): ConflictError {
  return new ConflictError(`A skill named "${name}" already exists`, { field: 'name' });
}
