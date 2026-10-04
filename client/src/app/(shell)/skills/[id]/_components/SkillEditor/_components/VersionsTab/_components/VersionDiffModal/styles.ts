import type { CSSProperties } from "react";

/** Co-located styles for VersionDiffModal. */
export const s = {
  body: { padding: 20, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
  fields: { margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 } satisfies CSSProperties,
  sectionTitle: { fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 } satisfies CSSProperties,
  diff: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--code-bg)",
    fontSize: 12.5,
    lineHeight: "20px",
    maxHeight: 460,
    overflow: "auto",
    padding: "8px 0",
  } satisfies CSSProperties,
  line: (kind: "same" | "add" | "del"): CSSProperties => ({
    whiteSpace: "pre",
    padding: "0 14px",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-secondary)",
    background: kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent",
  }),
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
