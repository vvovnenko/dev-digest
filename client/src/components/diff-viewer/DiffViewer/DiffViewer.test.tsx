/**
 * DiffViewer inline comments from the keyboard: the "+" on a diff line is
 * reachable with Tab, shows up when focused (not only on hover), and opens the
 * composer, which posts through the commenting API.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import shellMessages from "../../../../messages/en/shell.json";
import type { DiffCommentApi } from "../comments";
import { DiffViewer } from "./DiffViewer";

afterEach(cleanup);

const FILES: PrFile[] = [
  { path: "src/config.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;" },
];

function renderDiff(commenting: DiffCommentApi) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ shell: shellMessages }}>
      <DiffViewer files={FILES} commenting={commenting} />
    </NextIntlClientProvider>,
  );
}

const api = (onSubmit = vi.fn(async () => ({}))): DiffCommentApi => ({
  comments: [],
  canComment: true,
  showComments: true,
  posting: false,
  onSubmit,
});

describe("DiffViewer — comment from the keyboard", () => {
  it("tabs to a line's +, which shows while focused, and posts the typed comment", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({}));
    renderDiff(api(onSubmit));

    const plus = screen.getAllByRole("button", { name: "Add a comment on this line" });
    expect(plus).toHaveLength(2); // the context line and the added line
    expect(plus[1]).toHaveStyle({ opacity: "0" });

    for (let i = 0; i < 10 && document.activeElement !== plus[1]; i++) await user.tab();
    expect(plus[1]).toHaveFocus();
    expect(plus[1]).toHaveStyle({ opacity: "1" });

    await user.keyboard("{Enter}");
    await user.type(screen.getByPlaceholderText(/Leave a comment/), "Why 2?");
    await user.click(screen.getByRole("button", { name: /^Comment$/ }));
    expect(onSubmit).toHaveBeenCalledWith({ path: "src/config.ts", line: 2, side: "RIGHT", body: "Why 2?" });
  });

  it("offers no + where commenting isn't possible", () => {
    renderDiff({ ...api(), canComment: false });
    expect(screen.queryByRole("button", { name: "Add a comment on this line" })).not.toBeInTheDocument();
  });
});
