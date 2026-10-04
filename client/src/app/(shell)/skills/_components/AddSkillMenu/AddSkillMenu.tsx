/* AddSkillMenu — "Add Skill ▾": create a skill from scratch, import a .md / .zip
   file or import from an https URL. Owns the three modals it opens. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown } from "@devdigest/ui";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillModal } from "./_components/ImportSkillModal";
import { ImportSkillUrlModal } from "./_components/ImportSkillUrlModal";

type Mode = "create" | "import" | "url" | null;

export function AddSkillMenu({ label }: { label?: string }) {
  const t = useTranslations("skills");
  const [mode, setMode] = React.useState<Mode>(null);
  const close = () => setMode(null);

  return (
    <>
      {mode === "create" && <CreateSkillModal onClose={close} />}
      {mode === "import" && <ImportSkillModal onClose={close} />}
      {mode === "url" && <ImportSkillUrlModal onClose={close} />}
      <Dropdown
        width={220}
        align="right"
        trigger={
          <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
            {label ?? t("page.addSkill")}
          </Button>
        }
        items={[
          { label: t("menu.create"), icon: "Edit", onClick: () => setMode("create") },
          { label: t("menu.import"), icon: "Upload", onClick: () => setMode("import") },
          { label: t("importUrl.menuItem"), icon: "Link", onClick: () => setMode("url") },
        ]}
      />
    </>
  );
}
