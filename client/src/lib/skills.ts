import type { SkillType } from "@devdigest/shared";

/** Skill rules shared by every screen that writes a skill (Skills Lab, Conventions). */

/** Skill types, in picker order. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Longest skill name the API accepts (`SkillName` in @devdigest/shared). */
export const SKILL_NAME_MAX = 64;

/** Same rule as `SkillName`: kebab-case, single hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The fields of a skill that reach the prompt. */
export interface SkillBlockInput {
  name: string;
  description: string;
  body: string;
}

/**
 * One skill as the reviewing agent receives it inside `## Skills / rules`.
 * A hand copy of reviewer-core's `renderSkill` (the client imports no engine
 * code); `skills.test.ts` pins the same golden string as the engine's test.
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
