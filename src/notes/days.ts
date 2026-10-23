// The feed's day headings: "Today", "Yesterday", then the weekday and date, with the year
// only when it is not this one. Days are the teacher's local days.

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const thisYear = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const otherYear = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });

export function dayLabel(when: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(when) === dayKey(now)) return "Today";
  if (dayKey(when) === dayKey(yesterday)) return "Yesterday";
  return (when.getFullYear() === now.getFullYear() ? thisYear : otherYear).format(when);
}

// Newest first. A note added this session joins the top of the list whatever its date (a
// document can be dated last month), so the list is sorted here rather than trusted.
export function groupByDay<T extends { notedAt: string }>(notes: T[], now = new Date()) {
  const sorted = [...notes].sort((a, b) => b.notedAt.localeCompare(a.notedAt));
  const groups: { key: string; label: string; notes: T[] }[] = [];
  for (const note of sorted) {
    const when = new Date(note.notedAt);
    const key = dayKey(when);
    const last = groups.at(-1);
    if (last?.key === key) last.notes.push(note);
    else groups.push({ key, label: dayLabel(when, now), notes: [note] });
  }
  return groups;
}
