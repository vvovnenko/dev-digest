import { describe, it, expect, afterEach } from "vitest";
import { isModalOpen, isShortcutFree, isTextInput } from "./shortcut-guards";

afterEach(() => {
  document.body.innerHTML = "";
});

const keydown = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
};

describe("shortcut-guards", () => {
  it("recognises text-entry targets", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect([input, textarea, editable].map(isTextInput)).toEqual([true, true, true]);
    // jsdom has no isContentEditable (browsers do), so a button reads undefined here: falsy either way.
    expect(isTextInput(document.createElement("button"))).toBeFalsy();
    expect(isTextInput(null)).toBe(false);
  });

  it("a plain key on the page is free", () => {
    expect(isShortcutFree(keydown({}))).toBe(true);
  });

  it("a modifier, a field, a handled event or an open modal takes it", () => {
    expect(isShortcutFree(keydown({ metaKey: true }))).toBe(false);
    expect(isShortcutFree(keydown({ ctrlKey: true }))).toBe(false);
    expect(isShortcutFree(keydown({ altKey: true }))).toBe(false);
    expect(isShortcutFree(keydown({}, document.createElement("input")))).toBe(false);

    const handled = keydown({});
    handled.preventDefault();
    expect(isShortcutFree(handled)).toBe(false);

    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(isShortcutFree(keydown({}))).toBe(false);
  });

  it("only an aria-modal overlay counts as an open modal", () => {
    const palette = document.createElement("div");
    palette.setAttribute("role", "dialog"); // the command palette: a dialog, not modal
    document.body.append(palette);
    expect(isModalOpen()).toBe(false);
    palette.setAttribute("aria-modal", "true");
    expect(isModalOpen()).toBe(true);
  });
});
