/* AppShell.tsx — thin orchestrator: wires @devdigest/ui AppFrame to the command
   palette, shortcuts help, global keyboard shortcuts, and the shell context.
   All concerns live in ./hooks; overlay open/close is local view state, and the
   remove-repo confirm modal shows while `useRemoveRepo` has a target.
   Mounted once by the `(shell)` route-group layout, so navigating between pages
   keeps the frame, the palette and the shortcut listeners; each page sets its
   breadcrumb with `useShellCrumb`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppFrame, CommandPalette, ShortcutsHelp, type Crumb } from "@devdigest/ui";
import { ConfirmDeleteModal } from "../confirm-delete-modal";
import { ShellCrumbContext, useGlobalShortcuts, useRemoveRepo, useShellCommands, useShellContext } from "./hooks";

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("shell");
  const [crumb, setCrumb] = React.useState<Crumb[] | undefined>();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openHelp = React.useCallback(() => setHelpOpen(true), []);
  const closeHelp = React.useCallback(() => setHelpOpen(false), []);

  useGlobalShortcuts({ onOpenPalette: openPalette, onOpenHelp: openHelp });
  const commands = useShellCommands();
  const removeRepo = useRemoveRepo();
  const ctx = useShellContext({ onOpenCommandPalette: openPalette, onRemoveRepo: removeRepo.request });

  return (
    <ShellCrumbContext.Provider value={setCrumb}>
      <AppFrame ctx={ctx} crumb={crumb}>
        {children}
      </AppFrame>
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
      {removeRepo.target && (
        <ConfirmDeleteModal
          title={t("removeRepo.title")}
          message={t("removeRepo.confirm", { name: removeRepo.target.name ?? t("removeRepo.fallbackName") })}
          confirmLabel={t("removeRepo.action")}
          onConfirm={removeRepo.confirm}
          onClose={removeRepo.cancel}
          pending={removeRepo.pending}
        />
      )}
    </ShellCrumbContext.Provider>
  );
}
