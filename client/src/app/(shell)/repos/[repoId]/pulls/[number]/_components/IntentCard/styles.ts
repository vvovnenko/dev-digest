import type { CSSProperties } from "react";

export const s = {
  // Accent as an inset shadow, not `borderLeft`: the vendored Card sets the `border` shorthand.
  card: { boxShadow: "inset 3px 0 0 var(--accent)" } satisfies CSSProperties,
  headRight: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  // The design quotes the summary in italics.
  summary: {
    margin: 0,
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 18,
    marginTop: 16,
  } satisfies CSSProperties,
  // The design: a green ✓ over "In scope", a muted ✕ over "Out of scope".
  colLabel: (kind: "in" | "out") =>
    ({
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: kind === "in" ? "var(--ok)" : "var(--text-muted)",
      marginBottom: 8,
    }) satisfies CSSProperties,
  list: { margin: 0, padding: 0, listStyle: "none", fontSize: 13, lineHeight: 1.55 } satisfies CSSProperties,
  item: (kind: "in" | "out") =>
    ({
      display: "flex",
      gap: 8,
      color: kind === "in" ? "var(--text-secondary)" : "var(--text-muted)",
    }) satisfies CSSProperties,
  dot: (kind: "in" | "out") =>
    ({ flexShrink: 0, color: kind === "in" ? "var(--ok)" : "var(--text-muted)" }) satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  hint: { marginTop: 12, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  sources: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  source: { display: "inline-flex", alignItems: "center", gap: 5 } satisfies CSSProperties,
  sourceUnavailable: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 13,
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  error: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    fontSize: 13,
    color: "var(--failed)",
  } satisfies CSSProperties,
  deriving: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 } satisfies CSSProperties,
  derivingText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
