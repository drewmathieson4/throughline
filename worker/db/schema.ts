// Throughline database schema.
// Drizzle reads this file to (a) type every query and (b) generate SQL migrations.
// Conventions: text ids (UUIDs minted in the Worker), ISO-8601 strings for dates,
// integer 0/1 for booleans (SQLite has no boolean type).
import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

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
    // Reserved for the Phase 3 privacy layer: the name the model sees instead of the real one.
    pseudonym: text("pseudonym"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("students_class_idx").on(t.classId)],
);

// A note is anything the teacher captured. kind tells us where it came from.
// A note with no rows in note_students is class-level context (a project, a hard unit).
export const noteKinds = ["text", "voice", "student_form", "progress_report"] as const;
export type NoteKind = (typeof noteKinds)[number];

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: noteKinds }).notNull(),
    body: text("body").notNull(),
    audioKey: text("audio_key"), // R2 object key, Phase 2
    notedAt: text("noted_at").notNull(), // when the observation happened
    createdAt: text("created_at").notNull(), // when the row was written
  },
  (t) => [index("notes_class_idx").on(t.classId), index("notes_noted_at_idx").on(t.notedAt)],
);

// One note can be about several students. confirmed=1 once the teacher has approved the tag.
export const noteStudents = sqliteTable(
  "note_students",
  {
    noteId: text("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    confirmed: integer("confirmed").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.studentId] }), index("note_students_student_idx").on(t.studentId)],
);

export const gradeEntries = sqliteTable(
  "grade_entries",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    assignment: text("assignment").notNull(),
    category: text("category"),
    score: real("score"), // null = missing work
    maxScore: real("max_score").notNull(),
    dueDate: text("due_date").notNull(),
  },
  (t) => [index("grade_entries_student_idx").on(t.studentId)],
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
