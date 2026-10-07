import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id (Agent Editor). Thin route entry — the view lives in
   _components/AgentEditorView. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell.titles");
  return { title: t("agentEditor") };
}

export default function AgentEditorPage() {
  return <AgentEditorView />;
}
