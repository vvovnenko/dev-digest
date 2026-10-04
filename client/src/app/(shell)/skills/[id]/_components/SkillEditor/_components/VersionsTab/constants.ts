import type { DateTimeFormatOptions } from "next-intl";

/** "Sep 28, 2026" — a version's date. */
export const VERSION_DATE: DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
