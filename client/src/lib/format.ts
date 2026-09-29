/* format.ts — how the UI prints dates and times, through next-intl's formatter
   (the app's locale and time zone, identical on server and client) instead of
   each component calling toLocaleString() with the browser's locale. */
"use client";

import { useFormatter, type DateTimeFormatOptions } from "next-intl";

/** "9/28/2026, 3:04:05 PM" in en. */
export const DATE_TIME: DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
};

/** "3:04:05 PM" in en. */
export const TIME: DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", second: "2-digit" };

/**
 * Formats an ISO timestamp with the given options; an unparseable value is
 * returned as is, so a bad timestamp shows up instead of "Invalid Date".
 */
export function useDateFormat(options: DateTimeFormatOptions = DATE_TIME): (iso: string) => string {
  const format = useFormatter();
  return (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, options);
  };
}
