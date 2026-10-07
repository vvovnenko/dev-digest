/**
 * Global shortcuts vs page shortcuts: the `g` chord owns its second key, so
 * `g a` (go to Agents) no longer also accepts the focused finding on the PR page.
 * An open modal (a delete confirm) owns the keyboard: no palette, help or `g` jump behind it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { Modal } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../messages/en/prReview.json";

const { push, mutate } = vi.hoisted(() => ({ push: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: false }),
  usePendingFindingIds: () => new Set<string>(),
}));

import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { FindingsPanel } from "@/app/(shell)/repos/[repoId]/pulls/[number]/_components/FindingsPanel";

afterEach(() => {
  cleanup();
  push.mockReset();
  mutate.mockReset();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 1,
  end_line: 1,
  rationale: "r",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function Page({ onOpenPalette = vi.fn(), onOpenHelp = vi.fn(), modal = false }) {
  useGlobalShortcuts({ onOpenPalette, onOpenHelp });
  return (
    <>
      <FindingsPanel findings={[FINDING]} prId="pr1" />
      {modal && <Modal title="Delete run" onClose={() => {}} />}
    </>
  );
}

const tree = (props: React.ComponentProps<typeof Page> = {}) => (
  <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
    <Page {...props} />
  </NextIntlClientProvider>
);
const renderPage = (props: React.ComponentProps<typeof Page> = {}) => render(tree(props));

describe("useGlobalShortcuts", () => {
  it("`g a` goes to Agents and does not accept the focused finding", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.keyboard("ga");
    expect(push).toHaveBeenCalledWith("/agents");
    expect(mutate).not.toHaveBeenCalled();

    await user.keyboard("a"); // outside a chord, `a` is the page's again
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("`g s` goes to Skills", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.keyboard("gs");
    expect(push).toHaveBeenCalledWith("/skills");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl+K opens the palette and ? opens the shortcuts help", async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    const onOpenHelp = vi.fn();
    renderPage({ onOpenPalette, onOpenHelp });
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("?");
    expect(onOpenPalette).toHaveBeenCalledTimes(2);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("an open modal blocks the palette, help and `g` jumps, and ⌘K still skips the browser", async () => {
    const user = userEvent.setup();
    const onOpenPalette = vi.fn();
    const onOpenHelp = vi.fn();
    const { rerender } = renderPage({ onOpenPalette, onOpenHelp, modal: true });
    const cmdK = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
    window.dispatchEvent(cmdK);
    expect(cmdK.defaultPrevented).toBe(true);
    await user.keyboard("?");
    await user.keyboard("ga");
    expect(onOpenPalette).not.toHaveBeenCalled();
    expect(onOpenHelp).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled(); // the panel's `a` waits too

    rerender(tree({ onOpenPalette, onOpenHelp, modal: false }));
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("?");
    await user.keyboard("ga");
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/agents");
  });
});
