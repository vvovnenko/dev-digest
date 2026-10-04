/* PreviewTab — the saved skill exactly as an agent's prompt receives it (the
   `### name` / `When to apply:` block), rendered as markdown, with its token
   estimate. Images render as labels so a preview never loads a remote image. */
"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { estimateTokens, renderSkillBlock, withoutImages } from "../../../../../helpers";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const block = renderSkillBlock(skill);
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("previewTab.title")}</h2>
        <span className="mono tnum" style={s.tokens}>
          {t("previewTab.tokens", { count: estimateTokens(block) })}
        </span>
      </div>
      <p style={s.caption}>{t("previewTab.caption")}</p>
      {!skill.enabled && <div style={s.disabled}>{t("previewTab.disabledNote")}</div>}
      <div style={s.card}>
        <Markdown>{withoutImages(block)}</Markdown>
      </div>
    </div>
  );
}
