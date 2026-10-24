import { ClipboardList, FileText, Mic, PenLine, type LucideIcon } from "lucide-react";
import type { Note, NoteKind } from "../worker/db/schema";
import { dateFormat, dateTimeFormat, shortDateFormat } from "./ui";

// Where a note came from, as a coloured tile and a word; `dot` is the same colour for the
// student page's timeline.
export const kinds: Record<NoteKind, { label: string; icon: LucideIcon; tile: string; dot: string }> = {
  text: { label: "Note", icon: PenLine, tile: "bg-accent text-accent-foreground", dot: "bg-primary" },
  voice: { label: "Voice note", icon: Mic, tile: "bg-coral text-coral-foreground", dot: "bg-coral-dot" },
  progress_report: { label: "From a document", icon: FileText, tile: "bg-sky text-sky-foreground", dot: "bg-sky-foreground" },
  student_form: { label: "Student form", icon: ClipboardList, tile: "bg-mint text-mint-foreground", dot: "bg-mint-dot" },
};

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

// When a note was made. A note cut from a document has a day, not a time. `timeOnly` is for
// lists already grouped under a day heading.
export function noteWhen(note: Note, timeOnly = false) {
  const when = new Date(note.notedAt);
  if (note.kind === "progress_report") return (timeOnly ? shortDateFormat : dateFormat).format(when);
  return (timeOnly ? timeFormat : dateTimeFormat).format(when);
}
