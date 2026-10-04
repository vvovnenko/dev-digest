import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/skills.json";

const { restore, versions } = vi.hoisted(() => ({ restore: vi.fn(), versions: { data: [] as SkillVersion[] } }));
vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: versions.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: restore, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  restore.mockReset();
  vi.restoreAllMocks();
});

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "Apply to branches.",
  type: "rubric",
  source: "manual",
  body: "## Rule\nCap at 5 findings.",
  enabled: true,
  version: 2,
  injection_detected: false,
};

const version = (v: number, note: string, body: string, description = "Apply to branches."): SkillVersion => ({
  skill_id: "s1",
  version: v,
  name: "branch-coverage",
  description,
  type: "rubric",
  body,
  note,
  created_at: `2026-09-2${v}T10:00:00Z`,
});

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }} timeZone="UTC">
      <VersionsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );

describe("VersionsTab", () => {
  it("lists versions newest first and marks the current one", () => {
    versions.data = [version(2, "Edited body", SKILL.body), version(1, "Created", "## Rule", "Old")];
    renderTab();
    expect(screen.getByText("2 versions")).toBeInTheDocument();
    expect(screen.getByText("Edited body")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    // Only the older version can be diffed or restored.
    expect(screen.getAllByRole("button", { name: /Diff/ })).toHaveLength(1);
  });

  it("diffs an older version against the current skill", async () => {
    const user = userEvent.setup();
    versions.data = [version(2, "Edited body", SKILL.body), version(1, "Created", "## Rule", "Old")];
    renderTab();
    await user.click(screen.getByRole("button", { name: /Diff/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("v1 → v2")).toBeInTheDocument();
    expect(within(dialog).getByText("+ Cap at 5 findings.")).toBeInTheDocument();
    expect(within(dialog).getByText("Description")).toBeInTheDocument();
  });

  it("restores a version after confirming", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    versions.data = [version(2, "Edited body", SKILL.body), version(1, "Created", "## Rule")];
    renderTab();
    await user.click(screen.getByRole("button", { name: /Restore/ }));
    expect(confirm.mock.calls[0]![0]).toContain("Restore v1?");
    expect(restore).toHaveBeenCalledWith({ id: "s1", version: 1 });
  });
});
