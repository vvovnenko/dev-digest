/* ReviewRunAccordion — one collapsible review RUN (a single agent's pass over
   the PR). Header shows agent + verdict + counts + score + when it ran; the
   body holds that run's VerdictBanner summary and its own FindingsPanel. A PR
   can have many runs (different agents / re-runs over time) — each is separate
   and collapsible so older runs don't bury the latest. Open state is owned by
   FindingsTab (see useOpenRuns). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge } from "@devdigest/ui";
import type { ReviewRecord, Verdict } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge";
import { useDeleteReview } from "@/lib/hooks/reviews";
import { useDateFormat } from "@/lib/format";
import { VERDICT_META } from "../../constants";
import { FindingsPanel } from "../FindingsPanel";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";

export function ReviewRunAccordion({
  review,
  prId,
  open,
  onToggle,
  shortcutsActive = false,
  scrollNonce = 0,
  onScrolled,
  repoFullName,
  headSha,
}: {
  review: ReviewRecord;
  prId: string;
  open: boolean;
  onToggle: () => void;
  /** This run's panel takes the j/k/a/d shortcuts (only one run at a time does). */
  shortcutsActive?: boolean;
  /** Non-zero: scroll this run into view (the Timeline jumped here); `onScrolled` clears it. */
  scrollNonce?: number;
  onScrolled?: () => void;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview.accordion");
  const formatWhen = useDateFormat();
  const del = useDeleteReview(prId);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (scrollNonce === 0) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onScrolled?.();
    // Only a new jump request scrolls — not a new `onScrolled` function from the parent.
  }, [scrollNonce]);

  const findings = review.findings;
  const blockers = findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
  const verdict = review.verdict as Verdict | null;
  const meta = verdict ? VERDICT_META[verdict] : undefined;
  const bodyId = `review-run-body-${review.id}`;

  return (
    <div ref={rootRef} id={review.run_id ? `review-run-${review.run_id}` : undefined} style={s.root}>
      <div style={s.headerRow}>
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} style={s.toggle}>
          <Icon.Cpu size={15} style={s.mutedIcon} />
          <span style={s.agentName}>{review.agent_name ?? t("agentFallback")}</span>
          {verdict && (
            <Badge color={meta?.c ?? "var(--text-muted)"} bg="transparent">
              {meta ? t(`verdict.${verdict}`) : verdict}
            </Badge>
          )}
          <span style={s.counts}>
            {t("findings", { count: findings.length })}
            {t("blockers", { count: blockers })}
          </span>
          <span style={s.spacer} />
          <RunCostBadge
            variant="detailed"
            costUsd={review.cost_usd}
            tokensIn={review.tokens_in}
            tokensOut={review.tokens_out}
            style={s.cost}
          />
          {review.score != null && (
            <Badge mono color="var(--text-secondary)">
              {review.score}
            </Badge>
          )}
          <span className="mono" style={s.when}>
            {formatWhen(review.created_at)}
          </span>
          <Icon.ChevronDown size={16} style={s.chevron(open)} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t("confirmDelete", { agent: review.agent_name ?? t("agentLower") }))) {
              del.mutate(review.id);
            }
          }}
          disabled={del.isPending}
          title={t("delete")}
          aria-label={t("delete")}
          style={s.deleteBtn(del.isPending)}
        >
          <Icon.Trash size={14} style={del.isPending ? s.spinning : undefined} />
        </button>
      </div>

      {open && (
        <div id={bodyId} style={s.body}>
          {verdict && (
            <div style={s.banner}>
              <VerdictBanner
                verdict={verdict}
                summary={review.summary}
                score={review.score}
                findingsCount={findings.length}
                blockers={blockers}
                agentName={review.agent_name}
              />
            </div>
          )}
          <FindingsPanel
            findings={findings}
            prId={prId}
            shortcutsActive={shortcutsActive}
            repoFullName={repoFullName}
            headSha={headSha}
          />
        </div>
      )}
    </div>
  );
}

export default ReviewRunAccordion;
