/* StatsTab — usage only: how many agents have this skill enabled, and which.
   Pull / accept rates and findings by category need run attribution that does
   not exist yet (later lessons). */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents } from "@/lib/hooks/skills";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: agents, isLoading, isError, refetch } = useSkillAgents(skill.id);
  const count = agents?.length ?? skill.agent_count ?? 0;

  return (
    <div style={s.wrap}>
      <div style={s.metric}>
        <div style={s.metricLabel}>{t("stats.usedBy")}</div>
        <div style={s.metricValue}>
          <span className="tnum">{count}</span>
          <span style={s.metricUnit}>{t("stats.agentsUnit", { count })}</span>
        </div>
      </div>
      <div style={s.panel}>
        <div style={s.panelTitle}>{t("stats.agentsTitle")}</div>
        {isLoading && <Skeleton height={44} />}
        {isError && <ErrorState body={t("stats.loadError")} onRetry={() => void refetch()} />}
        {agents && agents.length === 0 && <div style={s.muted}>{t("stats.empty")}</div>}
        {agents?.map((a) => (
          <div key={a.agent_id} style={s.row}>
            <Icon.Cpu size={15} style={s.rowIcon} />
            <span style={s.rowName}>{a.agent_name}</span>
            {!a.agent_enabled && <Badge color="var(--text-muted)">{t("stats.disabled")}</Badge>}
            <Link
              href={`/agents/${a.agent_id}?tab=skills`}
              style={s.open}
              aria-label={t("stats.openAgent", { name: a.agent_name })}
            >
              {t("stats.open")}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
