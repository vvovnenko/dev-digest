import { SKILL_NAME_MAX, SKILL_NAME_PATTERN } from "./constants";

/** The fields of a skill that reach the prompt. */
export interface SkillBlockInput {
  name: string;
  description: string;
  body: string;
}

/**
 * One skill as the reviewing agent receives it inside `## Skills / rules`.
 * A hand copy of reviewer-core's `renderSkill` (the client imports no engine
 * code); `helpers.test.ts` pins the same golden string as the engine's test.
 */
export function renderSkillBlock(skill: SkillBlockInput): string {
  const description = skill.description.replace(/\s+/g, " ").trim();
  const head = description ? `### ${skill.name}\nWhen to apply: ${description}` : `### ${skill.name}`;
  return `${head}\n\n${skill.body.trim()}`;
}

/** Rough token count, ceil(chars / 4) — the formula the engine reports in the run trace. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Whether the API will accept `name` (kebab-case, ≤ 64 chars). */
export function isValidSkillName(name: string): boolean {
  return name.length > 0 && name.length <= SKILL_NAME_MAX && SKILL_NAME_PATTERN.test(name);
}

/**
 * Markdown with every image turned into a plain link label, so previewing an
 * imported body never loads a remote image (a tracking pixel). The agent still
 * receives the original text.
 */
export function withoutImages(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]/g, (_m, alt: string) => `[image: ${alt}]`);
}
