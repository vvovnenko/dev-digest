import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills Lab — skill list). Thin route entry; the view, its
   cards, the Add Skill menu and their helpers live under _components/. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("skills") };
}

export default function SkillsPage() {
  return <SkillsListView />;
}
