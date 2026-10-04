/* CreateConventionSkillModal — "Create skill from conventions". The accepted
   candidates arrive merged into one draft (fetched fresh on open); every field
   stays editable — name, description, type, enabled and the body, whose token
   count is the agent's prompt block. Create saves v1 and opens the new skill on
   its Preview tab; a taken name (409) marks the Name field. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  ErrorState,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillCreate, ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { LineNumberedEditor } from "@/components/line-numbered-editor";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { ApiError } from "@/lib/api";
import { SKILL_TYPES, estimateTokens, isValidSkillName, renderSkillBlock } from "@/lib/skills";
import { MODAL_WIDTH, SKELETON_ROWS } from "./constants";
import { s } from "./styles";

/** Every field the user can edit before saving — the body of POST …/conventions/skill. */
type SkillForm = Required<ConventionSkillCreate>;

/** The form as the draft fills it; the new skill starts enabled. */
function formFromDraft(d: ConventionSkillDraft): SkillForm {
  return { name: d.name, description: d.description, type: d.type, body: d.body, enabled: true };
}

export function CreateConventionSkillModal({
  repoId,
  repoName,
  onClose,
}: {
  repoId: string;
  /** Shown in the "Merged from … in <repo>" banner. */
  repoName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const tSkills = useTranslations("skills");
  const router = useRouter();
  const draft = useConventionSkillDraft(repoId);
  const create = useCreateConventionSkill();
  // Only what the user changed, laid over the draft (like the skill ConfigTab).
  const [edits, setEdits] = React.useState<Partial<SkillForm>>({});
  const [nameTaken, setNameTaken] = React.useState(false);
  const edit =
    <K extends keyof SkillForm>(key: K) =>
    (value: SkillForm[K]) =>
      setEdits((e) => ({ ...e, [key]: value }));

  const form = draft.data ? { ...formFromDraft(draft.data), ...edits } : null;
  const nameValid = !!form && isValidSkillName(form.name);
  // The draft already knows whether its suggested name is taken; a 409 covers the rest.
  const taken = nameTaken || (!!draft.data?.name_taken && form?.name === draft.data.name);
  const canCreate = !!form && nameValid && !taken && form.body.trim().length > 0 && !create.isPending;
  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: tSkills(`listItem.type.${v}`) }));

  const nameHint = taken ? (
    <span style={s.error}>{t("modal.nameTaken")}</span>
  ) : form && !nameValid ? (
    <span style={s.error}>{t("modal.nameInvalid")}</span>
  ) : undefined;

  // A failure is toasted by the global mutation handler; a 409 also marks the name field.
  const submit = () => {
    if (!form) return;
    create.mutate(
      { repoId, skill: form },
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
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("modal.title")}
      subtitle={form ? <span className="mono">{form.name}</span> : undefined}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <span style={s.savedAs}>
            <Icon.GitCommit size={14} />
            <span>{t.rich("modal.savedAs", { strong: (chunks) => <strong style={s.strong}>{chunks}</strong> })}</span>
          </span>
          <Button kind="secondary" onClick={onClose}>
            {t("modal.cancel")}
          </Button>
          <Button kind="primary" icon="Sparkles" onClick={submit} loading={create.isPending} disabled={!canCreate}>
            {create.isPending ? t("modal.creating") : t("modal.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {draft.isLoading && (
          <div style={s.loading}>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} height={i === SKELETON_ROWS - 1 ? 220 : 40} />
            ))}
          </div>
        )}
        {draft.isError && <ErrorState body={t("modal.loadError")} onRetry={() => void draft.refetch()} />}
        {form && draft.data && (
          <>
            <div style={s.banner}>
              <Icon.Wrench size={16} style={s.bannerIcon} />
              <span>
                {t.rich("modal.banner", {
                  count: draft.data.accepted_count,
                  repo: repoName,
                  strong: (chunks) => <strong style={s.strong}>{chunks}</strong>,
                  code: (chunks) => (
                    <span className="mono" style={s.bannerRepo}>
                      {chunks}
                    </span>
                  ),
                })}
              </span>
            </div>

            <FormField label={t("modal.name")} required hint={nameHint}>
              <TextInput
                value={form.name}
                onChange={(v) => {
                  edit("name")(v);
                  setNameTaken(false);
                }}
                aria-label={t("modal.name")}
                mono
              />
            </FormField>
            <FormField label={t("modal.description")}>
              <TextInput value={form.description} onChange={edit("description")} aria-label={t("modal.description")} />
            </FormField>
            <div style={s.columns}>
              <FormField label={t("modal.type")}>
                <SelectInput value={form.type} onChange={(v) => edit("type")(v as SkillType)} options={typeOptions} />
              </FormField>
              <FormField label={t("modal.enabled")} hint={t("modal.enabledHint")}>
                {/* A <label> names the vendored Toggle's button for screen readers. */}
                <label style={s.toggleLabel}>
                  <span style={s.visuallyHidden}>{t("modal.enabled")}</span>
                  <Toggle on={form.enabled} onChange={edit("enabled")} />
                </label>
              </FormField>
            </div>
            <FormField label={t("modal.body")} required>
              <LineNumberedEditor
                fileName={`${form.name}.md`}
                value={form.body}
                onChange={edit("body")}
                unsaved
                tokens={estimateTokens(renderSkillBlock(form))}
                label={t("modal.bodyLabel")}
              />
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
