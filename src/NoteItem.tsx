import type { ReactNode } from "react";
import type { Note, NoteKind } from "../worker/db/schema";
import { dateFormat, dateTimeFormat } from "./ui";

// Kinds that get a pill after the time; a plain text note gets none.
const pills: Partial<Record<NoteKind, string>> = { voice: "voice", progress_report: "report" };

// One note in a list. `badge` adds one more pill (the notes page uses it for the class);
// `children` render under the body (the notes page puts the student tags there). A note cut
// from a document has a day, not a time.
export default function NoteItem({ note, badge, children }: { note: Note; badge?: ReactNode; children?: ReactNode }) {
  const when = new Date(note.notedAt);
  const pill = pills[note.kind];
  return (
    <li className="py-3">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <time dateTime={note.notedAt}>{note.kind === "progress_report" ? dateFormat.format(when) : dateTimeFormat.format(when)}</time>
        {pill && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">{pill}</span>}
        {note.sourceName && <span className="min-w-0 truncate">from {note.sourceName}</span>}
        {badge}
      </div>
      <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
      {children}
    </li>
  );
}
