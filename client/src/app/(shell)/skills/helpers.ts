/**
 * Markdown with every image turned into a plain link label, so previewing an
 * imported body never loads a remote image (a tracking pixel). The agent still
 * receives the original text.
 */
export function withoutImages(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]/g, (_m, alt: string) => `[image: ${alt}]`);
}
