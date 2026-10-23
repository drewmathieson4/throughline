import type { ReactNode } from "react";
import type { Note } from "../worker/db/schema";
import { dateTimeFormat } from "./ui";

// One note in a list. Voice notes get a pill after the time; `badge` adds one more (the
// student page uses it for the tag's confirmation state, the notes page for the class);
// `children` render under the body (the notes page puts the student tags there).
export default function NoteItem({ note, badge, children }: { note: Note; badge?: ReactNode; children?: ReactNode }) {
  return (
    <li className="py-3">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <time dateTime={note.notedAt}>{dateTimeFormat.format(new Date(note.notedAt))}</time>
        {note.kind === "voice" && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">voice</span>}
        {badge}
      </div>
      <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
      {children}
    </li>
  );
}
