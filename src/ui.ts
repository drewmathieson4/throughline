// Tailwind class strings shared by every form so the controls look the same everywhere.
export const button = "rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-40";
export const subtleButton = "rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40";
export const input = "rounded border border-gray-300 px-2 py-1 text-sm";
export const fieldLabel = "flex flex-col text-xs text-gray-600";
export const errorText = "text-sm text-red-600";

export const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A recording's length as m:ss.
export const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
