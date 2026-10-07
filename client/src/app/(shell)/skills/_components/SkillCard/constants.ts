import type { SkillSource } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Icon shown before a skill's source label. */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Link",
  imported: "Upload",
};
