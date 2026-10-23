import { useEffect, useState, type FormEvent } from "react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../../worker/db/schema";
import type { NoteWithTags, RosterStudent, TaggedNoteResponse } from "../../worker/api-types";
import { api, jsonInit, messageOf } from "../api";
import NoteItem from "../NoteItem";
import { button, errorText, input, plural, subtleButton } from "../ui";
import { useRecorder } from "../useRecorder";

const MAX_RECORDING_MS = 5 * 60 * 1000;

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A note needs no class: the teacher writes or records, and tagging works out the rest.
function NoteForm({ onCreated }: { onCreated: (note: TaggedNoteResponse) => void }) {
  const [draft, setDraft] = useState("");
  // Which kind of note is being saved right now; text and voice saves never overlap. Two
  // actions that must know which one is in flight, so this form does not use useAction.
  const [pending, setPending] = useState<"text" | "voice" | null>(null);
  // Shown once a recording that stopped at the time limit has actually been saved.
  const [hitLimit, setHitLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Posts one note and hands it to the list. False means it failed and the error is on screen.
  async function save(kind: "text" | "voice", url: string, init: RequestInit) {
    setPending(kind);
    setError(null);
    setNotice(null);
    try {
      const note = await api<TaggedNoteResponse>(url, init);
      onCreated(note);
      if (note.tagging === "failed") setNotice("Saved, but tagging did not run. Students can be added later.");
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setPending(null);
    }
  }

  // A voice note is saved the moment transcription finishes; there is no review step.
  const recorder = useRecorder({
    maxMs: MAX_RECORDING_MS,
    onStop: async ({ audio, hitLimit: limited }) => {
      const saved = await save("voice", "/api/notes/voice", { method: "POST", headers: { "content-type": audio.type }, body: audio });
      if (saved) setHitLimit(limited);
    },
  });

  async function record() {
    setError(null);
    setHitLimit(false);
    try {
      await recorder.start();
    } catch (e) {
      // Usually "Permission denied": the browser blocked the mic.
      setError(`Could not start recording: ${messageOf(e)}`);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const saved = await save("text", "/api/notes", jsonInit("POST", { body: draft }));
    if (saved) setDraft("");
  }

  const busy = pending !== null;
  const nearLimit = MAX_RECORDING_MS - recorder.elapsedMs <= 30_000;

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-2">
      <label htmlFor="note" className="text-sm font-medium">
        New note
      </label>
      {hitLimit && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Reached the {mmss(MAX_RECORDING_MS)} limit; this part was saved. Press Record to continue.
        </p>
      )}
      <textarea
        id="note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="What did you notice today?"
        className={input}
      />
      <div className="flex justify-end gap-2">
        {recorder.supported && (
          <button type="button" onClick={recorder.recording ? recorder.stop : record} disabled={busy} className={subtleButton}>
            {pending === "voice" ? (
              "Transcribing and tagging…"
            ) : recorder.recording ? (
              <>
                Stop{" "}
                <span className={nearLimit ? "text-amber-600" : undefined}>
                  ({mmss(recorder.elapsedMs)} / {mmss(MAX_RECORDING_MS)})
                </span>
              </>
            ) : (
              "Record"
            )}
          </button>
        )}
        <button type="submit" disabled={busy || recorder.recording || !draft.trim()} className={button}>
          {pending === "text" ? "Saving and tagging…" : "Add note"}
        </button>
      </div>
      {error && <p className={errorText}>{error}</p>}
      {notice && <p className="text-sm text-amber-700">{notice}</p>}
    </form>
  );
}

// Who a student id is, and which class, for display.
type Person = { name: string; classId: string };

