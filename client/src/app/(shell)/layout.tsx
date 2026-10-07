import { AppShell } from "@/components/app-shell";

/* Route group layout for every screen inside the app frame (everything but
   onboarding). The shell mounts once here, so navigation keeps the frame, the
   command palette and the global shortcut listeners; pages set the breadcrumb
   with `useShellCrumb`. The group adds nothing to the URL. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
