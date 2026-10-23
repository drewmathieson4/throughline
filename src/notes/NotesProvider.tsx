import { useEffect, useState, type ReactNode } from "react";
import { useMatch } from "react-router";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../../worker/db/schema";
import type { NoteWithTags, RosterStudent } from "../../worker/api-types";
import { api, messageOf } from "../api";
import { NotesContext, type NotesStore } from "./notesStore";

// Notes live above the routes so the Notes tab can carry the "Needs you" badge on every
// screen. They reload each time the teacher enters or leaves Notes: a recorded answer on a
// report, or a roster import, changes them from elsewhere.
export function NotesProvider({ classes, children }: { classes: ClassRow[]; children: ReactNode }) {
  const [notes, setNotes] = useState<NoteWithTags[] | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onNotes = useMatch("/notes/*") !== null;

  // Notes and the rosters load independently, so the list renders even if names do not.
  useEffect(() => {
    let current = true;
    api<NoteWithTags[]>("/api/notes")
      .then((n) => current && setNotes(n))
      .catch((e) => current && setError(messageOf(e)));
    return () => {
      current = false;
    };
  }, [onNotes]);
  useEffect(() => {
    let current = true;
    Promise.all(classes.map((c) => api<RosterStudent[]>(`/api/students?classId=${c.id}`)))
      .then((rosters) => current && setRoster(rosters.flat()))
      .catch((e) => current && setError(messageOf(e)));
    return () => {
      current = false;
    };
  }, [classes, onNotes]);

  const store: NotesStore = {
    notes,
    error,
    roster,
    people: new Map(roster.map((s) => [s.id, { name: `${s.firstName} ${s.lastName}`, first: s.firstName, classId: s.classId, left: s.leftAt !== null }])),
    classNames: new Map(classes.map((c) => [c.id, c.name])),
    needsCount: notes?.filter((n) => n.mentions.length > 0).length ?? 0,
    add: (made, replaced = []) => setNotes((prev) => [...made, ...(prev ?? []).filter((n) => !replaced.includes(n.id))]),
    update: (note) => setNotes((prev) => prev && prev.map((n) => (n.id === note.id ? note : n))),
  };
  return <NotesContext.Provider value={store}>{children}</NotesContext.Provider>;
}
