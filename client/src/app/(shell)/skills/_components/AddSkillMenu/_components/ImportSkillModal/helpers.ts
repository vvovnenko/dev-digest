import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "./constants";

export type FileProblem = "too_large" | "wrong_type";

/** Why a chosen file can't be sent, or null when it can (checked before any request). */
export function checkFile(file: { name: string; size: number }): FileProblem | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return "wrong_type";
  if (file.size > MAX_UPLOAD_BYTES) return "too_large";
  return null;
}

/** The base64 payload of a `data:` URL (what FileReader.readAsDataURL returns). */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? "" : dataUrl.slice(comma + 1);
}
