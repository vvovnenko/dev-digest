import type { SkillType } from "@devdigest/shared";

/** Constants shared by the skills routes (list + editor). */

/** Skill types, in picker order. */
export const SKILL_TYPES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Longest skill name the API accepts (`SkillName` in @devdigest/shared). */
export const SKILL_NAME_MAX = 64;

/** Same rule as `SkillName`: kebab-case, single hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
