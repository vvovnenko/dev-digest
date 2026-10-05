import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useSkillVersions: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillAgents: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { SkillEditor } from "./SkillEditor";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "",
  type: "rubric",
  source: "manual",
  body: "## Rule",
  enabled: true,
  version: 1,
  injection_detected: false,
};

const ui = (tab: string) => (
  <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
    <ToastProvider>
      <SkillEditor skill={SKILL} tab={tab} onTab={() => {}} />
    </ToastProvider>
  </NextIntlClientProvider>
);

describe("SkillEditor", () => {
  it("shows the Config, Preview and Versioning tabs — Stats is hidden until HW8", () => {
    render(ui("preview"));
    for (const name of ["Config", "Preview", "Versioning"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Stats" })).not.toBeInTheDocument();
  });

  it("keeps an unsaved Config draft across tab switches", async () => {
    const user = userEvent.setup();
    const { rerender } = render(ui("config"));
    await user.type(screen.getByLabelText("Skill body, Markdown"), "\nNew line");

    rerender(ui("preview"));
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();

    rerender(ui("config"));
    expect(screen.getByLabelText("Skill body, Markdown")).toHaveValue("## Rule\nNew line");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });
});