// Read-only for now: suggested tags look tentative, confirmed ones solid, and a name the
// tagger could not resolve is called out so the teacher knows it needs settling. A student's
// class is shown only when it would otherwise be unclear: the note has no class and its
// students span more than one, a student is outside the note's class, or a mention's
// candidates are in different classes.
function Tags({ note, people, classNames }: { note: NoteWithTags; people: Map<string, Person>; classNames: Map<string, string> }) {
  const label = (p: Person | undefined, withClass: boolean) => {
    if (!p) return "Unknown student";
    return withClass ? `${p.name} (${classNames.get(p.classId) ?? "class"})` : p.name;
  };
  if (note.students.length === 0 && note.mentions.length === 0) {
    // With a class and nobody named, the note is class-level context. Without a class it
    // was simply not tagged (no key, a failed call, or nothing to find).
    return <p className="mt-1 text-xs text-gray-400">{note.classId ? "class note" : "no students found"}</p>;
  }
  const spans = new Set(note.students.map((s) => people.get(s.studentId)?.classId)).size > 1;
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {note.students.map((s) => {
        const p = people.get(s.studentId);
        return (
          <div key={s.studentId}>
            <span
              className={
                s.confirmed
                  ? "rounded-full bg-gray-900 px-2 py-0.5 text-xs text-white"
                  : "rounded-full border border-dashed border-gray-400 px-2 py-0.5 text-xs text-gray-700"
              }
              title={s.confirmed ? "Confirmed" : "Suggested"}
            >
              {label(p, note.classId === null ? spans : p?.classId !== note.classId)}
            </span>
            {s.quotes.length > 0 && (
              <ul className="mt-0.5 ml-2 text-xs text-gray-500 italic">
                {s.quotes.map((q) => (
                  <li key={q}>“{q}”</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {note.mentions.map((m) => {
        const spansClasses = new Set(m.candidateIds.map((id) => people.get(id)?.classId)).size > 1;
        return (
          <p key={m.id} className="text-xs text-amber-700">
            Unsure who “{m.mentionText}” is
            {m.candidateIds.length > 0 && `: ${m.candidateIds.map((id) => label(people.get(id), spansClasses)).join(" or ")}`}
          </p>
        );
      })}
    </div>
  );
}

// Tagged, or a candidate for a name the tagger could not settle ("Alex" with two Alexes).
const about = (n: NoteWithTags, studentId: string) =>
  n.students.some((s) => s.studentId === studentId) || n.mentions.some((m) => m.candidateIds.includes(studentId));

// Every note, whatever its class: capture is class-less, and the class picker above only
// drives the Students view. Each note shows its class, or "unassigned". The filters work on
// the loaded list; the server's ?classId is deliberately unused, since a student filter has
// no server equivalent and the count should update without a round trip.
export default function NotesView({ classes }: { classes: ClassRow[] }) {
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [studentFilter, setStudentFilter] = useState("");

  useEffect(() => {
    // Notes and the rosters load independently, so the list renders even if names do not.
    api<NoteWithTags[]>("/api/notes").then(setNotes).catch((e) => setError(messageOf(e)));
    Promise.all(classes.map((c) => api<RosterStudent[]>(`/api/students?classId=${c.id}`)))
      .then((rosters) => setRoster(rosters.flat()))
      .catch((e) => setError(messageOf(e)));
  }, [classes]);

  const classNames = new Map(classes.map((c) => [c.id, c.name]));
  const people = new Map<string, Person>(roster.map((s) => [s.id, { name: `${s.firstName} ${s.lastName}`, classId: s.classId }]));
  const option = (s: RosterStudent) => (
    <option key={s.id} value={s.id}>
      {s.lastName}, {s.firstName}
    </option>
  );

  // Picking a class the chosen student is not in drops the student filter, not the notes.
  function pickClass(id: string) {
    setClassFilter(id);
    if (id && studentFilter && people.get(studentFilter)?.classId !== id) setStudentFilter("");
  }

  const shown = notes.filter((n) => (!classFilter || n.classId === classFilter) && (!studentFilter || about(n, studentFilter)));
  const studentName = people.get(studentFilter)?.name;
  const empty = notes.length === 0 ? "No notes yet." : studentName ? `No notes about ${studentName} yet.` : `No notes in ${classNames.get(classFilter)} yet.`;

  return (
    <>
      <NoteForm onCreated={(note) => setNotes((prev) => [note, ...prev])} />
      {error && <p className={`mt-4 ${errorText}`}>{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Filter by class" className={input} value={classFilter} onChange={(e) => pickClass(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Filter by student" className={input} value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
          <option value="">All students</option>
          {classes
            .filter((c) => !classFilter || c.id === classFilter)
            .map((c) => (
              <optgroup key={c.id} label={c.name}>
                {roster.filter((s) => s.classId === c.id).map(option)}
              </optgroup>
            ))}
        </select>
        <span className="text-gray-500">{plural(shown.length, "note")}</span>
      </div>

      <ul className="mt-2 divide-y divide-gray-200">
        {shown.map((n) => (
          <NoteItem
            key={n.id}
            note={n}
            badge={
              <span className={n.classId ? "rounded bg-gray-100 px-1.5 py-0.5 text-gray-700" : "text-gray-400"}>
                {n.classId ? (classNames.get(n.classId) ?? "class") : "unassigned"}
              </span>
            }
          >
            <Tags note={n} people={people} classNames={classNames} />
          </NoteItem>
        ))}
        {shown.length === 0 && <li className="py-3 text-sm text-gray-500">{empty}</li>}
      </ul>
    </>
  );
}
