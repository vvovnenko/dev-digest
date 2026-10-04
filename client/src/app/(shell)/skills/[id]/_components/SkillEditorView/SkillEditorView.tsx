/* /skills/:id — Skill editor. Left: every skill (cards) + Add Skill; right: the
   selected skill's Config / Preview / Versions tabs. Tab state lives in
   ?tab= (default Preview). Mirrors the agent editor. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { SkillTypeBadge } from "@/components/skill-type-badge";
import { useSkill, useSkills } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { AddSkillMenu } from "../../../_components/AddSkillMenu";
import { SkillCard } from "../../../_components/SkillCard";
import { SkillEditor } from "../SkillEditor";
import { DEFAULT_TAB, VALID_TABS } from "./constants";
import { s } from "./styles";

export function SkillEditorView() {
  const t = useTranslations("skills");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const requested = search.get("tab") ?? "";
  const tab = (VALID_TABS as readonly string[]).includes(requested) ? requested : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  useShellCrumb([
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("editor.skillFallback") },
  ]);

  if (isError || (!isLoading && !skill)) {
    return (
      <ErrorState
        fullScreen
        title={t("editor.loadErrorTitle")}
        body={error instanceof ApiError ? error.message : t("editor.loadErrorBody")}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div style={s.layout}>
      {/* left: skill list */}
      <div style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <div style={s.sidebarTitleRow}>
            <h1 style={s.sidebarTitle}>{t("editor.listTitle")}</h1>
            <AddSkillMenu label={t("editor.add")} />
          </div>
        </div>
        <div style={s.sidebarList}>
          {(skills ?? []).map((sk) => (
            <SkillCard
              key={sk.id}
              skill={sk}
              active={sk.id === id}
              onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
              onDeleted={sk.id === id ? () => router.push("/skills") : undefined}
            />
          ))}
        </div>
      </div>

      {/* editor */}
      {isLoading || !skill ? (
        <div style={s.loading}>
          <Skeleton height={24} width={240} />
          <Skeleton height={200} />
        </div>
      ) : (
        <div style={s.editor}>
          <div style={s.editorHeader}>
            <Icon.Sparkles size={18} style={s.editorIcon} />
            <h1 className="mono" style={s.editorTitle}>
              {skill.name}
            </h1>
            <SkillTypeBadge type={skill.type} />
            <Badge color="var(--text-secondary)" icon="GitCommit" mono>
              {t("editor.version", { version: skill.version })}
            </Badge>
            {!skill.enabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
          </div>
          <div style={s.editorBody}>
            <SkillEditor skill={skill} tab={tab} onTab={setTab} />
          </div>
        </div>
      )}
    </div>
  );
}
