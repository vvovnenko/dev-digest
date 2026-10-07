import { describe, it, expect } from "vitest";
import { withoutImages } from "./helpers";

describe("withoutImages", () => {
  it("turns images into link labels and leaves links alone", () => {
    expect(withoutImages("see ![pixel](https://x.test/p.gif) and [docs](https://d.test)")).toBe(
      "see [image: pixel](https://x.test/p.gif) and [docs](https://d.test)",
    );
  });
});
