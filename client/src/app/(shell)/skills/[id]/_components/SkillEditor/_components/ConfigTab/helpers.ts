import type { Skill, SkillUpdate } from "@devdigest/shared";

/** The editable fields of a skill (the Config form's draft). */
export type SkillDraft = Pick<SkillUpdate, "name" | "description" | "type" | "body" | "enabled">;

const DRAFT_KEYS = ["name", "description", "type", "body", "enabled"] as const;

/** Only the draft fields that differ from the saved skill — what Save sends. */
export function changedFields(skill: Skill, draft: SkillDraft): SkillDraft {
  const patch: SkillDraft = {};
  for (const key of DRAFT_KEYS) {
    const value = draft[key];
    if (value !== undefined && value !== skill[key]) Object.assign(patch, { [key]: value });
  }
  return patch;
}

/** The draft laid over the saved skill — what the form shows. */
export function mergeDraft(skill: Skill, draft: SkillDraft): Required<SkillDraft> {
  return {
    name: draft.name ?? skill.name,
    description: draft.description ?? skill.description,
    type: draft.type ?? skill.type,
    body: draft.body ?? skill.body,
    enabled: draft.enabled ?? skill.enabled,
  };
}
