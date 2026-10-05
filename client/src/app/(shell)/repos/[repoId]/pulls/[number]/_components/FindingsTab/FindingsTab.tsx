/* FindingsTab — the "Agent runs" tab: live runs (with cancel), the Timeline of
   runs and commits, and one collapsible accordion per review run. It owns which
   runs are open and which one the j/k/a/d shortcuts drive, so exactly one
   FindingsPanel listens for them however many runs are open. Deleting a run from
   the Timeline asks first in a modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import type { FindingRecord, ReviewRecord, RunSummary, PrCommit } from "@devdigest/shared";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import { useCancelRun, useDeleteRun, useRunSettled } from "@/lib/hooks/reviews";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { useOpenRuns } from "./useOpenRuns";
import { s } from "./styles";

interface FindingsTabProps {
  prId: string;
  liveRunIds: string[];
  lethalTrifecta: FindingRecord[];
  /** Reviews, newest first — one accordion each. */
  reviews: ReviewRecord[];
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (id: string) => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  lethalTrifecta,
  reviews,
  prRuns,
  prCommits,
  repoFullName,
  headSha,
  onOpenTrace,
}: FindingsTabProps) {
  const t = useTranslations("prReview.findingsTab");
  const tPr = useTranslations("prReview");
  const cancel = useCancelRun(prId);
  const deleteRun = useDeleteRun(prId);
  const onRunSettled = useRunSettled(prId);
  const runs = useOpenRuns(reviews);
  const [deletingRunId, setDeletingRunId] = React.useState<string | null>(null);
  const reviewRunning = liveRunIds.length > 0;

  // Timeline severity chips: each run's findings, taken from the review that run
  // produced (already loaded here — no extra request).
  const findingsByRun = React.useMemo(() => {
    const byRun = new Map<string, FindingRecord[]>();
    for (const review of reviews) {
      if (review.kind === "review" && review.run_id) byRun.set(review.run_id, review.findings);
    }
    return byRun;
  }, [reviews]);

  return (
    <section>
      {reviewRunning && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancel.isPending}
                  onClick={() => liveRunIds.forEach((id) => cancel.mutate(id))}
                >
                  {t("cancel")}
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={() => onOpenTrace(liveRunIds[0]!)}>
                  {t("openTrace")}
                </Button>
              </div>
            }
          >
            {t("liveReview")}
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunSettled} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={s.spinner} />
          <span style={s.reviewInProgressText}>{t("inProgress")}</span>
          <span style={s.reviewInProgressSub}>{t("inProgressSub")}</span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={s.shieldIcon} />
          <span style={s.lethalTrifectaTitle}>{t("lethalTrifecta")}</span>
          <Badge color="var(--crit)" bg="transparent">
            {t("lethalCount", { count: lethalTrifecta.length })}
          </Badge>
        </div>
      )}

      {((prRuns && prRuns.length > 0) || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel icon="Activity" right={<span style={s.sectionHint}>{t("timelineHint")}</span>}>
            {t("timeline")}
          </SectionLabel>
          <RunHistory
            runs={prRuns ?? []}
            commits={prCommits}
            findingsByRun={findingsByRun}
            repoFullName={repoFullName}
            headSha={headSha}
            onOpenTrace={onOpenTrace}
            onGoToReview={runs.jumpTo}
            onDelete={setDeletingRunId}
          />
        </div>
      )}

      <SectionLabel icon="AlertOctagon" right={<span style={s.sectionHint}>{t("reviewRunsHint")}</span>}>
        {t("reviewRuns")}
      </SectionLabel>
      {reviews.length === 0
        ? !reviewRunning && <EmptyState icon="Sparkles" title={t("emptyTitle")} body={t("emptyBody")} />
        : reviews.map((review) => (
            <ReviewRunAccordion
              key={review.id}
              review={review}
              prId={prId}
              open={runs.isOpen(review.id)}
              onToggle={() => runs.toggle(review.id)}
              shortcutsActive={runs.activeId === review.id}
              scrollNonce={runs.scrollNonceFor(review)}
              onScrolled={runs.clearJump}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
      {deletingRunId && (
        <ConfirmDeleteModal
          title={tPr("timeline.deleteRun")}
          message={tPr("detail.confirmDeleteRun")}
          onConfirm={() => deleteRun.mutate(deletingRunId, { onSuccess: () => setDeletingRunId(null) })}
          onClose={() => setDeletingRunId(null)}
          pending={deleteRun.isPending}
        />
      )}
    </section>
  );
}
