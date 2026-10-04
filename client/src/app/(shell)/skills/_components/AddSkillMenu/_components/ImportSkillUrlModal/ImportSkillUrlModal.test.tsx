import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/skills.json";
import { ApiError } from "@/lib/api";

const { push, importUrl, state } = vi.hoisted(() => ({
  push: vi.fn(),
  importUrl: vi.fn(),
  state: { isPending: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useImportSkillFromUrl: () => ({ mutate: importUrl, isPending: state.isPending }),
}));

import { ImportSkillUrlModal } from "./ImportSkillUrlModal";

afterEach(() => {
  cleanup();
  push.mockReset();
  importUrl.mockReset();
  state.isPending = false;
});

const RAW = "https://raw.githubusercontent.com/org/repo/main/skill.md";

const renderModal = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ImportSkillUrlModal onClose={onClose} />
    </NextIntlClientProvider>,
  );

const urlInput = () => screen.getByLabelText("URL (https:// only)");
const nameInput = () => screen.getByLabelText("Skill name");
const submitButton = () => screen.getByRole("button", { name: /Import from URL|Importing…/ });

describe("ImportSkillUrlModal", () => {
  it("shows the title and fields, and enables Import only once an https URL is typed", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByText("Import skill from URL")).toBeInTheDocument();
    expect(urlInput()).toHaveAttribute("placeholder", RAW);
    expect(screen.getByText("Optional — derived from the first heading if blank.")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByText("Enter an https:// URL")).not.toBeInTheDocument();

    await user.type(urlInput(), RAW);
    expect(submitButton()).toBeEnabled();
  });

  it("asks for the optional skill name first, then the URL", () => {
    renderModal();
    const nameInput = screen.getByLabelText("Skill name");
    const urlInput = screen.getByLabelText("URL (https:// only)");
    expect(nameInput.compareDocumentPosition(urlInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Optional — derived from the first heading if blank.")).toBeInTheDocument();
  });

  it("keeps Import disabled for an http:// URL and says why", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(urlInput(), "http://example.com/skill.md");
    expect(screen.getByText("Enter an https:// URL")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("keeps Import disabled while the name is not kebab-case", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(urlInput(), RAW);
    await user.type(nameInput(), "Bad Name");
    expect(screen.getByText(/single hyphens \(at most 64/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await user.clear(nameInput());
    await user.type(nameInput(), "good-name");
    expect(submitButton()).toBeEnabled();
  });

  it("sends the trimmed URL and leaves the name out when it is blank", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(urlInput(), `  ${RAW}  `);
    await user.click(submitButton());
    expect(importUrl).toHaveBeenCalledTimes(1);
    expect(importUrl.mock.calls[0]![0]).toEqual({ url: RAW });
  });

  it("sends a typed name, and Enter in a field submits", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(urlInput(), RAW);
    await user.type(nameInput(), "my-skill{Enter}");
    expect(importUrl).toHaveBeenCalledTimes(1);
    expect(importUrl.mock.calls[0]![0]).toEqual({ url: RAW, name: "my-skill" });
  });

  it("Enter does nothing while the form is invalid", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(urlInput(), "http://example.com/a.md{Enter}");
    expect(importUrl).not.toHaveBeenCalled();
  });

  it("closes and opens a clean skill on its Preview tab", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    importUrl.mockImplementation((_input, opts) => opts.onSuccess({ id: "s9", injection_detected: false }));
    renderModal(onClose);
    await user.type(urlInput(), RAW);
    await user.click(submitButton());
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/s9?tab=preview");
  });

  it("opens a flagged skill on its Config tab", async () => {
    const user = userEvent.setup();
    importUrl.mockImplementation((_input, opts) => opts.onSuccess({ id: "s9", injection_detected: true }));
    renderModal();
    await user.type(urlInput(), RAW);
    await user.click(submitButton());
    expect(push).toHaveBeenCalledWith("/skills/s9?tab=config");
  });

  it("marks the name field on a 409 and clears the mark when the name changes", async () => {
    const user = userEvent.setup();
    importUrl.mockImplementation((_input, opts) => opts.onError(new ApiError("taken", 409, "conflict")));
    renderModal();
    await user.type(urlInput(), RAW);
    await user.click(submitButton());
    expect(screen.getByText("A skill with this name already exists.")).toBeInTheDocument();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(push).not.toHaveBeenCalled();

    await user.type(nameInput(), "other-name");
    expect(screen.queryByText("A skill with this name already exists.")).not.toBeInTheDocument();
  });

  it("shows Importing… and stays disabled while the request runs", async () => {
    const user = userEvent.setup();
    state.isPending = true;
    renderModal();
    await user.type(urlInput(), RAW);
    expect(submitButton()).toHaveTextContent("Importing…");
    expect(submitButton()).toBeDisabled();
  });
});
