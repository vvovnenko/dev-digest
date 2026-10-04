import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionSkillDraft } from "@devdigest/shared";
import conventions from "../../../../../../../../messages/en/conventions.json";
import skills from "../../../../../../../../messages/en/skills.json";
import { ApiError } from "@/lib/api";

const DRAFT: ConventionSkillDraft = {
  name: "payments-api-conventions",
  description: "Apply to every change in payments-api.",
  type: "convention",
  body: "# payments-api-conventions\n\n## typed-errors\nRoute handlers throw AppErrors.",
  accepted_count: 2,
  name_taken: false,
};

const { push, create, draft } = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn(),
  draft: { data: undefined as ConventionSkillDraft | undefined, isLoading: false, isError: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/conventions", () => ({
  useConventionSkillDraft: () => ({ ...draft, refetch: vi.fn() }),
  useCreateConventionSkill: () => ({ mutate: create, isPending: false }),
}));

import { CreateConventionSkillModal } from "./CreateConventionSkillModal";

beforeEach(() => {
  draft.data = DRAFT;
  draft.isLoading = false;
});
afterEach(() => {
  cleanup();
  push.mockReset();
  create.mockReset();
});

const renderModal = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions, skills }}>
      <CreateConventionSkillModal repoId="r1" repoName="payments-api" onClose={onClose} />
    </NextIntlClientProvider>,
  );

const createButton = () => screen.getByRole("button", { name: "Create skill" });
const body = () => screen.getByLabelText("Skill body, Markdown");

describe("CreateConventionSkillModal", () => {
  it("prefills every field from the merged draft", () => {
    renderModal();
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(screen.getByText(/Merged from/).textContent).toBe(
      "Merged from 2 accepted conventions in payments-api. Everything below is editable before you save.",
    );
    expect(screen.getByLabelText("Name")).toHaveValue(DRAFT.name);
    expect(screen.getByLabelText("Description")).toHaveValue(DRAFT.description);
    expect(screen.getByRole("combobox")).toHaveValue("convention");
    expect(screen.getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
    expect(body()).toHaveValue(DRAFT.body);
    expect(screen.getByText("payments-api-conventions.md")).toBeInTheDocument();
    expect(createButton()).toBeEnabled();
  });

  it("sends the edited body and metadata, then opens the new skill", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    create.mockImplementation((_input, opts) => opts.onSuccess({ id: "s9" }));
    renderModal(onClose);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "payments-rules");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Apply to API handlers.");
    await user.selectOptions(screen.getByRole("combobox"), "rubric");
    await user.click(screen.getByRole("switch", { name: "Enabled" }));
    fireEvent.change(body(), { target: { value: "## Rule\nThrow AppErrors." } });
    expect(screen.getByText("payments-rules.md")).toBeInTheDocument();

    await user.click(createButton());
    expect(create.mock.calls[0]![0]).toEqual({
      repoId: "r1",
      skill: {
        name: "payments-rules",
        description: "Apply to API handlers.",
        type: "rubric",
        body: "## Rule\nThrow AppErrors.",
        enabled: false,
      },
    });
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/s9?tab=preview");
  });

  it("marks the name when it is already taken (409)", async () => {
    const user = userEvent.setup();
    create.mockImplementation((_input, opts) => opts.onError(new ApiError("taken", 409, "conflict")));
    renderModal();
    await user.click(createButton());
    expect(screen.getByText("A skill with this name already exists.")).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    expect(push).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Name"), "-v2");
    expect(screen.queryByText("A skill with this name already exists.")).not.toBeInTheDocument();
    expect(createButton()).toBeEnabled();
  });

  it("warns up front when the suggested name is taken, and blocks an invalid or empty form", async () => {
    const user = userEvent.setup();
    draft.data = { ...DRAFT, name_taken: true };
    renderModal();
    expect(screen.getByText("A skill with this name already exists.")).toBeInTheDocument();
    expect(createButton()).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), " X");
    expect(screen.getByText(/single hyphens \(at most 64/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "fine-name");
    fireEvent.change(body(), { target: { value: "   " } });
    expect(createButton()).toBeDisabled();
  });

  it("shows a skeleton until the draft arrives", () => {
    draft.data = undefined;
    draft.isLoading = true;
    renderModal();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("closes on Cancel without saving", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal(onClose);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
