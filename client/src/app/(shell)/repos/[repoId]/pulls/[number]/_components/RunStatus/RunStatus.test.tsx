import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/prReview.json";

const stream = vi.hoisted(() => ({ running: false }));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: stream.running }),
}));

import { RunStatus } from "./RunStatus";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunStatus (smoke)", () => {
  it("renders nothing when there are no run ids", () => {
    const { container } = renderWithIntl(<RunStatus runIds={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("RunStatus — onDone", () => {
  it("fires once when streaming ends, even when the parent passes a new callback every render", () => {
    const calls: string[] = [];
    stream.running = true;
    const { rerender } = renderWithIntl(<RunStatus runIds={["r1"]} onDone={() => calls.push("a")} />);
    stream.running = false;
    const intl = (onDone: () => void) => (
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunStatus runIds={["r1"]} onDone={onDone} />
      </NextIntlClientProvider>
    );
    rerender(intl(() => calls.push("b")));
    rerender(intl(() => calls.push("c")));
    rerender(intl(() => calls.push("d")));
    expect(calls).toEqual(["b"]);
  });
});

