import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS } from "@devdigest/ui";
import type { Repo } from "@/lib/types";
import { activeKeyFor, toShellRepo } from "./helpers";

describe("app-shell helpers", () => {
  it("maps a repo to the shell's summary, with its sync state", () => {
    const repo = {
      id: "r1",
      full_name: "acme/app",
      default_branch: "main",
      last_polled_at: "2026-09-28T10:00:00Z",
    } as Repo;
    expect(toShellRepo(repo)).toEqual({ id: "r1", full_name: "acme/app", default_branch: "main", syncedLabel: "synced" });
    expect(toShellRepo({ ...repo, last_polled_at: null }).syncedLabel).toBe("not synced");
  });

  it("derives the active sidebar item from the path", () => {
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/pulls/482")).toBe("pulls");
    expect(activeKeyFor("/agents/a1")).toBe("agents");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/skills/s1")).toBe("skills");
    expect(activeKeyFor("/settings/api-keys")).toBe("settings");
    expect(activeKeyFor("/onboarding")).toBe("onboarding-tour");
    expect(activeKeyFor("/")).toBe("");
  });

  it("lists Skills then Agents under SKILLS LAB, each with a g-shortcut", () => {
    const lab = NAV.find((g) => g.section === "SKILLS LAB");
    expect(lab?.items.map((it) => [it.key, it.href, it.gKey])).toEqual([
      ["skills", "/skills", "s"],
      ["agents", "/agents", "a"],
    ]);
    expect(NAV.flatMap((g) => g.items).filter((it) => it.key === "agents")).toHaveLength(1);
    expect(SHORTCUTS.some((sc) => sc.keys === "g s")).toBe(true);
  });
});
