import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/skills.json";
import { ApiError } from "@/lib/api";

const { push, create } = vi.hoisted(() => ({ push: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({ useCreateSkill: () => ({ mutate: create, isPending: false }) }));

import { CreateSkillModal } from "./CreateSkillModal";

afterEach(() => {
  cleanup();
  push.mockReset();
  create.mockReset();
});

const renderModal = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <CreateSkillModal onClose={onClose} />
    </NextIntlClientProvider>,
  );

const createButton = () => screen.getByRole("button", { name: /Create skill/ });

describe("CreateSkillModal", () => {
  it("rejects a non-kebab name before sending anything", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Name"), "Branch Coverage");
    await user.type(screen.getByPlaceholderText(/Describe what the reviewer must check/), "Rule");
    expect(screen.getByText(/single hyphens \(at most 64/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("creates the skill and opens it on its Preview tab", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    create.mockImplementation((_input, opts) => opts.onSuccess({ id: "s9" }));
    renderModal(onClose);
    await user.type(screen.getByLabelText("Name"), "edge-cases");
    await user.type(screen.getByLabelText("Description"), "Apply to every new test.");
    await user.selectOptions(screen.getByRole("combobox"), "rubric");
    await user.type(screen.getByPlaceholderText(/Describe what the reviewer must check/), "Check empty input.");
    await user.click(createButton());
    expect(create.mock.calls[0]![0]).toEqual({
      name: "edge-cases",
      description: "Apply to every new test.",
      type: "rubric",
      body: "Check empty input.",
    });
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/s9?tab=preview");
  });

  it("marks the name when it is already taken (409)", async () => {
    const user = userEvent.setup();
    create.mockImplementation((_input, opts) => opts.onError(new ApiError("taken", 409, "conflict")));
    renderModal();
    await user.type(screen.getByLabelText("Name"), "edge-cases");
    await user.type(screen.getByPlaceholderText(/Describe what the reviewer must check/), "x");
    await user.click(createButton());
    expect(screen.getByText("A skill with this name already exists.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
