import type { NoteWithTags } from "../../worker/api-types";
import { api, jsonInit } from "../api";
import { errorText } from "../ui";
import { useAction } from "../useAction";

// Who a student id is, and which class, for display.
export type Person = { name: string; classId: string };

const smallButton = "rounded border border-amber-300 bg-white px-1.5 py-0.5 text-amber-900 hover:bg-amber-50 disabled:opacity-40";

// A note's tags, each removable, and its open mentions, each settled by picking a candidate
// or Neither. A student's class is shown only when it would otherwise be unclear: the note
// has no class and its students span more than one, a student is outside the note's class,
// or a mention's candidates are in different classes.
export default function Tags({
  note,
  people,
  classNames,
  onChange,
}: {
  note: NoteWithTags;
  people: Map<string, Person>;
  classNames: Map<string, string>;
  onChange: (note: NoteWithTags) => void;
}) {
  // Every route here answers with the note as it now stands; the list swaps it in.
  const { run, busy, error } = useAction(async (path: string, init?: RequestInit) => onChange(await api<NoteWithTags>(path, init)));
  const label = (p: Person | undefined, withClass: boolean) =>
    p ? (withClass ? `${p.name} (${classNames.get(p.classId) ?? "class"})` : p.name) : "Unknown student";
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
        const name = label(p, note.classId === null ? spans : p?.classId !== note.classId);
        return (
          <div key={s.studentId}>
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800">
              {name}
              <button
                type="button"
                aria-label={`Remove tag: ${name}`}
                disabled={busy}
                className="text-gray-400 hover:text-gray-900 disabled:opacity-40"
                onClick={() => run(`/api/notes/${note.id}/students/${s.studentId}`, { method: "DELETE" })}
              >
                ×
              </button>
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
          <div key={m.id} className="flex flex-wrap items-center gap-1 text-xs text-amber-700">
            <span>Unsure who “{m.mentionText}” is:</span>
            {m.candidateIds.map((id) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                className={smallButton}
                onClick={() => run(`/api/notes/${note.id}/mentions/${m.id}/assign`, jsonInit("POST", { studentId: id }))}
              >
                {label(people.get(id), spansClasses)}
              </button>
            ))}
            <button type="button" disabled={busy} className={smallButton} onClick={() => run(`/api/notes/${note.id}/mentions/${m.id}`, { method: "DELETE" })}>
              Neither
            </button>
          </div>
        );
      })}
      {error && <p className={errorText}>{error}</p>}
    </div>
  );
}
