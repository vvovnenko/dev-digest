import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import type { Crumb } from "@devdigest/ui";
import { ShellCrumbContext, useShellCrumb } from "./useShellCrumb";

function Page({ label }: { label: string }) {
  useShellCrumb([{ label: "Repo", mono: true }, { label }]);
  return null;
}

describe("useShellCrumb", () => {
  it("publishes the page's breadcrumb, ignores a fresh array with the same value, and clears it on unmount", () => {
    const calls: (Crumb[] | undefined)[] = [];
    const set = (c: Crumb[] | undefined) => calls.push(c);
    const tree = (label: string, show = true) => (
      <ShellCrumbContext.Provider value={set}>{show && <Page label={label} />}</ShellCrumbContext.Provider>
    );
    const { rerender } = render(tree("Pull Requests"));
    rerender(tree("Pull Requests"));
    rerender(tree("#482"));
    rerender(tree("#482", false));
    expect(calls).toEqual([
      [{ label: "Repo", mono: true }, { label: "Pull Requests" }],
      undefined,
      [{ label: "Repo", mono: true }, { label: "#482" }],
      undefined,
    ]);
  });

  it("does nothing outside the shell", () => {
    expect(() => render(<Page label="x" />)).not.toThrow();
  });
});
