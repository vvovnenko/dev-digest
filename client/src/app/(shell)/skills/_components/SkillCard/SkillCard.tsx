/* SkillCard — one skill in the Skills grid and in the editor's left list: name,
   type, source, description, how many agents use it, a global enabled toggle
   and delete (asked in a modal beside the card). The name is the keyboard
   button; the whole card also clicks. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import { SkillTypeBadge, SKILL_TYPE_COLORS } from "@/components/skill-type-badge";
import { useDeleteSkill, useUpdateSkill } from "@/lib/hooks/skills";
import { SOURCE_ICON } from "./constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onDeleted,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  /** Called after the delete succeeded (the editor leaves a deleted skill's page). */
  onDeleted?: () => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [confirming, setConfirming] = React.useState(false);
  const agentCount = skill.agent_count ?? 0;
  const tint = SKILL_TYPE_COLORS[skill.type];
  const SourceIcon = Icon[SOURCE_ICON[skill.source]];

  const remove = () =>
    del.mutate(skill.id, {
      onSuccess: () => {
        setConfirming(false);
        onDeleted?.();
      },
    });

  return (
    <>
      <div onClick={onClick} style={s.card(!!active, skill.enabled)} data-skill-id={skill.id}>
        <div style={s.headerRow}>
          <div style={s.iconBox(tint.color, tint.bg)}>
            <Icon.Sparkles size={15} />
          </div>
          {onClick ? (
            <button
              type="button"
              className="mono"
              aria-label={t("card.open", { name: skill.name })}
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              style={{ ...s.name, ...s.nameButton }}
            >
              {skill.name}
            </button>
          ) : (
            <span className="mono" style={s.name}>
              {skill.name}
            </span>
          )}
          {/* A <label> names the vendored Toggle's button for screen readers. */}
          <label onClick={(e) => e.stopPropagation()} style={s.toggleLabel}>
            <span style={s.visuallyHidden}>{t("card.enable", { name: skill.name })}</span>
            <Toggle
              on={skill.enabled}
              onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
              size={14}
            />
          </label>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            disabled={del.isPending}
            title={t("card.delete")}
            aria-label={t("card.delete")}
            style={s.deleteBtn(del.isPending)}
          >
            <Icon.Trash size={14} />
          </button>
        </div>
        <div style={s.description}>{skill.description || t("card.noDescription")}</div>
        <div style={s.metaRow}>
          <SkillTypeBadge type={skill.type} />
          <span style={s.source}>
            <SourceIcon size={12} />
            {t(`listItem.source.${skill.source}`)}
          </span>
        </div>
        <div style={s.footer}>{t("card.agentCount", { count: agentCount })}</div>
      </div>
      {/* Beside the card, not in it: its opacity and onClick would reach the modal. */}
      {confirming && (
        <ConfirmDeleteModal
          title={t("card.delete")}
          message={
            agentCount > 0
              ? t("card.confirmDeleteUsed", { name: skill.name, count: agentCount })
              : t("card.confirmDelete", { name: skill.name })
          }
          onConfirm={remove}
          onClose={() => setConfirming(false)}
          pending={del.isPending}
        />
      )}
    </>
  );
}
