"use client";

import React from "react";
import type { Crumb } from "@devdigest/ui";

/** Set by AppShell (mounted once by the `(shell)` layout); pages publish their breadcrumb into it. */
export const ShellCrumbContext = React.createContext<((crumb: Crumb[] | undefined) => void) | null>(null);

// Layout effect so the breadcrumb changes in the same paint as the page (no flash of the old one).
const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Show `crumb` in the app shell while the calling page is mounted. Compared by
 * value, so passing a fresh array each render doesn't re-render the shell.
 * Outside the shell (unit tests) it does nothing.
 */
export function useShellCrumb(crumb: Crumb[]): void {
  const setCrumb = React.useContext(ShellCrumbContext);
  const key = JSON.stringify(crumb);
  useIsomorphicLayoutEffect(() => {
    if (!setCrumb) return;
    setCrumb(JSON.parse(key) as Crumb[]);
    return () => setCrumb(undefined);
  }, [setCrumb, key]);
}
