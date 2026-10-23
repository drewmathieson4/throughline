// Pastel fill and readable ink pairs. The pair comes from the id, so a student (or a class)
// keeps one colour everywhere: note tags, the roster, reports.
const PALETTE = [
  ["#DCE6FF", "#1E40C8"],
  ["#D5F5E6", "#16714B"],
  ["#FFE2CF", "#9A4515"],
  ["#DCEEFF", "#1F5F9E"],
  ["#FFE0EE", "#A12A62"],
  ["#FFF1BF", "#6E5100"],
  ["#D3F4F4", "#0F6A6A"],
  ["#F1E1FF", "#7232A8"],
] as const;

export function colourFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const [bg, fg] = PALETTE[Math.abs(h) % PALETTE.length];
  return { bg, fg };
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
