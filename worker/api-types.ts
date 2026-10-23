// Response shapes the routes compose from more than one table. The frontend imports these
// type-only, like the row types in db/schema.ts, so a renamed column fails typecheck in
// both places instead of drifting. Kept free of Hono and Env imports for that reason.
import type { ClassRow, Note, NoteMention, NoteStudent, Student } from "./db/schema";

// lastNotedAt: noted_at of the newest note tagged to the student, null when none has named
// them yet. unsureCount: open mentions the student is a candidate for.
export type RosterStudent = Student & { noteCount: number; unsureCount: number; lastNotedAt: string | null };
export type StudentDetail = { student: Student; notes: Note[] };

// What /api/notes returns: a note with its student tags and any open mentions.
export type NoteWithTags = Note & {
  students: Pick<NoteStudent, "studentId" | "quotes">[];
  mentions: Omit<NoteMention, "noteId" | "createdAt">[];
};
export type TaggingStatus = "done" | "failed";
// What POST /api/notes, POST /api/notes/voice, and POST /api/notes/:id/retag return.
export type TaggedNoteResponse = NoteWithTags & { tagging: TaggingStatus };

// Roster import. The browser sends the pasted or uploaded spreadsheet as a grid of cells; the
// Worker finds the students in it and adds them, splitting them across classes when the
// file names more than one.
export type ColumnRole = "first" | "last" | "full_first_last" | "full_last_first" | "preferred" | "class" | "ignore";
// How the table was found: its header row, the shape of the data, the model, or not at all.
export type MappingSource = "header" | "content" | "model" | "none";
export type NameRow = Pick<Student, "firstName" | "lastName" | "aliases">;
// A line of the grid that did not become a student, with the reason, so the teacher can see it.
export type SkippedRow = { line: number; cells: string[]; reason: string };
export type ImportedClass = Pick<ClassRow, "id" | "name"> & { created: boolean; added: NameRow[]; existing: NameRow[] };
export type RosterImportResult = { source: MappingSource; classes: ImportedClass[]; skipped: SkippedRow[] };
