/* AddSkillMenu — "Add Skill ▾": create a skill from scratch or import a .md / .zip
   file. Owns the create modal and the import drawer it opens. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown } from "@devdigest/ui";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillDrawer } from "./_components/ImportSkillDrawer";

type Mode = "create" | "import" | null;

export function AddSkillMenu({ label }: { label?: string }) {
  const t = useTranslations("skills");
  const [mode, setMode] = React.useState<Mode>(null);
  const close = () => setMode(null);

  return (
    <>
      {mode === "create" && <CreateSkillModal onClose={close} />}
      {mode === "import" && <ImportSkillDrawer onClose={close} />}
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
        ]}
      />
    </>
  );
}
