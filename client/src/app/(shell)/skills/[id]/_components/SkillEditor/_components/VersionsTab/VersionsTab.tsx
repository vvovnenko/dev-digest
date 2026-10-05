/* VersionsTab — the skill's snapshots, newest first. The current one is marked;
   any older one can be diffed against the current skill or restored (restoring
   asks first in a modal, then saves its content as a new version, so history is
   never rewritten). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { useDateFormat } from "@/lib/format";
import { RestoreVersionModal } from "./_components/RestoreVersionModal";
import { VersionDiffModal } from "./_components/VersionDiffModal";
import { VERSION_DATE } from "./constants";
import { s } from "./styles";

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const formatDate = useDateFormat(VERSION_DATE);
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffing, setDiffing] = React.useState<SkillVersion | null>(null);
  const [restoring, setRestoring] = React.useState<SkillVersion | null>(null);

  const onRestore = (v: SkillVersion) =>
    restore.mutate({ id: skill.id, version: v.version }, { onSuccess: () => setRestoring(null) });

  return (
    <div style={s.wrap}>
      {diffing && <VersionDiffModal from={diffing} current={skill} onClose={() => setDiffing(null)} />}
      {restoring && (
        <RestoreVersionModal
          version={restoring.version}
          onConfirm={() => onRestore(restoring)}
          onClose={() => setRestoring(null)}
          pending={restore.isPending}
        />
      )}
      <div style={s.header}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        {versions && <Badge color="var(--text-secondary)">{t("versions.count", { count: versions.length })}</Badge>}
      </div>
      <p style={s.caption}>{t("versions.caption")}</p>

      {isLoading && <Skeleton height={64} />}
      {isError && <ErrorState body={t("versions.loadError")} onRetry={() => void refetch()} />}
      {versions && versions.length === 0 && <EmptyState icon="History" title={t("versions.empty")} />}
      {versions && versions.length > 0 && (
        <div style={s.list}>
          {versions.map((v) => {
            const current = v.version === skill.version;
            return (
              <div key={v.version} style={s.row(current)}>
                <span className="mono" style={s.versionTag(current)}>
                  {t("editor.version", { version: v.version })}
                </span>
                <div style={s.rowText}>
                  <div style={s.note}>{v.note || t("editor.version", { version: v.version })}</div>
                  <div className="tnum" style={s.date}>
                    {formatDate(v.created_at)}
                  </div>
                </div>
                {current ? (
                  <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                    {t("versions.current")}
                  </Badge>
                ) : (
                  <div style={s.actions}>
                    <Button kind="secondary" size="sm" icon="Eye" onClick={() => setDiffing(v)}>
                      {t("versions.diff")}
                    </Button>
                    <Button
                      kind="secondary"
                      size="sm"
                      icon="History"
                      onClick={() => setRestoring(v)}
                      disabled={restore.isPending}
                    >
                      {t("versions.restore")}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
