import type { Skill, SkillImportUrlRequest } from "@devdigest/shared";
import { MAX_IMPORT_URL_CHARS } from "./constants";

/**
 * Whether the API will take `raw` as an import URL (`SkillImportUrlRequest.url`): trimmed,
 * at most 2048 characters, an absolute `https://` URL with a host. The server checks the
 * rest (credentials, port, public address) when it fetches.
 */
export function isImportableUrl(raw: string): boolean {
  const url = raw.trim();
  if (url.length === 0 || url.length > MAX_IMPORT_URL_CHARS || !/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The request body: the trimmed URL, and `name` only when one was typed. */
export function toImportRequest(url: string, name: string): SkillImportUrlRequest {
  const trimmedName = name.trim();
  return trimmedName ? { url: url.trim(), name: trimmedName } : { url: url.trim() };
}

/** Where a freshly imported skill opens: Config when it is blocked (to clean it), else Preview. */
export function importedSkillPath(skill: Pick<Skill, "id" | "injection_detected">): string {
  return `/skills/${skill.id}?tab=${skill.injection_detected ? "config" : "preview"}`;
}
