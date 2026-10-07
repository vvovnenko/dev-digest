/* ImportSkillUrlModal — import a skill from an https URL. The server fetches the file,
   parses it like an upload, checks it for prompt injection and saves it at once (no
   preview); a flagged skill is saved blocked and opens on its Config tab to be cleaned. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, TextInput } from "@devdigest/ui";
import { useImportSkillFromUrl } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { isValidSkillName } from "@/lib/skills";
import { MODAL_WIDTH } from "./constants";
import { importedSkillPath, isImportableUrl, toImportRequest } from "./helpers";
import { s } from "./styles";

export function ImportSkillUrlModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const importUrl = useImportSkillFromUrl();
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [nameTaken, setNameTaken] = React.useState(false);

  const urlValid = isImportableUrl(url);
  const nameBlank = name.trim().length === 0;
  const nameValid = nameBlank || isValidSkillName(name);
  const canSubmit = urlValid && nameValid && !importUrl.isPending;

  const urlHint = url.trim() && !urlValid ? <span style={s.error}>{t("importUrl.urlInvalid")}</span> : undefined;
  const nameHint = nameTaken
    ? <span style={s.error}>{t("create.nameTaken")}</span>
    : !nameValid
      ? <span style={s.error}>{t("create.nameInvalid")}</span>
      : t("importUrl.nameHint");

  // A failure is toasted by the global mutation handler; a 409 also marks the name field.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    importUrl.mutate(toImportRequest(url, name), {
      onSuccess: (skill) => {
        onClose();
        router.push(importedSkillPath(skill));
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) setNameTaken(true);
      },
    });
  };

  return (
    <Modal width={MODAL_WIDTH} title={t("importUrl.title")} subtitle={t("importUrl.subtitle")} onClose={onClose}>
      <form style={s.body} onSubmit={submit} noValidate>
        <FormField label={t("importUrl.nameLabel")} hint={nameHint}>
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              setNameTaken(false);
            }}
            aria-label={t("importUrl.nameLabel")}
            aria-invalid={nameTaken || !nameValid}
            mono
          />
        </FormField>
        <FormField label={t("importUrl.urlLabel")} required hint={urlHint}>
          <TextInput
            value={url}
            onChange={setUrl}
            placeholder={t("importUrl.urlPlaceholder")}
            aria-label={t("importUrl.urlLabel")}
            aria-invalid={!!urlHint}
            inputMode="url"
            mono
          />
        </FormField>
        <Button type="submit" kind="primary" icon="Link" full disabled={!canSubmit}>
          {importUrl.isPending ? t("importUrl.importing") : t("importUrl.submit")}
        </Button>
      </form>
    </Modal>
  );
}
