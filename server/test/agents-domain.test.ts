import { describe, it, expect } from 'vitest';
import { isConfigChange, skillsChanged, withSkillAt, type AgentConfig } from '../src/modules/agents/domain.js';

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

describe('skill lists', () => {
  it('order matters: a reorder is a change', () => {
    expect(skillsChanged(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(skillsChanged(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(skillsChanged(['a'], ['a', 'b'])).toBe(true);
  });

  it('withSkillAt moves or inserts a skill, clamping the position', () => {
    expect(withSkillAt(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(withSkillAt(['a', 'b'], 'x')).toEqual(['a', 'b', 'x']);
    expect(withSkillAt(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b']);
    expect(withSkillAt(['a'], 'x', 99)).toEqual(['a', 'x']);
  });
});
