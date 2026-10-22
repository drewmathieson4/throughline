import { useEffect, useState, type FormEvent } from "react";
// Type-only import: nothing from the Worker ends up in the browser bundle.
import type { ClassRow, Note } from "../worker/db/schema";

// Every /api error response is { error: string }; surface that message when present.
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${url} → ${res.status}`);
  return data as T;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function NoteForm({ classId, onCreated }: { classId: string; onCreated: (note: Note) => void }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const note = await api<Note>("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classId, body: draft }),
      });
      onCreated(note);
      setDraft("");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-2">
      <label htmlFor="note" className="text-sm font-medium">
        New note
      </label>
      <textarea
        id="note"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder="What did you notice today?"
        className="rounded border border-gray-300 p-2"
      />
      <button
        type="submit"
        disabled={saving || !draft.trim()}
        className="self-end rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Add note"}
      </button>
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
            <time dateTime={n.notedAt} className="block text-xs text-gray-500">
              {dateFormat.format(new Date(n.notedAt))}
            </time>
            <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
        {cls && notes.length === 0 && <li className="py-3 text-sm text-gray-500">No notes yet.</li>}
      </ul>
    </main>
  );
}

export default App;
