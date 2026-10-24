import { createContext, useContext } from "react";
import type { NoteWithTags, RosterStudent } from "../../worker/api-types";
import type { Colour } from "@/lib/avatar";

// Who a student id is, for chips, toasts and the picker. Students who left keep their name on
// old tags but drop out of the picker.
export type Person = { name: string; first: string; classId: string; left: boolean };

export type NotesStore = {
  /** Null until the first load. */
  notes: NoteWithTags[] | null;
  error: string | null;
  /** Every class's students, departed ones included. Empty until the first load. */
  roster: RosterStudent[];
  rosterLoaded: boolean;
  /** Fetch the rosters again after a student is added, imported, renamed or marked as left. */
  refreshRoster: () => void;
  people: Map<string, Person>;
  classNames: Map<string, string>;
  /** A class's colour, worn by its students too; grey for no class. See lib/avatar.ts. */
  colourOf: (classId: string | null | undefined) => Colour;
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
