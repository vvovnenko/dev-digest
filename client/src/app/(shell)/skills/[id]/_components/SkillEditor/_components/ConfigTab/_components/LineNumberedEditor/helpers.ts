/** Number of lines in `text` (an empty text still shows line 1). */
export function lineCount(text: string): number {
  return text.split("\n").length;
}
