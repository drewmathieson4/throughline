import type { ClassRow } from "../../worker/db/schema";

const dayMonth = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
// A term date is a calendar day; parsing "2026-09-02" with new Date() would read it as UTC
// midnight and show the day before west of Greenwich.
const day = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return dayMonth.format(new Date(y, m - 1, d));
};

export function termLabel(c: ClassRow) {
  if (c.termStart && c.termEnd) return `${day(c.termStart)} – ${day(c.termEnd)}`;
  if (c.termStart) return `From ${day(c.termStart)}`;
  if (c.termEnd) return `Until ${day(c.termEnd)}`;
  return "No term dates";
}
