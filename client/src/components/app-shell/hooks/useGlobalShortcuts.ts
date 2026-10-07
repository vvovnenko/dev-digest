"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { NAV, SETTINGS_ITEM, resolveHref } from "@devdigest/ui";
import { useActiveRepo } from "../../../lib/repo-context";
import { G_NAV_TIMEOUT_MS } from "../constants";
import { isModalOpen, isTextInput } from "../../../lib/shortcut-guards";

interface GlobalShortcutHandlers {
  onOpenPalette: () => void;
  onOpenHelp: () => void;
}

/**
 * Binds the global keyboard shortcuts: Cmd/Ctrl+K opens the command
 * palette, `?` opens shortcuts help, and `g`-then-key navigates to a section.
 * Listens in the capture phase and stops the chord's second key, so a page
 * shortcut on the same key (`a` = accept a finding) never sees `g a`.
 * None of them act while a modal drawer or dialog is open (a confirm, a trace);
 * Cmd/Ctrl+K is still kept from the browser then.
 */
export function useGlobalShortcuts({ onOpenPalette, onOpenHelp }: GlobalShortcutHandlers): void {
  const router = useRouter();
  const { repoId } = useActiveRepo();

  React.useEffect(() => {
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const modal = isModalOpen();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!modal) onOpenPalette();
        return;
      }
      if (modal) {
        gPending = false;
        return;
      }
      if (isTextInput(e.target)) return;
      if (e.key === "?") {
        onOpenHelp();
        return;
      }
      if (e.key === "g") {
        gPending = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => (gPending = false), G_NAV_TIMEOUT_MS);
        return;
      }
      if (gPending) {
        gPending = false;
        e.preventDefault();
        e.stopPropagation();
        const target = NAV.flatMap((g) => g.items).find((it) => it.gKey === e.key);
        if (target) router.push(resolveHref(target.href, repoId));
        else if (e.key === SETTINGS_ITEM.gKey) router.push(SETTINGS_ITEM.href);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      clearTimeout(gTimer);
    };
  }, [router, repoId, onOpenPalette, onOpenHelp]);
}
