import { createContext, useContext } from "react";
import type { NoteWithTags, RosterStudent } from "../../worker/api-types";

// Who a student id is, for chips, toasts and the picker. Students who left keep their name on
// old tags but drop out of the picker.
export type Person = { name: string; first: string; classId: string; left: boolean };

export type NotesStore = {
  /** Null until the first load. */
  notes: NoteWithTags[] | null;
  error: string | null;
  roster: RosterStudent[];
  people: Map<string, Person>;
  classNames: Map<string, string>;
  /** Notes with a name the tagger could not settle: the "Needs you" count. */
  needsCount: number;
  /** New notes join the top; `replaced` are ids a re-uploaded document made earlier. */
  add: (made: NoteWithTags[], replaced?: string[]) => void;
  /** Swap in a note as the server now has it (after tagging, untagging, settling). */
  update: (note: NoteWithTags) => void;
};

export const NotesContext = createContext<NotesStore | null>(null);

export function useNotes() {
  const store = useContext(NotesContext);
  if (!store) throw new Error("useNotes needs a NotesProvider");
  return store;
}
