/** Largest file the API accepts for an import (512 KiB raw; `SkillImportRequest`). */
export const MAX_UPLOAD_BYTES = 512 * 1024;

/** Extensions the importer understands (`accept` + client-side check). */
export const ACCEPTED_EXTENSIONS = [".md", ".markdown", ".zip"] as const;

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;
