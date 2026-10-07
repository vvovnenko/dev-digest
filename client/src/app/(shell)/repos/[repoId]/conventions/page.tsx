import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConventionsView } from "./_components/ConventionsView";

/* Route: /repos/:repoId/conventions (Skills Lab → Conventions). Thin route
   entry — the view, its candidate cards and the create-skill modal live under
   _components/; confidence and evidence helpers are helpers.ts. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("conventions") };
}

export default function ConventionsPage() {
  return <ConventionsView />;
}
