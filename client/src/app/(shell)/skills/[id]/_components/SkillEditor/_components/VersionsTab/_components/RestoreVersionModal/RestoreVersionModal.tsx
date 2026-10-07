/* RestoreVersionModal — "Restore vN?": what restoring does, then Cancel and Restore.
   Cancel, the ✕ and the backdrop close it; Restore calls onConfirm and spins while
   `pending`. Closing after a successful restore is the caller's job. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function RestoreVersionModal({
  version,
  onConfirm,
  onClose,
  pending = false,
}: {
  version: number;
  onConfirm: () => void;
  onClose: () => void;
  /** The restore is in flight: Restore spins and can't be pressed again. */
  pending?: boolean;
}) {
  const t = useTranslations("skills");
  const tCommon = useTranslations("common");
  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("versions.confirmRestore", { version })}
      subtitle={t("versions.confirmRestoreBody")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {tCommon("actions.cancel")}
          </Button>
          <Button kind="primary" icon="History" onClick={onConfirm} loading={pending}>
            {t("versions.restore")}
          </Button>
        </div>
      }
    />
  );
}
