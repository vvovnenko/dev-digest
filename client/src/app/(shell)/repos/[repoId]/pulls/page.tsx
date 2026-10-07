import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PullsListView } from "./_components/PullsListView";

/* Route: /repos/:repoId/pulls (PR list). Thin route entry — the view lives in
   _components/PullsListView; filtering/sorting are helpers.ts. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("pulls") };
}

export default function PullsPage() {
  return <PullsListView />;
}
