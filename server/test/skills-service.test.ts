import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { SkillsService } from '../src/modules/skills/service.js';
import type { SkillChange, SkillRecord, SkillVersionRecord } from '../src/modules/skills/domain.js';
import type { NewSkill, SkillStore, SkillUse } from '../src/modules/skills/ports.js';
import { ConflictError, NotFoundError } from '../src/platform/errors.js';

/** In-memory SkillStore: a workspace-scoped map plus version rows (no Postgres). */
class FakeSkillStore implements SkillStore {
  skills = new Map<string, SkillRecord>();
  versions: SkillVersionRecord[] = [];
  uses = new Map<string, SkillUse[]>();
  private seq = 0;

  async list(ws: string) {
    return [...this.skills.values()].filter((s) => s.workspaceId === ws);
  }
  async getById(ws: string, id: string) {
    const s = this.skills.get(id);
    return s?.workspaceId === ws ? s : undefined;
  }
  async nameExists(ws: string, name: string) {
    return [...this.skills.values()].some((s) => s.workspaceId === ws && s.name === name);
  }
  async agentCounts(ws: string, ids?: string[]) {
    const out = new Map<string, number>();
    for (const [id, list] of this.uses) {
      if ((!ids || ids.includes(id)) && this.skills.get(id)?.workspaceId === ws) out.set(id, list.length);
    }
    return out;
  }
  async insert(values: NewSkill, note: string) {
    if (await this.nameExists(values.workspaceId, values.name)) return 'name_taken' as const;
    const row: SkillRecord = { ...values, id: `s${++this.seq}`, version: 1, evidenceFiles: null, createdAt: new Date() };
    this.skills.set(row.id, row);
    this.versions.push({ ...pick(row), skillId: row.id, version: 1, note, createdAt: new Date() });
    return row;
  }
  async update(ws: string, id: string, decide: (c: SkillRecord) => SkillChange | null) {
    const current = await this.getById(ws, id);
    if (!current) return undefined;
    const change = decide(current);
    if (!change) return current;
    if (
      change.set.name !== undefined &&
      [...this.skills.values()].some((s) => s.id !== id && s.workspaceId === ws && s.name === change.set.name)
    ) {
      return 'name_taken' as const;
    }
    const row = { ...current, ...change.set };
    this.skills.set(id, row);
    if (change.snapshot) {
      this.versions.push({
        ...change.snapshot.content,
        skillId: id,
        version: change.snapshot.version,
        note: change.snapshot.note,
        createdAt: new Date(),
      });
    }
    return row;
  }
  async deleteById(ws: string, id: string) {
    if (!(await this.getById(ws, id))) return false;
    this.skills.delete(id);
    return true;
  }
  async listVersions(ws: string, id: string) {
    if (!(await this.getById(ws, id))) return [];
    return this.versions.filter((v) => v.skillId === id).sort((a, b) => b.version - a.version);
  }
  async getVersion(ws: string, id: string, version: number) {
    return (await this.listVersions(ws, id)).find((v) => v.version === version);
  }
  async agentsUsing(_ws: string, id: string) {
    return this.uses.get(id) ?? [];
  }
}

const pick = (r: SkillRecord) => ({ name: r.name, description: r.description, type: r.type, body: r.body });

