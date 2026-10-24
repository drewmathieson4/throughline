// How long since a student was last written about: mint within a week, yellow within a
// month, coral older or never. Scannable, so the quiet students stand out. Counted in the
// teacher's local days, so a note last night is "Yesterday" this morning.

export type Fresh = { label: string; tone: "mint" | "sunny" | "coral" };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function freshness(lastNotedAt: string | null, now = new Date()): Fresh {
  if (!lastNotedAt) return { label: "No notes yet", tone: "coral" };
  // Rounded, since a day across a clock change is 23 or 25 hours.
  const days = Math.max(0, Math.round((startOfDay(now).getTime() - startOfDay(new Date(lastNotedAt)).getTime()) / 86_400_000));
  const label = days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
  return { label, tone: days <= 7 ? "mint" : days <= 30 ? "sunny" : "coral" };
}

export const freshStyles: Record<Fresh["tone"], { pill: string; dot: string }> = {
  mint: { pill: "bg-mint text-mint-foreground", dot: "bg-mint-dot" },
  sunny: { pill: "bg-sunny text-sunny-foreground", dot: "bg-sunny-dot" },
  coral: { pill: "bg-coral text-coral-foreground", dot: "bg-coral-dot" },
};
