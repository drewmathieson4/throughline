// Response shapes the routes compose from more than one table. The frontend imports these
// type-only, like the row types in db/schema.ts, so a renamed column fails typecheck in
// both places instead of drifting. Kept free of Hono and Env imports for that reason.
import type { Note, NoteMention, NoteStudent, Student } from "./db/schema";

export type RosterStudent = Student & { noteCount: number; pendingCount: number };
export type StudentDetail = { student: Student; notes: (Note & { confirmed: number })[] };

// What /api/notes returns: a note with its student tags and any open mentions.
export type NoteWithTags = Note & {
  students: Pick<NoteStudent, "studentId" | "confirmed" | "quotes">[];
  mentions: Omit<NoteMention, "noteId" | "createdAt">[];
};
export type TaggingStatus = "done" | "failed";
// What POST /api/notes, POST /api/notes/voice, and POST /api/notes/:id/retag return.
export type TaggedNoteResponse = NoteWithTags & { tagging: TaggingStatus };
