// Pastel fill and readable ink pairs, ordered so neighbouring classes look most different.
const PALETTE = [
  ["#DCE6FF", "#1E40C8"],
  ["#D5F5E6", "#16714B"],
  ["#FFE2CF", "#9A4515"],
  ["#FFE0EE", "#A12A62"],
  ["#D3F4F4", "#0F6A6A"],
  ["#FFF1BF", "#6E5100"],
  ["#DCEEFF", "#1F5F9E"],
  ["#F1E1FF", "#7232A8"],
] as const;

export type Colour = { bg: string; fg: string };

// For a note filed under no class, or a student whose roster has not loaded yet.
export const NO_CLASS: Colour = { bg: "#EEF0F4", fg: "#4A5060" };

// Each class takes the next colour in the order the classes were made, so the first eight
// never share one, and its students wear the same colour: a chip, a roster row or a report
// says which class at a glance.
export function classColours(classIds: string[]) {
  return new Map(classIds.map((id, i): [string, Colour] => {
    const [bg, fg] = PALETTE[i % PALETTE.length];
    return [id, { bg, fg }];
  }));
}

// "Maya Okafor" -> "MO"; "English 10" -> "E10", since a class's number says more than a
// second letter.
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const num = words.find((w) => /^\d+$/.test(w));
  const second = num ?? (words.length > 1 ? words[words.length - 1][0] : "");
  return (words[0][0] + second).toUpperCase();
}
