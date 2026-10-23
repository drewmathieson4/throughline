// Throughline database schema.
// Drizzle reads this file to (a) type every query and (b) generate SQL migrations.
// Conventions: text ids (UUIDs minted in the Worker), ISO-8601 strings for dates,
// integer 0/1 for booleans (SQLite has no boolean type).
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// JSON array of strings stored as text. SQLite has no array type; at this scale a JSON
// column beats a join table, and Drizzle parses/serializes it for us (mode: "json").
const stringList = (name: string) =>
  text(name, { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`);

export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  termStart: text("term_start"),
  termEnd: text("term_end"),
  createdAt: text("created_at").notNull(),
});

export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // Other names the teacher uses for this student ("Juni" for Juniper). The tagger sees them.
    aliases: stringList("aliases"),
    // Reserved for the Phase 3 privacy layer: the name the model sees instead of the real one.
    pseudonym: text("pseudonym"),
    createdAt: text("created_at").notNull(),
    // Set when the student leaves the class. The row and its note tags stay so the
    // evidence survives; the active roster is WHERE left_at IS NULL.
    leftAt: text("left_at"),
  },
  (t) => [index("students_class_idx").on(t.classId)],
);

// A note is anything the teacher captured. kind tells us where it came from.
// A note is written without a class; tagging sets class_id from the students it finds (or
// from a class named in the text). Null means not yet assigned. A note with a class and no
// rows in note_students is class-level context (a project, a hard unit).
export const noteKinds = ["text", "voice", "student_form", "progress_report"] as const;
export type NoteKind = (typeof noteKinds)[number];

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").references(() => classes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: noteKinds }).notNull(),
    body: text("body").notNull(),
    audioKey: text("audio_key"), // R2 object key, Phase 2
    // The uploaded file a note was cut from (a progress report), so the list can say so.
    sourceName: text("source_name"),
    notedAt: text("noted_at").notNull(), // when the observation happened
    createdAt: text("created_at").notNull(), // when the row was written
  },
  (t) => [index("notes_class_idx").on(t.classId), index("notes_noted_at_idx").on(t.notedAt)],
);

// One note can be about several students. A row is a live tag the moment it is written,
// whether the tagger or the teacher wrote it; a name the tagger could not settle goes to
// note_mentions instead, so there is no "unconfirmed" state. quotes are the verbatim spans of
// the note body about this student, verified to exist in the body before they are stored;
// they are the evidence synthesis cites.
export const noteStudents = sqliteTable(
  "note_students",
  {
    noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    quotes: stringList("quotes"),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.studentId] }), index("note_students_student_idx").on(t.studentId)],
);

// A name the tagger saw but could not pin to one student ("Alex" when two Alexes are enrolled).
// Only open mentions live here: assigning one creates a note_students row and deletes it;
// dismissing deletes it. candidate_ids are the students the tagger thought plausible (may be empty).
export const noteMentions = sqliteTable(
  "note_mentions",
  {
    id: text("id").primaryKey(),
    noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    mentionText: text("mention_text").notNull(),
    quotes: stringList("quotes"),
    candidateIds: stringList("candidate_ids"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("note_mentions_note_idx").on(t.noteId)],
);

// What Haiku pulls out of a course document (a syllabus, a unit plan, a grading policy): the
// structure the synthesis reads and the grade summary weights by. Every list may be empty;
// the model is told to leave out what the document does not say.
export type CourseSummary = {
  description: string; // one line: what this document is
  goals: string[]; // what students should learn or be able to do
  grading: { category: string; weight: number }[]; // percent of the grade per category
  units: { name: string; when: string | null }[]; // topics in order, with timing when stated
  policies: string[]; // late work, retakes, participation: one short line each
};

// A course document the teacher uploaded for one class. The text is kept whole for the
// synthesis prompt; summary is the structure the model read out of it, null when the model
// could not be asked. Not a note: undated, about the course rather than a student.
export const classMaterials = sqliteTable(
  "class_materials",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // the uploaded file's name
    text: text("text").notNull(),
    summary: text("summary", { mode: "json" }).$type<CourseSummary>(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("class_materials_class_idx").on(t.classId)],
);

// One score per student per assignment, imported from the teacher's grade book. The
// (student, assignment) pair is unique so a re-upload updates rather than duplicates.
// position is the assignment's order in the file: the timeline when there are no due dates.
export const gradeEntries = sqliteTable(
  "grade_entries",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    assignment: text("assignment").notNull(),
    category: text("category"),
    score: real("score"), // null = missing work
    maxScore: real("max_score").notNull(),
    dueDate: text("due_date"), // YYYY-MM-DD; wide exports rarely carry one
    position: integer("position").notNull(),
  },
  (t) => [index("grade_entries_student_idx").on(t.studentId), uniqueIndex("grade_entries_student_assignment_idx").on(t.studentId, t.assignment)],
);

// One row per synthesis run. input_hash lets us skip a rerun when nothing changed.
export const syntheses = sqliteTable(
  "syntheses",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    json: text("json").notNull(), // the validated synthesis object, serialized
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("syntheses_student_idx").on(t.studentId)],
);

// Generated text and the teacher's edits are kept apart so we can measure how much gets changed.
export const reportDrafts = sqliteTable("report_drafts", {
  id: text("id").primaryKey(),
  synthesisId: text("synthesis_id").notNull().references(() => syntheses.id, { onDelete: "cascade" }),
  generatedText: text("generated_text").notNull(),
  editedText: text("edited_text"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  classId: text("class_id").primaryKey().references(() => classes.id, { onDelete: "cascade" }),
  styleSamples: text("style_samples"), // teacher's own past reports, never seeded with real data
  reportRules: text("report_rules"), // JSON: target length, banned phrases, etc.
});

// Row types as the API returns them; the frontend imports these (type-only) too.
export type ClassRow = typeof classes.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type NoteStudent = typeof noteStudents.$inferSelect;
export type NoteMention = typeof noteMentions.$inferSelect;
export type ClassMaterial = typeof classMaterials.$inferSelect;
export type GradeEntry = typeof gradeEntries.$inferSelect;
