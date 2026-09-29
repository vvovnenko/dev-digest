import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddRepoView } from "./_components/AddRepoView";

/* Add-repository route — /onboarding. Thin wrapper; the screen lives in
   _components/AddRepoView. Outside the `(shell)` group: no app frame here. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("onboarding") };
}

export default function AddRepoPage() {
  return <AddRepoView />;
}
