import { useEffect, useState, type ReactNode } from "react";
import { useMatch } from "react-router";
import { toast } from "sonner";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../../worker/db/schema";
import type { NoteWithTags, RosterStudent, TaggedNoteResponse } from "../../worker/api-types";
import { api, fileInit, jsonInit, messageOf } from "../api";
import { useAllowance } from "../auth/allowanceStore";
import { createQueue, type QueuedNote } from "../offline/queue";
import { idbStore } from "../offline/store";
import { useOnline } from "../offline/useOnline";
import { plural } from "../ui";
import { NotesContext, type NotesStore } from "./notesStore";
import { NO_CLASS, classColours } from "@/lib/avatar";

// How long one send may take before the note is left for a later flush. Whisper and tagging
// take seconds; one bar of signal can hang a request for minutes. A send that did reach the
// server is safe to repeat: its clientId finds the note it made.
const SEND_TIMEOUT_MS = 60_000;

function sendNote(note: QueuedNote) {
  const { clientId, notedAt } = note;
  const signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
  if (note.kind === "text") return api<TaggedNoteResponse>("/api/notes", { ...jsonInit("POST", { body: note.body, notedAt, clientId }), signal });
  const audio = new Blob([note.audio], { type: note.type });
  return api<TaggedNoteResponse>(`/api/notes/voice?${new URLSearchParams({ notedAt, clientId })}`, { ...fileInit(audio), signal });
}

// Newest first, as the server lists them, so a note uploaded late from the queue lands at
// the time it was taken. A note already in the list (a resend the server recognised) is swapped.
function merge(prev: NoteWithTags[] | null, made: NoteWithTags[], replaced: string[]) {
  const gone = new Set([...replaced, ...made.map((n) => n.id)]);
  return [...made, ...(prev ?? []).filter((n) => !gone.has(n.id))].sort((a, b) => b.notedAt.localeCompare(a.notedAt) || b.createdAt.localeCompare(a.createdAt));
}

// Notes live above the routes so the Notes tab can carry the "Needs you" badge on every
// screen. They reload each time the teacher enters or leaves Notes, and when the connection
// comes back: a recorded answer on a report, or a roster import, changes them from elsewhere.
// The offline queue lives here too, so notes captured with no signal upload from any screen.
export function NotesProvider({ classes, children }: { classes: ClassRow[]; children: ReactNode }) {
  const [notes, setNotes] = useState<NoteWithTags[] | null>(null);
  // Kept with the class list it was fetched for: until the rosters for the current classes
  // arrive, a class page shows Loading rather than an empty roster.
  const [roster, setRoster] = useState<{ classes: ClassRow[]; rows: RosterStudent[] } | null>(null);
  // Bumped by refreshRoster so the effect below fetches again.
  const [rosterVersion, setRosterVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(0);
  const onNotes = useMatch("/notes/*") !== null;
  const online = useOnline();
  // The queue is made once, so it cannot call the store; it counts what it settled and an
  // effect asks for the account's allowance again after each one.
  const { refreshAllowance } = useAllowance();
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    if (settled > 0) refreshAllowance();
  }, [settled, refreshAllowance]);

  const [queue] = useState(() => {
    // Queued notes that uploaded while nobody was waiting on them, summed into one toast.
    let uploaded = 0;
    const reset = () => (uploaded = 0);
    return createQueue({
      store: idbStore,
      send: sendNote,
      online: () => navigator.onLine,
      onCount: setWaiting,
      onSettled: (note, outcome, awaited) => {
        if (outcome.status === "sent") setNotes((prev) => merge(prev, [outcome.note], []));
        setSettled((n) => n + 1); // sent or refused, a demo visitor's allowance may have moved
        // The capture that queued the note reports it itself.
        if (awaited) return;
        if (outcome.status === "refused") {
          toast.error(`A waiting ${note.kind === "voice" ? "voice note" : "note"} was not saved: ${outcome.error}`);
          return;
        }
        uploaded += 1;
        toast.success(`Uploaded ${plural(uploaded, "waiting note")}`, { id: "uploaded", onDismiss: reset, onAutoClose: reset });
      },
    });
  });

  // Notes captured offline go up on start-up, when the connection comes back, and when the
  // teacher returns to the app (an installed app resumes without reloading).
  useEffect(() => {
    void queue.count();
    void queue.flush();
    const flush = () => void queue.flush();
    const flushIfShown = () => document.visibilityState === "visible" && flush();
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", flushIfShown);
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", flushIfShown);
    };
  }, [queue]);

  // Notes and the rosters load independently, so the list renders even if names do not.
  useEffect(() => {
    let current = true;
    api<NoteWithTags[]>("/api/notes")
      .then((n) => {
        if (!current) return;
        setNotes(n);
        setError(null);
      })
      .catch((e) => current && setError(messageOf(e)));
    return () => {
      current = false;
    };
  }, [onNotes, online]);
  useEffect(() => {
    let current = true;
    Promise.all(classes.map((c) => api<RosterStudent[]>(`/api/students?classId=${c.id}`)))
      .then((rosters) => current && setRoster({ classes, rows: rosters.flat() }))
      .catch((e) => current && setError(messageOf(e)));
    return () => {
      current = false;
    };
  }, [classes, onNotes, online, rosterVersion]);

  const students = roster?.rows ?? [];
  const colours = classColours(classes.map((c) => c.id));
  const store: NotesStore = {
    notes,
    error,
    roster: students,
    rosterLoaded: roster?.classes === classes,
    refreshRoster: () => setRosterVersion((v) => v + 1),
    people: new Map(students.map((s) => [s.id, { name: `${s.firstName} ${s.lastName}`, first: s.firstName, classId: s.classId, left: s.leftAt !== null }])),
    classNames: new Map(classes.map((c) => [c.id, c.name])),
    colourOf: (classId) => (classId && colours.get(classId)) || NO_CLASS,
    needsCount: notes?.filter((n) => n.mentions.length > 0).length ?? 0,
    waiting,
    queueNote: queue.add,
    add: (made, replaced = []) => setNotes((prev) => merge(prev, made, replaced)),
    update: (note) => setNotes((prev) => prev && prev.map((n) => (n.id === note.id ? note : n))),
  };
  return <NotesContext.Provider value={store}>{children}</NotesContext.Provider>;
}
