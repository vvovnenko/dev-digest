/* SkillsTab — every workspace skill in this agent's prompt order: drag (or
   keyboard-move) to reorder, tick to enable for this agent. Each action saves the
   whole ordered list once; nothing is saved on mount. Rows come straight from the
   query data — local state only holds an in-progress drag or keyboard lift. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, EmptyState, ErrorState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import { SkillTypeBadge } from "@/components/skill-type-badge";
import { InjectionBadge } from "@/components/injection-badge";
import { useAgentSkills, useSetAgentSkills } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { DRAG_MIME } from "./constants";
import {
  countEnabled,
  filterRows,
  isRowLive,
  mergeAgentSkills,
  moveRow,
  sameRows,
  toggleRow,
  toLinks,
  type SkillRow,
} from "./helpers";
import { s } from "./styles";

/** A keyboard "pick up": the row being moved and the order previewed so far. */
interface Lift {
  id: string;
  rows: SkillRow[];
}

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const router = useRouter();
  const skillsQ = useSkills();
  const linksQ = useAgentSkills(agentId);
  const save = useSetAgentSkills(agentId);

  const [query, setQuery] = React.useState("");
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [lift, setLift] = React.useState<Lift | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const handles = React.useRef(new Map<string, HTMLButtonElement>());

  const rows = React.useMemo(
    () => mergeAgentSkills(skillsQ.data ?? [], linksQ.data ?? []),
    [skillsQ.data, linksQ.data],
  );
  const shown = lift ? lift.rows : rows;
  const filtering = query.trim().length > 0;
  const visible = filtering ? filterRows(shown, query) : shown;

  // Keep focus on the moved row's handle: React re-inserts the moved node, which blurs it.
  React.useEffect(() => {
    if (lift) handles.current.get(lift.id)?.focus();
  }, [lift]);

  const commit = (next: SkillRow[]) => {
    if (sameRows(next, rows)) return;
    save.mutate(toLinks(next));
  };

  const positionOf = (list: readonly SkillRow[], id: string) => list.findIndex((r) => r.skill.id === id) + 1;

  const onHandleKey = (e: React.KeyboardEvent, row: SkillRow) => {
    if (filtering) return;
    const id = row.skill.id;
    const name = row.skill.name;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (lift && lift.id !== id) return;
      if (!lift) {
        setLift({ id, rows });
        setAnnouncement(t("skills.lifted", { name, position: positionOf(rows, id), total: rows.length }));
      } else {
        const final = lift.rows;
        setLift(null);
        setAnnouncement(t("skills.moved", { name, position: positionOf(final, id), total: final.length }));
        commit(final);
      }
      return;
    }
    if (!lift || lift.id !== id) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const from = positionOf(lift.rows, id) - 1;
      const next = moveRow(lift.rows, from, from + (e.key === "ArrowUp" ? -1 : 1));
      setLift({ id, rows: next });
      setAnnouncement(t("skills.moved", { name, position: positionOf(next, id), total: next.length }));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setLift(null);
      setAnnouncement(t("skills.cancelled", { name, position: positionOf(rows, id) }));
    }
  };

  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData(DRAG_MIME) || dragId;
    setDragId(null);
    setOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const next = moveRow(rows, positionOf(rows, sourceId) - 1, positionOf(rows, targetId) - 1);
    const moved = next.find((r) => r.skill.id === sourceId);
    if (moved) {
      setAnnouncement(
        t("skills.moved", { name: moved.skill.name, position: positionOf(next, sourceId), total: next.length }),
      );
    }
    commit(next);
  };

  if (skillsQ.isError || linksQ.isError) {
    return (
      <ErrorState
        body={t("skills.loadError")}
        onRetry={() => {
          void skillsQ.refetch();
          void linksQ.refetch();
        }}
      />
    );
  }
  if (skillsQ.isLoading || linksQ.isLoading) {
    return (
      <div style={s.loading}>
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="Sparkles"
        title={t("skills.emptyTitle")}
        body={t("skills.emptyBody")}
        cta={t("skills.emptyCta")}
        onCta={() => router.push("/skills")}
      />
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: countEnabled(rows), total: rows.length })}
        </Badge>
        <div style={s.filter}>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {visible.length === 0 && <p style={s.hint}>{t("skills.noMatch", { q: query.trim() })}</p>}
      <ul style={s.list} aria-label={t("skills.title")}>
        {visible.map((row) => {
          const { skill } = row;
          const blocked = skill.injection_detected;
          const draggable = !filtering && !lift;
          return (
            <li
              key={skill.id}
              draggable={draggable}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, skill.id);
                e.dataTransfer.effectAllowed = "move";
                setDragId(skill.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onDragOver={(e) => {
                if (!dragId || filtering) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== skill.id) setOverId(skill.id);
              }}
              onDrop={(e) => onDrop(e, skill.id)}
              style={{ ...s.row(isRowLive(row), overId === skill.id && dragId !== skill.id, lift?.id === skill.id, blocked), listStyle: "none" }}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) handles.current.set(skill.id, el);
                  else handles.current.delete(skill.id);
                }}
                aria-label={t("skills.dragHandle", { name: skill.name })}
                aria-describedby="agent-skills-keyboard-hint"
                aria-pressed={lift?.id === skill.id}
                aria-disabled={filtering}
                title={filtering ? t("skills.reorderOffWhileFiltering") : t("skills.keyboardHint")}
                onKeyDown={(e) => onHandleKey(e, row)}
                onBlur={(e) => {
                  // Focus moving to another control cancels a lift. A null relatedTarget
                  // is React re-inserting the moved row (or the window losing focus):
                  // keep the lift; the effect above puts focus back on the handle.
                  if (lift?.id === skill.id && e.relatedTarget) setLift(null);
                }}
                style={s.handle(!filtering)}
              >
                <Icon.Menu size={15} />
              </button>
              <Checkbox
                checked={isRowLive(row)}
                disabled={blocked}
                onChange={() => commit(toggleRow(rows, skill.id))}
                label={
                  <span className="mono" style={s.name}>
                    {skill.name}
                  </span>
                }
              />
              <div style={s.rowEnd}>
                {blocked ? (
                  <span title={t("skills.injectionTitle")}>
                    <InjectionBadge />
                  </span>
                ) : (
                  !skill.enabled && (
                    <span title={t("skills.globallyDisabledTitle")}>
                      <Badge color="var(--text-muted)">{t("skills.globallyDisabled")}</Badge>
                    </span>
                  )
                )}
                <SkillTypeBadge type={skill.type} />
                <Link href={`/skills/${skill.id}`} aria-label={t("skills.openSkill", { name: skill.name })} style={s.open}>
                  {t("skills.open")}
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      <span id="agent-skills-keyboard-hint" style={s.srOnly}>
        {t("skills.keyboardHint")}
      </span>
      <div aria-live="polite" style={s.srOnly}>
        {announcement}
      </div>
    </div>
  );
}
