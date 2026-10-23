import { useEffect, useState, type FormEvent } from "react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../../worker/db/schema";
import type { DocumentImportResult, NoteWithTags, RosterStudent, TaggedNoteResponse } from "../../worker/api-types";
import { DOCUMENT_TYPES, api, fileInit, jsonInit, messageOf } from "../api";
import FilePicker from "../FilePicker";
import NoteItem from "../NoteItem";
import Tags, { type Person } from "./Tags";
import { button, errorText, input, mmss, plural, subtleButton } from "../ui";
import { useRecorder } from "../useRecorder";

const MAX_RECORDING_MS = 5 * 60 * 1000;

// A note needs no class: the teacher writes or records, and tagging works out the rest. An
// uploaded document (an old progress report) becomes one note per student it is about.
function NoteForm({ onCreated, onReplaced }: { onCreated: (note: NoteWithTags) => void; onReplaced: (replacedIds: string[], notes: NoteWithTags[]) => void }) {
  const [draft, setDraft] = useState("");
  // Which kind of save is in flight; they never overlap. Several actions that must know
  // which one is running, so this form does not use useAction.
  const [pending, setPending] = useState<"text" | "voice" | "document" | null>(null);
  // Shown once a recording that stopped at the time limit has actually been saved.
  const [hitLimit, setHitLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the last save did; `warn` for a save that went only partly right.
  const [message, setMessage] = useState<{ text: string; warn?: boolean } | null>(null);

  // Runs one save and hands what it made to the list. False means it failed and the error
  // is on screen.
  async function run(kind: NonNullable<typeof pending>, fn: () => Promise<void>) {
    setPending(kind);
    setError(null);
    setMessage(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setPending(null);
    }
  }

  // Posts one note.
  const save = (kind: "text" | "voice", url: string, init: RequestInit) =>
    run(kind, async () => {
      const note = await api<TaggedNoteResponse>(url, init);
      onCreated(note);
      if (note.tagging === "failed") setMessage({ text: "Saved, but tagging did not run. Students can be added later.", warn: true });
    });

  // Uploads a document; the notes it was cut into join the list at once.
  const upload = (file: File) =>
    run("document", async () => {
      const query = new URLSearchParams({ name: file.name });
      // The file's own date is the fallback for notes from a document that states none.
      if (file.lastModified > 0 && file.lastModified <= Date.now()) query.set("modified", new Date(file.lastModified).toISOString());
      const result = await api<DocumentImportResult>(`/api/notes/document?${query}`, fileInit(file));
      onReplaced(result.replaced, result.notes);
      const unsure = result.notes.filter((n) => n.mentions.length > 0).length;
      const made =
        result.notes.length === 0
          ? `No students from your roster were named in ${result.name}.`
          : `Made ${plural(result.notes.length, "note")} from ${result.name}${unsure > 0 ? `, ${plural(unsure, "name")} unsure` : ""}.`;
      setMessage({ text: result.replaced.length > 0 ? `${made} Replaced ${plural(result.replaced.length, "note")} made from it earlier.` : made });
    });

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
      <div className="flex flex-wrap justify-end gap-2">
        <FilePicker accept={DOCUMENT_TYPES} disabled={busy || recorder.recording} onFile={upload}>
          {pending === "document" ? "Reading and tagging…" : "Upload a document"}
        </FilePicker>
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
      {message && (
        <p role="status" className={message.warn ? "text-sm text-amber-700" : "text-sm text-gray-600"}>
          {message.text}
        </p>
      )}
    </form>
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
      <NoteForm
        onCreated={(note) => setNotes((prev) => [note, ...prev])}
        onReplaced={(gone, made) => setNotes((prev) => [...made, ...prev.filter((n) => !gone.includes(n.id))])}
      />
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
            <Tags
              note={n}
              people={people}
              classNames={classNames}
              onChange={(updated) => setNotes((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
            />
          </NoteItem>
        ))}
        {shown.length === 0 && <li className="py-3 text-sm text-gray-500">{empty}</li>}
      </ul>
    </>
  );
}
