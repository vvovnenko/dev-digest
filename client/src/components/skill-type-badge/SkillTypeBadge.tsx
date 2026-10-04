/* SkillTypeBadge — a skill's type (rubric / convention / security / custom) as a
   tinted badge. Shared by the Skills list, the skill editor and the agent's Skills tab. */
"use client";

import { useTranslations } from "next-intl";
import type { SkillType } from "@devdigest/shared";
import { Badge } from "@devdigest/ui";
import { SKILL_TYPE_COLORS } from "./constants";

export function SkillTypeBadge({ type }: { type: SkillType }) {
  const t = useTranslations("skills");
  const { color, bg } = SKILL_TYPE_COLORS[type];
  return (
    <Badge color={color} bg={bg}>
      {t(`listItem.type.${type}`)}
    </Badge>
  );
}
