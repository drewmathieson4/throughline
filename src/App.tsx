import { useEffect, useState, type FormEvent } from "react";
// Type-only imports: nothing from the Worker ends up in the browser bundle.
import type { ClassRow } from "../worker/db/schema";
import type { NoteWithTags, RosterStudent, TaggedNoteResponse } from "../worker/api";

// Every /api error response is { error: string }; surface that message when present.
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${url} → ${res.status}`);
  return data as T;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function NoteForm({ classId, onCreated }: { classId: string; onCreated: (note: TaggedNoteResponse) => void }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const note = await api<TaggedNoteResponse>("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classId, body: draft }),
      });
      onCreated(note);
      setDraft("");
      if (note.tagging === "failed") setNotice("Saved, but tagging did not run. Students can be added later.");
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
        {saving ? "Saving and tagging…" : "Add note"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-amber-700">{notice}</p>}
    </form>
  );
}

// Read-only for now: suggested tags look tentative, confirmed ones solid, and a name the
// tagger could not resolve is called out so the teacher knows it needs settling.
function Tags({ note, names }: { note: NoteWithTags; names: Map<string, string> }) {
  const nameOf = (id: string) => names.get(id) ?? "Unknown student";
  if (note.students.length === 0 && note.mentions.length === 0) {
    return <p className="mt-1 text-xs text-gray-400">class note</p>;
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {note.students.map((s) => (
        <div key={s.studentId}>
          <span
            className={
              s.confirmed
                ? "rounded-full bg-gray-900 px-2 py-0.5 text-xs text-white"
                : "rounded-full border border-dashed border-gray-400 px-2 py-0.5 text-xs text-gray-700"
            }
            title={s.confirmed ? "Confirmed" : "Suggested"}
          >
            {nameOf(s.studentId)}
          </span>
          {s.quotes.length > 0 && (
            <ul className="mt-0.5 ml-2 text-xs text-gray-500 italic">
              {s.quotes.map((q) => (
                <li key={q}>“{q}”</li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {note.mentions.map((m) => (
        <p key={m.id} className="text-xs text-amber-700">
          Unsure who “{m.mentionText}” is
          {m.candidateIds.length > 0 && `: ${m.candidateIds.map(nameOf).join(" or ")}`}
        </p>
      ))}
    </div>
  );
}

function App() {
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [notes, setNotes] = useState<NoteWithTags[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [first] = await api<ClassRow[]>("/api/classes");
        if (!first) {
          throw new Error(import.meta.env.DEV ? "No class found. Run `npm run db:seed:local`." : "No class set up yet.");
        }
        // Set the class first so the form still renders if the later requests fail. The roster
        // loads on its own so the notes list renders even if it fails (names fall back).
        setCls(first);
        api<RosterStudent[]>(`/api/classes/${first.id}/students`)
          .then((roster) => setNames(new Map(roster.map((s) => [s.id, `${s.firstName} ${s.lastName}`]))))
          .catch((e) => setError(messageOf(e)));
        setNotes(await api<NoteWithTags[]>(`/api/notes?classId=${first.id}`));
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
            <Tags note={n} names={names} />
          </li>
        ))}
        {cls && notes.length === 0 && <li className="py-3 text-sm text-gray-500">No notes yet.</li>}
      </ul>
    </main>
  );
}

export default App;
