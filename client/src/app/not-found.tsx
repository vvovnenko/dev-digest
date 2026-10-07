"use client";

/* Unknown URLs (and notFound() anywhere). Rendered in the root layout, outside
   the app frame, with a way back in. */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export default function NotFound() {
  const t = useTranslations("shell.errors");
  const router = useRouter();
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <EmptyState
        icon="Search"
        title={t("notFoundTitle")}
        body={t("notFoundBody")}
        cta={t("home")}
        onCta={() => router.push("/")}
      />
    </main>
  );
}
