import { describe, it, expect } from 'vitest';
import {
  enabledSkillIds,
  isConfigChange,
  linksChanged,
  withSkillAt,
  type AgentConfig,
  type SkillLink,
} from '../src/modules/agents/domain.js';

const agent: AgentConfig = {
  name: 'Security',
  description: 'd',
  provider: 'openrouter',
  model: 'm',
  systemPrompt: 'p',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
};

describe('isConfigChange', () => {
  it('a different config value is a change; the same value or an enabled toggle is not', () => {
    expect(isConfigChange(agent, { model: 'm2' })).toBe(true);
    expect(isConfigChange(agent, { model: 'm' })).toBe(false);
    expect(isConfigChange(agent, {})).toBe(false);
    expect(isConfigChange(agent, { outputSchema: {} })).toBe(true);
  });
});

describe('skill links', () => {
  const on = (skillId: string): SkillLink => ({ skillId, enabled: true });
  const off = (skillId: string): SkillLink => ({ skillId, enabled: false });
  const ids = (links: SkillLink[]) => links.map((l) => l.skillId);

  it('order and the per-agent flag matter: a reorder or a toggle is a change', () => {
    expect(linksChanged([on('a'), on('b')], [on('a'), on('b')])).toBe(false);
    expect(linksChanged([on('a'), on('b')], [on('b'), on('a')])).toBe(true);
    expect(linksChanged([on('a')], [on('a'), on('b')])).toBe(true);
    expect(linksChanged([on('a')], [off('a')])).toBe(true);
  });

  it('withSkillAt moves or inserts a skill, clamping the position', () => {
    expect(ids(withSkillAt([on('a'), on('b'), on('c')], 'a', 2))).toEqual(['b', 'c', 'a']);
    expect(ids(withSkillAt([on('a'), on('b')], 'x'))).toEqual(['a', 'b', 'x']);
    expect(ids(withSkillAt([on('a'), on('b')], 'x', 0))).toEqual(['x', 'a', 'b']);
    expect(ids(withSkillAt([on('a')], 'x', 99))).toEqual(['a', 'x']);
  });

  it('withSkillAt keeps a moved link flag and enables a new one', () => {
    expect(withSkillAt([off('a'), on('b')], 'a', 1)).toEqual([on('b'), off('a')]);
    expect(withSkillAt([off('a')], 'x', 0)).toEqual([on('x'), off('a')]);
  });

  it('enabledSkillIds keeps only the links that reach the prompt, in order', () => {
    expect(enabledSkillIds([on('a'), off('b'), on('c')])).toEqual(['a', 'c']);
  });
});
