/* LineNumberedEditor — a plain markdown textarea with a line-number gutter and a
   header (file name, "unsaved", token estimate). The vendored Textarea takes no
   ref or onScroll, so this uses a raw <textarea> and keeps the gutter scrolled
   with it. No syntax highlighting. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import { lineCount } from "./helpers";
import { s } from "./styles";

export function LineNumberedEditor({
  fileName,
  value,
  onChange,
  unsaved,
  tokens,
  label,
}: {
  fileName: string;
  value: string;
  onChange: (v: string) => void;
  unsaved: boolean;
  tokens: number;
  /** Accessible name of the textarea. */
  label: string;
}) {
  const t = useTranslations("skills");
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lines = lineCount(value);

  return (
    <div style={s.frame}>
      <div style={s.header}>
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono">{fileName}</span>
        {unsaved && <Badge color="var(--text-secondary)">{t("config.unsaved")}</Badge>}
        <span className="mono tnum" style={s.tokens}>
          {t("config.tokens", { count: tokens })}
        </span>
      </div>
      <div style={s.body}>
        <div ref={gutterRef} aria-hidden="true" className="mono tnum" style={s.gutter}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="mono"
          aria-label={label}
          value={value}
          wrap="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          style={s.textarea}
        />
      </div>
    </div>
  );
}
