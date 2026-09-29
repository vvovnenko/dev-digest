import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HomeView } from "./_components/HomeView";

/* Route: / — sends the user to the first repo's PR list, or onboarding. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("home") };
}

export default function HomePage() {
  return <HomeView />;
}
