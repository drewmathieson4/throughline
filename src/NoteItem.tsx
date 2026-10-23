import type { ReactNode } from "react";
import type { Note } from "../worker/db/schema";
import { cn } from "@/lib/utils";
import { kinds, noteWhen } from "./noteKinds";

// One note as a card. `badge` sits at the right of the header (the notes page puts the class
// there); `children` render under the body (the notes page puts the student tags there).
// `fresh` fades in a note saved a moment ago.
export default function NoteItem({ note, badge, timeOnly, fresh, children }: { note: Note; badge?: ReactNode; timeOnly?: boolean; fresh?: boolean; children?: ReactNode }) {
  const { label, icon: Icon, tile } = kinds[note.kind];
  return (
    <li className={cn("rounded-[20px] border bg-card px-4 pt-4 pb-3.5 shadow-xs", fresh && "animate-in duration-500 fade-in slide-in-from-bottom-2")}>
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className={cn("inline-flex size-7 flex-none items-center justify-center rounded-[9px]", tile)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="font-bold text-secondary-foreground">{label}</span>
        <span aria-hidden>·</span>
        <time dateTime={note.notedAt}>{noteWhen(note, timeOnly)}</time>
        <span className="flex-1" />
        {badge}
      </div>
      {note.sourceName && (
        <p className="mt-2.5 truncate text-[12.5px] text-muted-foreground">
          From <span className="font-semibold text-secondary-foreground">{note.sourceName}</span>
        </p>
      )}
      <p className="mt-2.5 text-[15px] leading-[1.55] whitespace-pre-wrap">{note.body}</p>
      {children}
    </li>
  );
}
