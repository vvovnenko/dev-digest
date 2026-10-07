/* InjectionBadge — marks a skill whose text matches prompt-injection patterns (blocked:
   shown off, can't be enabled until a clean save). Shared by the skill editor header and
   the agent's Skills tab. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";

export function InjectionBadge() {
  const t = useTranslations("skills");
  return (
    <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
      {t("injection.badge")}
    </Badge>
  );
}
