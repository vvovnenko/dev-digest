/* /agents/:id — Agent Editor (A2, L03). Left agent list + Config editor
   (model + system prompt). Tab state lives in ?tab=. Ported from
   screen_agents.jsx. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, ErrorState, Skeleton, Icon, Badge } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { useAgents, useAgent, useUpdateAgent } from "@/lib/hooks/agents";
import { ApiError } from "@/lib/api";
import { AgentCard } from "../../../_components/AgentCard";
import { AgentEditor } from "../AgentEditor";
import { DEFAULT_TAB, VALID_TABS } from "./constants";
import { s } from "./styles";

export function AgentEditorView() {
  const t = useTranslations("agents");
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: agents } = useAgents();
  const { data: agent, isLoading, isError, error, refetch } = useAgent(id);
  const update = useUpdateAgent();

  const requested = search.get("tab") ?? "";
  const tab = (VALID_TABS as readonly string[]).includes(requested) ? requested : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/agents/${id}?${sp.toString()}`);
  };

  useShellCrumb([
    { label: t("list.breadcrumbLab") },
    { label: t("list.breadcrumb"), href: "/agents" },
    { label: agent?.name ?? t("editor.agentFallback") },
  ]);

  if (isError || (!isLoading && !agent)) {
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
      {/* left: agent list */}
      <div style={s.sidebar}>
        <div style={s.sidebarHeader}>
          <div style={s.sidebarTitleRow}>
            <h1 style={s.sidebarTitle}>{t("editor.listTitle")}</h1>
            <Dropdown
              width={210}
              align="right"
              trigger={
                <Button kind="primary" size="sm" icon="Plus">
                  {t("editor.add")}
                </Button>
              }
              items={[{ label: t("editor.createFromScratch"), icon: "Edit", onClick: () => router.push("/agents") }]}
            />
          </div>
        </div>
        <div style={s.sidebarList}>
          {(agents ?? []).map((a) => (
            <AgentCard
              key={a.id}
              ag={a}
              active={a.id === id}
              skillCount={a.skill_count ?? undefined}
              onClick={() => router.push(`/agents/${a.id}?tab=${tab}`)}
              onToggle={(enabled) => update.mutate({ id: a.id, patch: { enabled } })}
            />
          ))}
        </div>
      </div>

      {/* editor */}
      {isLoading || !agent ? (
        <div style={s.loading}>
          <Skeleton height={24} width={240} />
          <Skeleton height={200} />
        </div>
      ) : (
        <div style={s.editor}>
          <div style={s.editorHeader}>
            <Icon.Cpu size={18} style={s.editorIcon} />
            <h1 style={s.editorTitle}>{agent.name}</h1>
            <Badge color="var(--text-secondary)" mono>
              {agent.provider}/{agent.model}
            </Badge>
            {!agent.enabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
            <div style={s.editorActions}>
              <Button kind="secondary" size="sm" icon="GitPullRequest" onClick={() => router.push("/")}>
                {t("editor.runOnPr")}
              </Button>
            </div>
          </div>
          <div style={s.editorBody}>
            <AgentEditor agent={agent} tab={tab} onTab={setTab} />
          </div>
        </div>
      )}
    </div>
  );
}
