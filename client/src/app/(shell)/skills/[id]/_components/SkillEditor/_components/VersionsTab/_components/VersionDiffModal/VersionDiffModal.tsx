/* VersionDiffModal — what changed between an older version and the current
   skill: name / description / type, then a +/- line diff of the body. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { MODAL_WIDTH } from "./constants";
import { fieldChanges, lineDiff } from "./helpers";
import { s } from "./styles";

const MARK = { same: " ", add: "+", del: "-" } as const;

export function VersionDiffModal({
  from,
  current,
  onClose,
}: {
  from: SkillVersion;
  current: Skill;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const fields = fieldChanges(from, current);
  const lines = lineDiff(from.body, current.body);
  const bodyChanged = from.body !== current.body;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("versions.diffTitle", { from: from.version, to: current.version })}
      subtitle={t("versions.diffSubtitle", { from: from.version })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("versions.close")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {fields.length === 0 && !bodyChanged && <div style={s.muted}>{t("versions.noChanges")}</div>}
        {fields.length > 0 && (
          <ul style={s.fields}>
            {fields.map((f) => (
              <li key={f.field}>
                <strong>{t(`versions.fields.${f.field}`)}</strong>: <span className="mono">{f.from || "—"}</span> →{" "}
                <span className="mono">{f.to || "—"}</span>
              </li>
            ))}
          </ul>
        )}
        {bodyChanged && (
          <div>
            <div style={s.sectionTitle}>{t("versions.fields.body")}</div>
            {lines === null ? (
              <div style={s.muted}>{t("versions.tooLarge")}</div>
            ) : (
              <div className="mono" style={s.diff}>
                {lines.map((l, i) => (
                  <div key={i} style={s.line(l.kind)}>
                    {MARK[l.kind]} {l.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
