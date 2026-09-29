/* AppShell.tsx — thin orchestrator: wires @devdigest/ui AppFrame to the command
   palette, shortcuts help, global keyboard shortcuts, and the shell context.
   All concerns live in ./hooks; overlay open/close is local view state.
   Mounted once by the `(shell)` route-group layout, so navigating between pages
   keeps the frame, the palette and the shortcut listeners; each page sets its
   breadcrumb with `useShellCrumb`. */
"use client";

import React from "react";
import { AppFrame, CommandPalette, ShortcutsHelp, type Crumb } from "@devdigest/ui";
import { ShellCrumbContext, useGlobalShortcuts, useShellCommands, useShellContext } from "./hooks";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [crumb, setCrumb] = React.useState<Crumb[] | undefined>();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const openPalette = React.useCallback(() => setPaletteOpen(true), []);
  const closePalette = React.useCallback(() => setPaletteOpen(false), []);
  const openHelp = React.useCallback(() => setHelpOpen(true), []);
  const closeHelp = React.useCallback(() => setHelpOpen(false), []);

  useGlobalShortcuts({ onOpenPalette: openPalette, onOpenHelp: openHelp });
  const commands = useShellCommands();
  const ctx = useShellContext({ onOpenCommandPalette: openPalette });

  return (
    <ShellCrumbContext.Provider value={setCrumb}>
      <AppFrame ctx={ctx} crumb={crumb}>
        {children}
      </AppFrame>
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      <ShortcutsHelp open={helpOpen} onClose={closeHelp} />
    </ShellCrumbContext.Provider>
  );
}
