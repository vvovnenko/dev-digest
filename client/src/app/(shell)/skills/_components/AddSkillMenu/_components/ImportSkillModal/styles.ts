import type { CSSProperties } from "react";

/** Co-located styles for ImportSkillModal. */
export const s = {
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  hiddenInput: { display: "none" } satisfies CSSProperties,
  chooser: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 10,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    textAlign: "center",
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  trust: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  trustTitle: { fontWeight: 650, marginBottom: 2 } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  sectionTitle: { fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-secondary)" } satisfies CSSProperties,
  list: { margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 } satisfies CSSProperties,
  preview: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "14px 16px",
    background: "var(--bg-surface)",
    fontSize: 13,
    maxHeight: 360,
    overflow: "auto",
  } satisfies CSSProperties,
  fields: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
} as const;
