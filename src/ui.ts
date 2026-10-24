export const errorText = "text-sm text-destructive";
// The small uppercase label over a section of a card.
export const caption = "text-xs font-extrabold tracking-[.06em] text-muted-foreground uppercase";

// A toggle chip's two looks, and the row of chips that scrolls sideways on a phone and wraps
// on a laptop. The row's -mx-4/px-4 bleeds to the shell's 16px gutter.
export const chipOn = "border-primary bg-primary text-primary-foreground";
export const chipOff = "border-input bg-background text-secondary-foreground hover:bg-muted";
export const chipRow = "-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] md:mx-0 md:mt-[22px] md:flex-wrap md:px-0";

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
export const shortDateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

// A calendar day (YYYY-MM-DD, or the date part of a timestamp) read as local midnight, so it
// shows as that day; new Date("2026-09-02") is UTC midnight, the day before west of Greenwich.
export const calendarDay = (iso: string, format = dateFormat) => format.format(new Date(`${iso.slice(0, 10)}T00:00:00`));

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const pct = (n: number) => `${Math.round(n)}%`;
// "1 needs you", "3 need you": notes with a name to settle.
export const needsYou = (n: number) => `${n} ${n === 1 ? "needs" : "need"} you`;

// A recording's length as m:ss.
export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
