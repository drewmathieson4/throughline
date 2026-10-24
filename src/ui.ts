export const errorText = "text-sm text-destructive";

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A recording's length as m:ss.
export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
