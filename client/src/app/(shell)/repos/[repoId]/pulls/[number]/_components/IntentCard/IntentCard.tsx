/* IntentCard — what the PR is for: summary, in/out of scope, how far to trust it
   and which linked documents it rests on. Presentational: the Overview tab owns
   the data hooks and passes the state in. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Icon, IconBtn, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrIntentState } from "@devdigest/shared";
import { isIntentActive } from "@/lib/intent";
import { CONFIDENCE_COLOR } from "./constants";
import { isUnavailable, linkedSources, staleKey } from "./helpers";
import { s } from "./styles";

interface IntentCardProps {
  state: PrIntentState | undefined;
  /** The first read of the state is in flight. */
  loading: boolean;
  onDerive: () => void;
  /** The derive request is being sent. */
  deriving: boolean;
}

function ScopeColumn({ label, items, empty, kind }: { label: string; items: string[]; empty: string; kind: "in" | "out" }) {
  const Mark = kind === "in" ? Icon.Check : Icon.X;
  return (
    <div>
      <div style={s.colLabel(kind)}>
        <Mark size={13} />
        {label}
      </div>
      {items.length > 0 ? (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={`${i}-${item}`} style={s.item(kind)}>
              <span style={s.dot(kind)} aria-hidden>
                ·
              </span>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div style={s.empty}>{empty}</div>
      )}
    </div>
  );
}

export function IntentCard({ state, loading, onDerive, deriving }: IntentCardProps) {
  const t = useTranslations("brief");
  const status = state?.status ?? "none";
  const active = isIntentActive(status) || deriving;
  const intent = state?.intent ?? null;
  const title = t("block.intent");

  if (!state && loading) {
    return (
      <section>
        <SectionLabel icon="Target">{title}</SectionLabel>
        <Skeleton height={64} />
      </section>
    );
  }

  if (!intent && status === "none" && !active) {
    return (
      <section>
        <SectionLabel icon="Target">{title}</SectionLabel>
        <Card>
          <div style={s.empty}>{t("intent.noneYet")}</div>
          <div style={s.hint}>
            <Button kind="secondary" icon="Target" onClick={onDerive}>
              {t("intent.derive")}
            </Button>
          </div>
        </Card>
      </section>
    );
  }

  const confidence = intent?.confidence ?? null;
  const sources = intent ? linkedSources(intent.sources) : [];
  const missing = intent?.missing_context ?? [];

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <div style={s.headRight}>
            {confidence && !active && (
              <Badge color={CONFIDENCE_COLOR[confidence].color} bg={CONFIDENCE_COLOR[confidence].bg}>
                {t(`intent.confidence.${confidence}`)}
              </Badge>
            )}
            {!active && <IconBtn icon="RefreshCw" label={t("intent.rederive")} onClick={onDerive} />}
          </div>
        }
      >
        {title}
      </SectionLabel>
      <Card style={s.card}>
        {active && (
          <div style={s.deriving} role="status">
            <span style={s.derivingText}>{t("intent.deriving")}</span>
            <Skeleton height={14} />
            <Skeleton width="70%" height={14} />
          </div>
        )}
        {!active && status === "failed" && (
          <div style={s.error} role="alert">
            <Icon.XCircle size={14} />
            <span>{t("intent.failed")}</span>
          </div>
        )}
        {!active && state?.stale && intent && (
          <div style={s.banner}>
            <Icon.AlertTriangle size={14} />
            <span>{t(`intent.${staleKey(state.stale_reason)}`)}</span>
          </div>
        )}
        {intent && (
          <>
            <blockquote style={s.summary}>
              <span aria-hidden>“</span>
              {intent.summary}
              <span aria-hidden>”</span>
            </blockquote>
            <div style={s.columns}>
              <ScopeColumn kind="in" label={t("intent.inScope")} items={intent.in_scope} empty={t("intent.none")} />
              <ScopeColumn kind="out" label={t("intent.outOfScope")} items={intent.out_of_scope} empty={t("intent.none")} />
            </div>
            {confidence === "low" && <div style={s.hint}>{t("intent.lowHint")}</div>}
            {(sources.length > 0 || missing.length > 0) && (
              <div style={s.sources}>
                {sources.map((src) =>
                  isUnavailable(src) ? (
                    <span key={`${src.kind}:${src.ref}`} style={s.sourceUnavailable}>
                      <Icon.XCircle size={12} />
                      {t("intent.sourceUnavailable", { ref: src.ref, reason: src.reason ?? src.status })}
                    </span>
                  ) : (
                    <span key={`${src.kind}:${src.ref}`} style={s.source} className="mono">
                      {src.ref}
                    </span>
                  ),
                )}
                {missing.length > 0 && <span>{t("intent.missing", { items: missing.join(", ") })}</span>}
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
