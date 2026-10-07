import type { CSSProperties } from "react";

/** Co-located styles for InjectionBanner. */
export const s = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 28px",
    background: "var(--crit-bg)",
    color: "var(--crit)",
    borderBottom: "1px solid var(--crit)",
    fontSize: 13,
    lineHeight: 1.45,
    flexShrink: 0,
  } satisfies CSSProperties,
  icon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  title: { fontWeight: 700, letterSpacing: "0.02em", marginBottom: 2 } satisfies CSSProperties,
} as const;
