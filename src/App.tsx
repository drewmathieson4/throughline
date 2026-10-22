import { useEffect, useState, type FormEvent } from "react";
// Type-only import: nothing from the Worker ends up in the browser bundle.
import type { ClassRow, Note } from "../worker/db/schema";
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

function NoteForm({ classId, onCreated }: { classId: string; onCreated: (note: Note) => void }) {
  const [draft, setDraft] = useState("");
  // Which kind of note is being saved right now; text and voice saves never overlap.
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
    const saved = await save("text", "/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ classId, body: draft }),
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
        <button
          type="submit"
          disabled={busy || recorder.recording || !draft.trim()}
          className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-40"
        >
          {pending === "text" ? "Saving…" : "Add note"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function App() {
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [first] = await api<ClassRow[]>("/api/classes");
        if (!first) {
          throw new Error(import.meta.env.DEV ? "No class found. Run `npm run db:seed:local`." : "No class set up yet.");
        }
        // Set the class first so the form still renders if the notes request fails.
        setCls(first);
        setNotes(await api<Note[]>(`/api/notes?classId=${first.id}`));
      } catch (e) {
        setError(messageOf(e));
      }
    })();
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Throughline</h1>
      <p className="mt-1 text-sm text-gray-500">
        {cls ? cls.name : "Loading…"} · synthetic demo class, no real students
      </p>

      {cls && <NoteForm classId={cls.id} onCreated={(note) => setNotes((prev) => [note, ...prev])} />}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <ul className="mt-6 divide-y divide-gray-200">
        {notes.map((n) => (
          <li key={n.id} className="py-3">
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <time dateTime={n.notedAt}>{dateFormat.format(new Date(n.notedAt))}</time>
              {n.kind === "voice" && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">voice</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
        {cls && notes.length === 0 && <li className="py-3 text-sm text-gray-500">No notes yet.</li>}
      </ul>
    </main>
  );
}

export default App;
