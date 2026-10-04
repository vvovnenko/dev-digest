import type { CSSProperties } from "react";

const LINE_HEIGHT = 22;

/** Co-located styles for LineNumberedEditor. */
export const s = {
  frame: {
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    background: "var(--code-bg)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  tokens: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  body: { display: "flex", height: 420 } satisfies CSSProperties,
  gutter: {
    padding: "12px 10px 12px 14px",
    textAlign: "right",
    color: "var(--text-muted)",
    fontSize: 13,
    lineHeight: `${LINE_HEIGHT}px`,
    userSelect: "none",
    overflow: "hidden",
    minWidth: 44,
    flexShrink: 0,
  } satisfies CSSProperties,
  textarea: {
    flex: 1,
    resize: "none",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    padding: "12px 14px 12px 6px",
    fontSize: 13,
    lineHeight: `${LINE_HEIGHT}px`,
    whiteSpace: "pre",
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
