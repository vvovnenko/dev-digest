import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/common.json";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";

afterEach(cleanup);

const renderModal = (props: Partial<React.ComponentProps<typeof ConfirmDeleteModal>> = {}) => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ common: messages }}>
      <ConfirmDeleteModal
        title="Delete skill"
        message={'"skill-7" will be permanently removed. This cannot be undone.'}
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onConfirm, onClose };
};

describe("ConfirmDeleteModal", () => {
  it("shows the title and what will be removed in a dialog", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete skill");
    expect(dialog).toHaveTextContent('"skill-7" will be permanently removed. This cannot be undone.');
  });

  it("Delete confirms and leaves closing to the caller", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel and the ✕ close it without confirming", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderModal();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("can't be confirmed twice while the delete is in flight", () => {
    renderModal({ pending: true });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
