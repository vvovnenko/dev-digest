/* CandidateCard — one proposed convention: the rule, its evidence (`path:lines`
   and the real snippet, copyable) and the model's confidence. Accept toggles to
   Accepted and back to pending; Reject removes the card; Edit turns the rule
   into an input (Enter/Save sends it, Escape/Cancel restores it). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, Icon, ProgressBar, TextInput } from "@devdigest/ui";
import type { ConventionCandidate, ConventionUpdate } from "@devdigest/shared";
import { useUpdateConvention } from "@/lib/hooks/conventions";
import { confidenceColor, confidencePercent, evidenceLabel } from "../../helpers";
import { COPIED_MS, RULE_MAX } from "./constants";
import { s } from "./styles";

export function CandidateCard({
  candidate,
  repoId,
  disabled = false,
}: {
  candidate: ConventionCandidate;
  repoId: string;
  /** Locks the actions (a scan is running and will replace the pending cards). */
  disabled?: boolean;
}) {
  const t = useTranslations("conventions");
  const update = useUpdateConvention();
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [copied, setCopied] = React.useState(false);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(copyTimer.current), []);

  const accepted = candidate.status === "accepted";
  const pct = confidencePercent(candidate.confidence);
  const send = (patch: ConventionUpdate) => update.mutate({ repoId, id: candidate.id, patch });

  const startEdit = () => {
    setRule(candidate.rule);
    setEditing(true);
  };
  const save = () => {
    const next = rule.trim();
    if (!next || disabled) return;
    if (next !== candidate.rule) send({ rule: next });
    setEditing(false);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(candidate.evidence_snippet);
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <Card style={s.card(accepted)}>
      <div style={s.main}>
        {editing ? (
          <TextInput
            value={rule}
            onChange={setRule}
            aria-label={t("card.ruleLabel")}
            maxLength={RULE_MAX}
            autoFocus
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <p style={s.rule}>{candidate.rule}</p>
        )}

        <div style={s.evidence}>
          <div style={s.evidenceHead}>
            <span className="mono" style={s.evidenceLabel}>
              {evidenceLabel(candidate)}
            </span>
            <button
              type="button"
              title={copied ? t("card.copied") : t("card.copySnippet")}
              aria-label={copied ? t("card.copied") : t("card.copySnippet")}
              onClick={copy}
              style={s.copyBtn}
            >
              {copied ? <Icon.Check size={13} /> : <Icon.Copy size={13} />}
            </button>
          </div>
          <pre className="mono" style={s.snippet}>
            {candidate.evidence_snippet}
          </pre>
        </div>

        <div style={s.confidence}>
          <span>{t("card.confidence")}</span>
          <div style={s.bar}>
            <ProgressBar value={pct} color={confidenceColor(candidate.confidence)} height={6} />
          </div>
          <span className="mono tnum">{pct}%</span>
        </div>
      </div>

      <div style={s.actions}>
        {editing ? (
          <>
            <Button kind="primary" icon="Check" full onClick={save} disabled={disabled || !rule.trim()}>
              {t("card.save")}
            </Button>
            <Button kind="secondary" full onClick={() => setEditing(false)}>
              {t("card.cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              kind={accepted ? "primary" : "secondary"}
              icon="Check"
              full
              aria-pressed={accepted}
              disabled={disabled}
              onClick={() => send({ status: accepted ? "pending" : "accepted" })}
            >
              {accepted ? t("card.accepted") : t("card.accept")}
            </Button>
            <Button kind="ghost" icon="X" full disabled={disabled} onClick={() => send({ status: "rejected" })}>
              {t("card.reject")}
            </Button>
            <Button kind="secondary" icon="Edit" full disabled={disabled} onClick={startEdit}>
              {t("card.edit")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
