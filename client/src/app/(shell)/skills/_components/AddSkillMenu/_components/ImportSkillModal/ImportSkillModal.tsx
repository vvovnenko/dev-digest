/* ImportSkillModal — import a skill from a .md file or a .zip skill folder.
   An optional skill name comes first: typed, it is kept; blank, the file's name fills it.
   Step 1 picks a file (checked here, never sent if too big or the wrong type);
   step 2 shows the server's parsed draft — what the agent will receive, which
   archive files were left out and why, and the warnings — and saves only when
   the user confirms. Nothing in an archive is executed. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Markdown, Modal, SelectInput, TextInput } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { useCreateSkill, usePreviewSkillImport } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { SKILL_TYPES, estimateTokens, isValidSkillName, renderSkillBlock } from "@/lib/skills";
import { withoutImages } from "../../../../helpers";
import { ACCEPTED_EXTENSIONS, MODAL_WIDTH } from "./constants";
import { checkFile, dataUrlToBase64, type FileProblem } from "./helpers";
import { s } from "./styles";

interface Draft {
  description: string;
  type: SkillType;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(dataUrlToBase64(String(reader.result ?? "")));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ImportSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const parse = usePreviewSkillImport();
  const create = useCreateSkill();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<{ name: string; problem: FileProblem | null } | null>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [name, setName] = React.useState("");
  // The name was filled in from the parsed file, not typed: another file may replace it.
  const [nameFromFile, setNameFromFile] = React.useState(false);
  const [nameTaken, setNameTaken] = React.useState(false);

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const problem = checkFile(picked);
    setFile({ name: picked.name, problem });
    setPreview(null);
    setDraft(null);
    if (problem) return;
    const content = await readAsBase64(picked);
    parse.mutate(
      { filename: picked.name, content_base64: content },
      {
        onSuccess: (result) => {
          setPreview(result);
          setDraft({ description: result.draft.description, type: result.draft.type });
          if (!name.trim() || nameFromFile) {
            setName(result.draft.name);
            setNameFromFile(true);
            setNameTaken(result.name_taken);
          }
        },
      },
    );
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDraft(null);
    setNameTaken(false);
    if (nameFromFile) {
      setName("");
      setNameFromFile(false);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const editName = (v: string) => {
    setName(v);
    setNameFromFile(false);
    setNameTaken(false);
  };

  // Blank → the file's own name (frontmatter, folder or file stem).
  const skillName = name.trim() || preview?.draft.name || "";
  const nameValid = !name.trim() || isValidSkillName(name.trim());
  const block = preview && draft ? renderSkillBlock({ ...draft, name: skillName, body: preview.draft.body }) : "";
  const canSave = !!preview && !!draft && nameValid && isValidSkillName(skillName) && !nameTaken && !create.isPending;
  const nameHint = nameTaken ? (
    <span style={s.error}>{t("import.nameTaken")}</span>
  ) : !nameValid ? (
    <span style={s.error}>{t("create.nameInvalid")}</span>
  ) : (
    t("import.nameHint")
  );

  // A failure is toasted by the global mutation handler; a 409 also marks the name field.
  const save = () => {
    if (!preview || !draft || !file) return;
    create.mutate(
      { name: skillName, ...draft, body: preview.draft.body, source: "imported", imported_from: file.name },
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

  const typeOptions = SKILL_TYPES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }));
  const edit = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const footer = (
    <div style={s.footer}>
      {preview && (
        <Button kind="ghost" onClick={reset}>
          {t("import.another")}
        </Button>
      )}
      <Button kind="ghost" onClick={onClose}>
        {t("import.cancel")}
      </Button>
      <Button kind="primary" icon="Check" onClick={save} disabled={!canSave}>
        {create.isPending ? t("import.saving") : t("import.save")}
      </Button>
    </div>
  );

  return (
    <Modal width={MODAL_WIDTH} title={t("import.title")} subtitle={t("import.subtitle")} onClose={onClose} footer={footer}>
      <div style={s.body}>
        <FormField label={t("import.nameLabel")} hint={nameHint}>
          <TextInput
            value={name}
            onChange={editName}
            aria-label={t("import.nameLabel")}
            aria-invalid={nameTaken || !nameValid}
            mono
          />
        </FormField>

        {!preview && (
          <div style={s.chooser}>
            <Icon.Upload size={22} />
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(",")}
              style={s.hiddenInput}
              aria-label={t("import.choose")}
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button kind="secondary" icon="FileText" onClick={() => inputRef.current?.click()} disabled={parse.isPending}>
              {t("import.choose")}
            </Button>
            <div style={s.muted}>{t("import.accepted")}</div>
            {file?.problem === "too_large" && <div style={s.error}>{t("import.tooLarge", { name: file.name })}</div>}
            {file?.problem === "wrong_type" && <div style={s.error}>{t("import.wrongType")}</div>}
            {parse.isPending && file && <div style={s.muted}>{t("import.parsing", { name: file.name })}</div>}
            {parse.isError && <div style={s.error}>{t("import.failed")}</div>}
          </div>
        )}

        {preview && draft && (
          <>
            <div style={s.trust} role="note">
              <Icon.AlertTriangle size={16} />
              <div>
                <div style={s.trustTitle}>{t("import.trustTitle")}</div>
                {t("import.trustBody")}
              </div>
            </div>

            <div style={s.fields}>
              <FormField label={t("create.description")} hint={t("create.descriptionHint")}>
                <TextInput
                  value={draft.description}
                  onChange={(v) => edit({ description: v })}
                  aria-label={t("create.description")}
                />
              </FormField>
              <FormField label={t("create.type")}>
                <SelectInput value={draft.type} onChange={(v) => edit({ type: v as SkillType })} options={typeOptions} />
              </FormField>
            </div>

            {preview.warnings.length > 0 && (
              <div>
                <div style={s.sectionTitle}>{t("import.warningsTitle")}</div>
                <ul style={s.list}>
                  {preview.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>{t(`import.warnings.${w.code}`, { detail: w.detail ?? "" })}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.skipped.length > 0 && (
              <div>
                <div style={s.sectionTitle}>{t("import.skippedTitle", { count: preview.skipped.length })}</div>
                <ul style={s.list}>
                  {preview.skipped.map((f) => (
                    <li key={f.path}>
                      <span className="mono">{f.path}</span> — {t(`import.reasons.${f.reason}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div style={s.metaRow}>
                <span style={s.sectionTitle}>{t("import.bodyLabel")}</span>
                <span className="mono">{t("import.sourceFile", { file: preview.source_file })}</span>
                <span className="mono">{t("import.tokens", { count: estimateTokens(block) })}</span>
              </div>
              <div style={s.preview}>
                <Markdown>{withoutImages(block)}</Markdown>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
