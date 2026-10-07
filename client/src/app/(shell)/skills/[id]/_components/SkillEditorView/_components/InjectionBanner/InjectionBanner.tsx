/* InjectionBanner — the full-width alert above a blocked skill's editor: its text matches
   prompt-injection patterns, so it stays off until a clean save. */
"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export function InjectionBanner() {
  const t = useTranslations("skills");
  return (
    <div role="alert" style={s.banner}>
      <Icon.AlertOctagon size={18} style={s.icon} />
      <div>
        <div style={s.title}>{t("injection.bannerTitle")}</div>
        <div>{t("injection.bannerBody")}</div>
      </div>
    </div>
  );
}
