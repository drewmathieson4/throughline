// Class strings for the plain form controls (text boxes, dates, selects) until each form gets
// its restyle; buttons are the Button component in src/components/ui.
export const input =
  "min-h-11 rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
export const fieldLabel = "flex flex-col gap-1.5 text-[13px] font-semibold text-secondary-foreground";
export const errorText = "text-sm text-destructive";

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A recording's length as m:ss.
export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
