import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { maxWidth: 900, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  metric: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "18px 22px",
    width: 240,
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: { fontSize: 30, fontWeight: 700, marginTop: 8 } satisfies CSSProperties,
  metricUnit: { fontSize: 16, fontWeight: 500, color: "var(--text-secondary)", marginLeft: 6 } satisfies CSSProperties,
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: "16px 18px",
  } satisfies CSSProperties,
  panelTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 12,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    marginBottom: 8,
  } satisfies CSSProperties,
  rowIcon: { color: "var(--accent)" } satisfies CSSProperties,
  rowName: { fontSize: 14, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  open: { fontSize: 13, color: "var(--accent-text)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
