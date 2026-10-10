"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { useDeriveIntent, usePrIntent } from "@/lib/hooks";
import { IntentCard } from "../IntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  prBody: string | null | undefined;
}

export function OverviewTab({ prId, prBody }: OverviewTabProps) {
  const t = useTranslations("prReview.overview");
  const intent = usePrIntent(prId);
  const derive = useDeriveIntent();
  return (
    <>
      <IntentCard
        state={intent.data}
        loading={intent.isLoading}
        onDerive={() => derive.mutate(prId)}
        deriving={derive.isPending}
      />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
