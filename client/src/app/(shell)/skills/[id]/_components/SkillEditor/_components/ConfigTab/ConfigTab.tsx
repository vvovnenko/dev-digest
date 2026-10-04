"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { LineNumberedEditor } from "@/components/line-numbered-editor";
import { SKILL_TYPES, estimateTokens, isValidSkillName, renderSkillBlock } from "@/lib/skills";
import { changedFields, mergeDraft, type SkillDraft } from "./helpers";
import { s } from "./styles";

/**
 * Config tab — enabled, name, description (the "When to apply" line), type and
 * the markdown body. Like the agent ConfigTab, the form keeps only what the user
 * changed (`draft`) over the cached skill and Save sends only the fields that
 * differ; the parent keys it by skill id, so each skill starts a fresh draft.
 * Saving a content change creates a new version.
 */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [draft, setDraft] = React.useState<SkillDraft>({});
  const [nameTaken, setNameTaken] = React.useState(false);
  const edit =
    <K extends keyof SkillDraft>(key: K) =>
    (value: SkillDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value }));

  const form = mergeDraft(skill, draft);
  const patch = changedFields(skill, draft);
  const dirty = Object.keys(patch).length > 0;
  const nameValid = isValidSkillName(form.name);
  const bodyFilled = form.body.trim().length > 0;
  const tokens = estimateTokens(renderSkillBlock(form));
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));

  const nameHint = nameTaken ? (
    <span style={s.error}>{t("create.nameTaken")}</span>
  ) : !nameValid ? (
    <span style={s.error}>{t("create.nameInvalid")}</span>
  ) : undefined;

  const save = () => {
    const sent = patch;
    update.mutate(
      { id: skill.id, patch: sent },
      {
        // Failures are toasted globally; a 409 also marks the name field.
        onSuccess: (data) => {
          // Drop what was saved; keep anything typed while the request was in flight.
          setDraft((d) => {
            const rest: SkillDraft = { ...d };
            for (const key of Object.keys(sent) as (keyof SkillDraft)[]) {
              if (rest[key] === sent[key]) delete rest[key];
            }
            return rest;
          });
          toast.success(t("config.savedToast", { version: data.version }));
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setNameTaken(true);
        },
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <Badge color="var(--text-secondary)" icon="GitCommit" mono>
          {t("editor.version", { version: skill.version })}
        </Badge>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={form.enabled} onChange={edit("enabled")} size={16} />
        </label>
      </div>
      <FormField label={t("config.name")} required hint={nameHint}>
        <TextInput
          value={form.name}
          onChange={(v) => {
            edit("name")(v);
            setNameTaken(false);
          }}
          aria-label={t("config.name")}
          mono
        />
      </FormField>
      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={form.description} onChange={edit("description")} aria-label={t("config.description")} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput value={form.type} onChange={(v) => edit("type")(v as SkillType)} options={typeOptions} />
      </FormField>
      <FormField label={t("config.body")} required>
        <LineNumberedEditor
          fileName={`${form.name || skill.name}.md`}
          value={form.body}
          onChange={edit("body")}
          unsaved={patch.body !== undefined}
          tokens={tokens}
          label={t("config.bodyLabel")}
        />
      </FormField>
      <div style={s.actions}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={update.isPending || !dirty || !nameValid || !bodyFilled}
        >
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        <Button kind="ghost" onClick={() => setDraft({})} disabled={!dirty || update.isPending}>
          {t("config.cancel")}
        </Button>
        {update.isSuccess && <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>}
      </div>
    </div>
  );
}
