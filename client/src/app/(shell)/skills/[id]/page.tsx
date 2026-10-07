import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SkillEditorView } from "./_components/SkillEditorView";

/* Route: /skills/:id (Skill editor). Thin route entry — the view lives in
   _components/SkillEditorView. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("skillEditor") };
}

export default function SkillEditorPage() {
  return <SkillEditorView />;
}