describe('SkillsService', () => {
  let store: FakeSkillStore;
  let service: SkillsService;
  beforeEach(() => {
    store = new FakeSkillStore();
    service = new SkillsService({ skills: store });
  });

  it('creates v1 with a "Created" note, or "Imported from <file>" for an import', async () => {
    const a = await service.create('w1', { name: 'branch-coverage', body: 'Flag it.' });
    expect(a).toMatchObject({ name: 'branch-coverage', type: 'custom', description: '', source: 'manual', version: 1, agent_count: 0 });
    const b = await service.create('w1', {
      name: 'flaky',
      body: 'x',
      source: 'imported',
      imported_from: 'flaky.zip',
    });
    expect(store.versions.map((v) => v.note)).toEqual(['Created', 'Imported from flaky.zip']);
    expect(b.source).toBe('imported');
  });

  it('a taken name is a ConflictError on create and on rename', async () => {
    await service.create('w1', { name: 'a', body: 'x' });
    const b = await service.create('w1', { name: 'b', body: 'x' });
    await expect(service.create('w1', { name: 'a', body: 'y' })).rejects.toBeInstanceOf(ConflictError);
    await expect(service.update('w1', b.id, { name: 'a' })).rejects.toMatchObject({
      statusCode: 409,
      details: { field: 'name' },
    });
    // Another workspace may use the name.
    expect((await service.create('w2', { name: 'a', body: 'x' })).name).toBe('a');
  });

  it('edits add versions with notes; enabled alone does not', async () => {
    const s = await service.create('w1', { name: 'a', body: 'v1 body' });
    await service.update('w1', s.id, { body: 'v2 body' });
    const off = await service.update('w1', s.id, { enabled: false });
    expect(off).toMatchObject({ version: 2, enabled: false });
    const versions = await service.versions('w1', s.id, { limit: 100, offset: 0 });
    expect(versions.map((v) => [v.version, v.note])).toEqual([
      [2, 'Edited body'],
      [1, 'Created'],
    ]);
  });

  it('restore writes a new version with the old content; restoring the current content changes nothing', async () => {
    const s = await service.create('w1', { name: 'a', description: 'd1', body: 'one' });
    await service.update('w1', s.id, { body: 'two', description: 'd2' });
    const restored = await service.restore('w1', s.id, 1);
    expect(restored).toMatchObject({ version: 3, body: 'one', description: 'd1' });
    expect((await service.versions('w1', s.id, { limit: 100, offset: 0 }))[0]!.note).toBe('Restored v1');

    const same = await service.restore('w1', s.id, 3);
    expect(same.version).toBe(3);
    await expect(service.restore('w1', s.id, 9)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('another workspace sees a 404 on every read and write', async () => {
    const s = await service.create('w1', { name: 'a', body: 'x' });
    for (const call of [
      () => service.get('w2', s.id),
      () => service.update('w2', s.id, { body: 'y' }),
      () => service.delete('w2', s.id),
      () => service.versions('w2', s.id, { limit: 10, offset: 0 }),
      () => service.restore('w2', s.id, 1),
      () => service.agents('w2', s.id),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('counts the agents that use a skill', async () => {
    const s = await service.create('w1', { name: 'a', body: 'x' });
    store.uses.set(s.id, [{ agentId: 'g1', agentName: 'Test Quality Reviewer', agentEnabled: true, order: 0 }]);
    expect((await service.list('w1'))[0]!.agent_count).toBe(1);
    expect(await service.agents('w1', s.id)).toEqual([
      { agent_id: 'g1', agent_name: 'Test Quality Reviewer', agent_enabled: true, order: 0 },
    ]);
  });

  it('previewImport parses the upload, flags a taken name and writes nothing', async () => {
    await service.create('w1', { name: 'flaky-test-patterns', body: 'x' });
    const zip = zipSync({
      'flaky-test-patterns/SKILL.md': strToU8('---\nname: flaky-test-patterns\ndescription: d\n---\nBody'),
      'flaky-test-patterns/scripts/find-sleeps.sh': strToU8('#!/bin/sh'),
    });
    const before = store.skills.size;
    const preview = await service.previewImport('w1', {
      filename: 'flaky.zip',
      content_base64: Buffer.from(zip).toString('base64'),
    });
    expect(preview).toMatchObject({
      draft: { name: 'flaky-test-patterns', description: 'd', type: 'custom', body: 'Body' },
      source_file: 'flaky-test-patterns/SKILL.md',
      skipped: [{ path: 'flaky-test-patterns/scripts/find-sleeps.sh', reason: 'script' }],
      name_taken: true,
    });
    expect(store.skills.size).toBe(before);
  });
});
