import type { CSSProperties } from "react";

/** Co-located styles for ScanStatus (one line under the Conventions subtitle). */
export const s = {
  line: (color: string) =>
    ({
      display: "flex",
      alignItems: "flex-start",
      gap: 6,
      fontSize: 13,
      lineHeight: 1.4,
      color,
      marginTop: 6,
      overflowWrap: "anywhere",
    }) satisfies CSSProperties,
  icon: { flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  spinner: {
    flexShrink: 0,
    marginTop: 2,
    color: "var(--accent)",
    animation: "ddspin 1s linear infinite",
  } satisfies CSSProperties,
} as const;
