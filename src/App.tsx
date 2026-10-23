import { useEffect, useState, type FormEvent } from "react";
// Type-only import: nothing from the Worker ends up in the browser bundle.
import type { ClassRow, Note } from "../worker/db/schema";
import { api, jsonInit, messageOf } from "./api";
import NoteItem from "./NoteItem";
import StudentsPage from "./students/StudentsPage";
import { button, errorText, fieldLabel, input, subtleButton } from "./ui";
import { useAction } from "./useAction";
import { useRecorder } from "./useRecorder";

const MAX_RECORDING_MS = 5 * 60 * 1000;

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function NoteForm({ classId, onCreated }: { classId: string; onCreated: (note: Note) => void }) {
  const [draft, setDraft] = useState("");
  // Which kind of note is being saved right now; text and voice saves never overlap. Two
  // actions that must know which one is in flight, so this form does not use useAction.
  const [pending, setPending] = useState<"text" | "voice" | null>(null);
  // Shown once a recording that stopped at the time limit has actually been saved.
  const [hitLimit, setHitLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Posts one note and hands it to the list. False means it failed and the error is on screen.
  async function save(kind: "text" | "voice", url: string, init: RequestInit) {
    setPending(kind);
    setError(null);
    try {
      onCreated(await api<Note>(url, init));
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
      const saved = await save("voice", `/api/notes/voice?classId=${classId}`, {
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
    const saved = await save("text", "/api/notes", jsonInit("POST", { classId, body: draft }));
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
              "Transcribing…"
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
          {pending === "text" ? "Saving…" : "Add note"}
        </button>
      </div>
      {error && <p className={errorText}>{error}</p>}
    </form>
  );
}

function NotesView({ classId }: { classId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Note[]>(`/api/notes?classId=${classId}`)
      .then(setNotes)
      .catch((e) => setError(messageOf(e)));
  }, [classId]);

  return (
    <>
      <NoteForm classId={classId} onCreated={(note) => setNotes((prev) => [note, ...prev])} />
      {error && <p className={`mt-4 ${errorText}`}>{error}</p>}

      <ul className="mt-6 divide-y divide-gray-200">
        {notes.map((n) => (
          <NoteItem key={n.id} note={n} />
        ))}
        {notes.length === 0 && <li className="py-3 text-sm text-gray-500">No notes yet.</li>}
      </ul>
    </>
  );
}

function NewClassForm({ onCreated, onCancel }: { onCreated: (c: ClassRow) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [termStart, setTermStart] = useState("");
  const [termEnd, setTermEnd] = useState("");
  const { run: submit, busy: saving, error } = useAction(async () => {
    onCreated(await api<ClassRow>("/api/classes", jsonInit("POST", { name, termStart: termStart || undefined, termEnd: termEnd || undefined })));
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-4 flex flex-wrap items-end gap-2 rounded border border-gray-200 p-3"
    >
      <label className={fieldLabel}>
        Class name
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        Term start
        <input type="date" className={input} value={termStart} onChange={(e) => setTermStart(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        Term end
        <input type="date" className={input} value={termEnd} onChange={(e) => setTermEnd(e.target.value)} />
      </label>
      <button type="submit" className={button} disabled={saving || !name.trim()}>
        {saving ? "Creating…" : "Create class"}
      </button>
      {onCancel && (
        <button type="button" className={subtleButton} onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && <p className={`w-full ${errorText}`}>{error}</p>}
    </form>
  );
}

const views = [
  ["notes", "Notes"],
  ["students", "Students"],
] as const;
type View = (typeof views)[number][0];

const STORED_CLASS_KEY = "throughline.classId";
// Storage can be blocked (private mode, embedded pages); remembering the class is a nicety, not a need.
const readStoredClass = () => {
  try {
    return localStorage.getItem(STORED_CLASS_KEY);
  } catch {
    return null;
  }
};
const storeClass = (id: string) => {
  try {
    localStorage.setItem(STORED_CLASS_KEY, id);
  } catch {
    /* ignore */
  }
};

function App() {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [classId, setClassId] = useState<string | null>(readStoredClass);
  const [view, setView] = useState<View>("notes");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ClassRow[]>("/api/classes").then(setClasses).catch((e) => setError(messageOf(e)));
  }, []);

  // classId is a preference (the teacher's pick, or the remembered one); the shown class is
  // derived from it so a remembered id that no longer exists falls back to the first class
  // wherever the list changes, not only in the fetch above.
  const cls = classes?.find((c) => c.id === classId) ?? classes?.[0] ?? null;
  const shownId = cls?.id;
  useEffect(() => {
    if (shownId) storeClass(shownId);
  }, [shownId]);

  function onClassCreated(c: ClassRow) {
    setClasses((prev) => [...(prev ?? []), c]);
    setClassId(c.id);
    setCreating(false);
    setView("students");
  }

  // With no class yet the form is the whole page and cannot be cancelled.
  const noClasses = classes?.length === 0;
  const hasClasses = !!classes?.length;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Throughline</h1>
        {hasClasses && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Class"
              className={input}
              value={shownId ?? ""}
              onChange={(e) => setClassId(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="button" className={subtleButton} onClick={() => setCreating(true)}>
              New class
            </button>
          </div>
        )}
      </header>
      <p className="mt-1 text-sm text-gray-500">
        {classes ? (cls?.name ?? "No class yet") : error ? "Classes unavailable" : "Loading…"} · synthetic demo class, no real students
      </p>
      {error && <p className={`mt-4 ${errorText}`}>{error}</p>}

      {noClasses && <p className="mt-6 text-sm">Create your first class to start adding students and notes.</p>}
      {(noClasses || creating) && <NewClassForm onCreated={onClassCreated} onCancel={noClasses ? undefined : () => setCreating(false)} />}

      {cls && (
        <>
          <nav className="mt-4 flex gap-1 border-b border-gray-200">
            {views.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`px-3 py-2 text-sm ${view === key ? "border-b-2 border-gray-900 font-medium" : "text-gray-500"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          {view === "notes" && <NotesView key={cls.id} classId={cls.id} />}
          {view === "students" && <StudentsPage key={cls.id} classId={cls.id} />}
        </>
      )}
    </main>
  );
}

export default App;
