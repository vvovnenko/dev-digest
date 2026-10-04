import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  caption: { fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 18px" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: (current: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "14px 18px",
    borderRadius: 10,
    border: "1px solid " + (current ? "var(--border-strong)" : "var(--border)"),
    background: "var(--bg-elevated)",
  }),
  versionTag: (current: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    background: current ? "var(--accent-bg)" : "var(--bg-hover)",
    color: current ? "var(--accent-text)" : "var(--text-secondary)",
  }),
  rowText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  note: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  date: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
