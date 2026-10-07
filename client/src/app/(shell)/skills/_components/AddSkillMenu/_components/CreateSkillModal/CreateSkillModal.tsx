"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { SKILL_TYPES, isValidSkillName } from "@/lib/skills";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

/** Create-skill modal — name, description (the "When to apply" line), type, body. */
export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [nameTaken, setNameTaken] = React.useState(false);

  const nameValid = isValidSkillName(name);
  const canSubmit = nameValid && body.trim().length > 0 && !create.isPending;
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const nameHint = nameTaken
    ? <span style={s.error}>{t("create.nameTaken")}</span>
    : name && !nameValid
      ? <span style={s.error}>{t("create.nameInvalid")}</span>
      : t("create.nameHint");

  // A failure is toasted by the global mutation handler; a 409 also marks the name field.
  const submit = () =>
    create.mutate(
      { name, description, type, body },
      {
        onSuccess: (skill) => {
          onClose();
          router.push(`/skills/${skill.id}?tab=preview`);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setNameTaken(true);
        },
      },
    );

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={!canSubmit}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("create.name")} required hint={nameHint}>
          <TextInput
            value={name}
            onChange={(v) => {
              setName(v);
              setNameTaken(false);
            }}
            placeholder={t("create.namePlaceholder")}
            aria-label={t("create.name")}
            mono
          />
        </FormField>
        <FormField label={t("create.description")} hint={t("create.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("create.descriptionPlaceholder")}
            aria-label={t("create.description")}
          />
        </FormField>
        <FormField label={t("create.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={typeOptions} />
        </FormField>
        <FormField label={t("create.body")} required>
          <Textarea value={body} onChange={setBody} rows={10} mono placeholder={t("create.bodyPlaceholder")} />
        </FormField>
      </div>
    </Modal>
  );
}
