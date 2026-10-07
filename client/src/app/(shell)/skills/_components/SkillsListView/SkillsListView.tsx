/* /skills — Skills Lab list: a grid of skill cards with search and "Add Skill ▾"
   (create / import). Selecting a skill opens /skills/:id on its Preview tab. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks/skills";
import { AddSkillMenu } from "../AddSkillMenu";
import { SkillCard } from "../SkillCard";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [search, setSearch] = React.useState("");

  const list = filterSkills(skills ?? [], search);
  useShellCrumb([{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerText}>
          <h1 style={s.h1}>{t("page.heading")}</h1>
          <p style={s.subtitle}>{t("page.subtitle")}</p>
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            aria-label={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </div>
        <AddSkillMenu />
      </div>

      {isLoading && (
        <div style={s.grid}>
          <Skeleton height={140} />
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      )}
      {isError && <ErrorState body={t("page.loadError")} onRetry={() => void refetch()} />}
      {!isLoading && !isError && (skills ?? []).length === 0 && (
        <EmptyState icon="Sparkles" title={t("page.empty.title")} body={t("page.empty.body")} />
      )}
      {(skills ?? []).length > 0 && list.length === 0 && (
        <div style={s.noMatch}>{t("page.noMatch", { query: search.trim() })}</div>
      )}
      {list.length > 0 && (
        <div style={s.grid}>
          {list.map((sk) => (
            <SkillCard key={sk.id} skill={sk} onClick={() => router.push(`/skills/${sk.id}?tab=preview`)} />
          ))}
        </div>
      )}
    </div>
  );
}
