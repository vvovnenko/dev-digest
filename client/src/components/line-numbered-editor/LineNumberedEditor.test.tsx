import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/skills.json";
import { LineNumberedEditor } from "./LineNumberedEditor";
import { lineCount } from "./helpers";

afterEach(cleanup);

const ui = (props: Partial<React.ComponentProps<typeof LineNumberedEditor>> = {}) => (
  <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
    <LineNumberedEditor
      fileName="branch-coverage.md"
      value={"a\nb\nc"}
      onChange={vi.fn()}
      unsaved={false}
      tokens={12}
      label="Skill body"
      {...props}
    />
  </NextIntlClientProvider>
);

describe("LineNumberedEditor", () => {
  it("shows the file name, token count and one gutter number per line", () => {
    const { container } = render(ui());
    expect(screen.getByText("branch-coverage.md")).toBeInTheDocument();
    expect(screen.getByText("12 tokens")).toBeInTheDocument();
    const gutter = container.querySelector('[aria-hidden="true"].mono');
    expect(gutter?.textContent).toBe("123");
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });

  it("reports edits and flags unsaved text", () => {
    const onChange = vi.fn();
    render(ui({ onChange, unsaved: true }));
    fireEvent.change(screen.getByLabelText("Skill body"), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
  });

  it("counts lines, an empty text included", () => {
    expect(lineCount("")).toBe(1);
    expect(lineCount("a\n")).toBe(2);
  });
});
