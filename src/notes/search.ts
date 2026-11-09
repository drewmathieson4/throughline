// The feed's text search, over the loaded list like the other filters: every word typed has
// to appear somewhere in the note's text or the name of the document it came from, in any
// order, ignoring case. A blank query matches everything.
export function matches(note: { body: string; sourceName: string | null }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${note.body}\n${note.sourceName ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
