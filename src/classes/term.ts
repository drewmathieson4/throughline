import type { ClassRow } from "../../worker/db/schema";
import { calendarDay, shortDateFormat } from "../ui";

// A term or leaving date as "Sep 2".
export const shortDay = (iso: string) => calendarDay(iso, shortDateFormat);

export function termLabel(c: ClassRow) {
  if (c.termStart && c.termEnd) return `${shortDay(c.termStart)} – ${shortDay(c.termEnd)}`;
  if (c.termStart) return `From ${shortDay(c.termStart)}`;
  if (c.termEnd) return `Until ${shortDay(c.termEnd)}`;
  return "No term dates";
}
