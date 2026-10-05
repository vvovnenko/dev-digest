/* ConfirmDeleteModal — "Delete skill" / "Delete agent" / "Remove repository": the
   title, one line that says what goes, then Cancel and a red Delete (or
   `confirmLabel`). Cancel, the ✕ and the backdrop close it; Delete calls onConfirm
   and spins while `pending`. Render it beside a card, not inside it: a disabled
   card's opacity would dim it, and its clicks would bubble to the card's onClick. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function ConfirmDeleteModal({
  title,
  message,
  onConfirm,
  onClose,
  pending = false,
  confirmLabel,
}: {
  title: React.ReactNode;
  message: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
  /** The delete is in flight: Delete spins and can't be pressed again. */
  pending?: boolean;
  /** The red button's text when "Delete" overstates it (a repo is only removed from DevDigest). */
  confirmLabel?: React.ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <Modal
      width={MODAL_WIDTH}
      title={title}
      subtitle={message}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button kind="danger" onClick={onConfirm} loading={pending}>
            {confirmLabel ?? t("actions.delete")}
          </Button>
        </div>
      }
    />
  );
}
