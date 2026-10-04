import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import {
  GENERAL_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from '../src/db/seed-prompts.js';
import { TEST_QUALITY_SKILLS } from '../src/db/seed-skills.js';
import { firstAddedLine } from '../src/adapters/llm/fake.js';

/**
 * The seed's prompt and skill constants mirror the human-readable originals in
 * `docs/agent-prompts/*.md` and `docs/agent-skills/*.md` ("keep the two in sync").
 * This pins that promise, so an edit to one side fails until the other follows.
 */
const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url));
const readDoc = (path: string) => readFileSync(`${docsDir}${path}`, 'utf8');

function splitFrontmatter(src: string): { meta: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (!match) throw new Error('no frontmatter');
  return { meta: YAML.parse(match[1]!) as Record<string, unknown>, body: match[2]!.trim() };
}

describe('seed prompts = docs/agent-prompts', () => {
  it.each([
    ['general-reviewer.md', GENERAL_REVIEWER_PROMPT],
    ['security-reviewer.md', SECURITY_REVIEWER_PROMPT],
    ['performance-reviewer.md', PERFORMANCE_REVIEWER_PROMPT],
    ['test-quality-reviewer.md', TEST_QUALITY_REVIEWER_PROMPT],
  ])('%s', (file, prompt) => {
    expect(prompt.trim()).toBe(readDoc(`agent-prompts/${file}`).trim());
  });
});

describe('seed skills = docs/agent-skills', () => {
  it.each(TEST_QUALITY_SKILLS.map((s) => [s.name, s] as const))('%s', (name, skill) => {
    const { meta, body } = splitFrontmatter(readDoc(`agent-skills/${name}.md`));
    expect(meta).toEqual({ name: skill.name, description: skill.description, type: skill.type });
    expect(skill.body).toBe(body);
  });

  it('the importable flaky-test-patterns folder is not seeded', () => {
    const { meta } = splitFrontmatter(readDoc('agent-skills/flaky-test-patterns/SKILL.md'));
    expect(meta.name).toBe('flaky-test-patterns');
    expect(TEST_QUALITY_SKILLS.map((s) => s.name)).not.toContain('flaky-test-patterns');
  });

  // The fake LLM (e2e) anchors its finding on the first `+++ b/` diff header in the
  // messages; skills sit in the user message before the diff, so one in a skill
  // body or the prompt would steal the anchor.
  it('no seeded skill or prompt carries a diff header the fake LLM would pick up', () => {
    for (const text of [TEST_QUALITY_REVIEWER_PROMPT, ...TEST_QUALITY_SKILLS.map((s) => s.body)]) {
      expect(text).not.toMatch(/^\+\+\+ b\//m);
      expect(firstAddedLine(text)).toBeNull();
    }
  });
});
