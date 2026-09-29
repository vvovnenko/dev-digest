"use client";

/* Error boundary for every screen in the app frame: a page that throws while
   rendering shows this inside the shell (sidebar and palette keep working)
   instead of a blank screen. `reset` re-renders the segment. */
import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("shell.errors");
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState fullScreen title={t("title")} body={t("body")} onRetry={reset} />;
}
