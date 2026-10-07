import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/skills.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewSkillImport: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useImportSkillFromUrl: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AddSkillMenu } from "./AddSkillMenu";

afterEach(cleanup);

const renderMenu = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <AddSkillMenu />
    </NextIntlClientProvider>,
  );

describe("AddSkillMenu", () => {
  it("offers create, file import and URL import, in that order", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /Add Skill/ }));
    const items = screen.getAllByRole("button").filter((b) => !/Add Skill/.test(b.textContent ?? ""));
    expect(items.map((b) => b.textContent)).toEqual(["Create from scratch", "Import file…", "Import from URL"]);
  });

  it("opens the file import as a modal from the second item", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /Add Skill/ }));
    await user.click(screen.getByRole("button", { name: "Import file…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Import a skill")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Choose file…" })).toBeInTheDocument();
  });

  it("opens the URL import modal from the third item", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: /Add Skill/ }));
    await user.click(screen.getByRole("button", { name: "Import from URL" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Import skill from URL")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("URL (https:// only)")).toBeInTheDocument();
    // The menu closed behind it, so the only "Import from URL" left is the modal's button.
    expect(screen.getAllByRole("button", { name: "Import from URL" })).toHaveLength(1);
  });
});
