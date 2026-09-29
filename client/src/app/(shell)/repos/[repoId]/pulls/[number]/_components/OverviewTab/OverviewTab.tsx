"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
}

export function OverviewTab({ prBody }: OverviewTabProps) {
  const t = useTranslations("prReview.overview");
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
