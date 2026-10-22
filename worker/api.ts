// Shapes the API returns beyond plain rows. Kept free of Hono and Env imports so the React
// app can type-import from here under its own tsconfig, and routes, tests, and the page all
// share one definition.
import type { Note, NoteMention, NoteStudent } from "./db/schema";

export type { RosterStudent } from "./tagging";

export type NoteWithTags = Note & {
  students: Pick<NoteStudent, "studentId" | "confirmed" | "quotes">[];
  mentions: Omit<NoteMention, "noteId" | "createdAt">[];
};
export type TaggingStatus = "done" | "failed";
// What POST /api/notes and POST /api/notes/:id/retag return.
export type TaggedNoteResponse = NoteWithTags & { tagging: TaggingStatus };
