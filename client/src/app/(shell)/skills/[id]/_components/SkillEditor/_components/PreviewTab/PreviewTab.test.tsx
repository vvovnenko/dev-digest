import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/skills.json";
import { PreviewTab } from "./PreviewTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "s1",
  name: "branch-coverage",
  description: "Apply when the diff adds a branch.",
  type: "rubric",
  source: "manual",
  body: "## Rule\nFlag it. ![x](https://tracker.test/p.gif)",
  enabled: true,
  version: 1,
};

const renderTab = (skill: Skill = SKILL) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <PreviewTab skill={skill} />
    </NextIntlClientProvider>,
  );

describe("PreviewTab", () => {
  it("renders the block the agent receives, with its token estimate", () => {
    renderTab();
    expect(screen.getByRole("heading", { level: 3, name: "branch-coverage" })).toBeInTheDocument();
    expect(screen.getByText("When to apply: Apply when the diff adds a branch.")).toBeInTheDocument();
    expect(screen.getByText(/^\+\d+ tokens$/)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("says when no agent receives it", () => {
    renderTab({ ...SKILL, enabled: false });
    expect(screen.getByText(/Disabled — no agent receives this skill/)).toBeInTheDocument();
  });
});
