import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PrDetailView } from "./_components/PrDetailView";

/* Route: /repos/:repoId/pulls/:number (PR detail). Thin route entry — the view
   lives in _components/PrDetailView, its data in usePrDetail. */
export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const [{ number }, t] = await Promise.all([params, getTranslations("shell.titles")]);
  return { title: t("pullRequest", { number }) };
}

export default function PrDetailPage() {
  return <PrDetailView />;
}
