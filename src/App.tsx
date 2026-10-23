import { useEffect, useState, type FormEvent } from "react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../worker/db/schema";
import type { NoteWithTags, RosterStudent, TaggedNoteResponse } from "../worker/api";
import { useRecorder } from "./useRecorder";

const MAX_RECORDING_MS = 5 * 60 * 1000;

// Every /api error response is { error: string }; surface that message when present.
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${url} → ${res.status}`);
  return data as T;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// A note needs no class: the teacher writes or records, and tagging works out the rest.
function NoteForm({ onCreated }: { onCreated: (note: TaggedNoteResponse) => void }) {
  const [draft, setDraft] = useState("");
  // Which kind of note is being saved right now; text and voice saves never overlap.
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
      const saved = await save("voice", "/api/notes/voice", {
        method: "POST",
        headers: { "content-type": audio.type },
        body: audio,
      });
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
    const saved = await save("text", "/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: draft }),
    });
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
        className="rounded border border-gray-300 p-2"
      />
      <div className="flex justify-end gap-2">
        {recorder.supported && (
          <button
            type="button"
            onClick={recorder.recording ? recorder.stop : record}
            disabled={busy}
            className="rounded border border-gray-900 px-4 py-2 disabled:opacity-40"
          >
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
        <button
          type="submit"
          disabled={busy || recorder.recording || !draft.trim()}
          className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-40"
        >
          {pending === "text" ? "Saving and tagging…" : "Add note"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-amber-700">{notice}</p>}
    </form>
  );
}

// Who a student id is, and which class, for display.
type Person = { name: string; classId: string };

// Read-only for now: suggested tags look tentative, confirmed ones solid, and a name the
// tagger could not resolve is called out so the teacher knows it needs settling. A student's
// class is shown only when it would otherwise be unclear: on a mention with candidates from
// different classes, or on a tag whose student is not in the note's class.
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
  // Show each student's class when it would otherwise be unclear: the note has no class and
  // its students span more than one, or a student is outside the note's class.
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

function App() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null); // null until loaded
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Notes and the roster load independently, so the list renders even if names do not.
    api<NoteWithTags[]>("/api/notes").then(setNotes).catch((e) => setError(messageOf(e)));
    (async () => {
      try {
        const list = await api<ClassRow[]>("/api/classes");
        setClasses(list);
        if (list.length === 0) {
          throw new Error(import.meta.env.DEV ? "No classes found. Run `npm run db:seed:local`." : "No classes set up yet.");
        }
        const rosters = await Promise.all(list.map((c) => api<RosterStudent[]>(`/api/classes/${c.id}/students`)));
        setPeople(new Map(rosters.flat().map((s) => [s.id, { name: `${s.firstName} ${s.lastName}`, classId: s.classId }])));
      } catch (e) {
        setError(messageOf(e));
      }
    })();
  }, []);

  const classNames = new Map((classes ?? []).map((c) => [c.id, c.name]));

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Throughline</h1>
      <p className="mt-1 text-sm text-gray-500">
        {classes === null ? "Loading…" : `${classes.length} ${classes.length === 1 ? "class" : "classes"}`} · synthetic demo, no real students
      </p>

      <NoteForm onCreated={(note) => setNotes((prev) => [note, ...prev])} />
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <ul className="mt-6 divide-y divide-gray-200">
        {notes.map((n) => (
          <li key={n.id} className="py-3">
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <time dateTime={n.notedAt}>{dateFormat.format(new Date(n.notedAt))}</time>
              {n.kind === "voice" && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">voice</span>}
              <span className={n.classId ? "rounded bg-gray-100 px-1.5 py-0.5 text-gray-700" : "text-gray-400"}>
                {n.classId ? (classNames.get(n.classId) ?? "class") : "unassigned"}
              </span>
            </p>
            <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
            <Tags note={n} people={people} classNames={classNames} />
          </li>
        ))}
        {notes.length === 0 && <li className="py-3 text-sm text-gray-500">No notes yet.</li>}
      </ul>
    </main>
  );
}

export default App;
