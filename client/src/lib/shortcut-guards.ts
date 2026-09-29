/**
 * Guards for window-level keyboard shortcuts: a page shortcut should act only
 * on a key press nothing else owns — not a text field, not an open overlay,
 * not a browser or OS command.
 */

/** Whether an event target is a text-entry element (guards typing-aware shortcuts). */
export function isTextInput(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return (
    !!node &&
    (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable)
  );
}

/**
 * Whether a keydown is free for a page shortcut: no modifier (Cmd/Ctrl+A is
 * "select all", Cmd/Ctrl+D a bookmark), not already handled, not typed into a
 * field, and no modal drawer or dialog open over the page.
 */
export function isShortcutFree(e: KeyboardEvent): boolean {
  return (
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.defaultPrevented &&
    !isTextInput(e.target) &&
    document.querySelector('[aria-modal="true"]') === null
  );
}
