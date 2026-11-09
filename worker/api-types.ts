// Response shapes the routes compose from more than one table. The frontend imports these
// type-only, like the row types in db/schema.ts, so a renamed column fails typecheck in
// both places instead of drifting. Kept free of Hono and Env imports for that reason.
import type { ClassMaterial, ClassRow, Note, NoteKind, NoteMention, NoteStudent, ReportRow, Student, SynthesisRow, User } from "./db/schema";

// What a demo visitor has left of the demo's allowance (worker/demo.ts): notes to capture,
// evidence summaries and reports to write.
export type DemoAllowance = { notesLeft: number; evidenceLeft: number; reportsLeft: number };
// What the account's model calls have cost against its cap (worker/spend.ts). off says
// why the models are switched off: this account is over its cap, or the whole app is over
// its total; null while they run.
export type AiAllowance = { spentUsd: number; capUsd: number; off: "account" | "total" | null };
// Who is signed in, as /api/auth/me reports it: never the Google id behind the account.
// demo is null for a teacher.
export type SessionUser = Pick<User, "id" | "email" | "name" | "pictureUrl"> & { demo: DemoAllowance | null; ai: AiAllowance };

// What the upload routes read; the file pickers in the browser offer the same set.
export type UploadExtension = "pdf" | "docx" | "txt" | "md";

// A course material as the API lists it: everything but the text, which only the synthesis
// prompt will read. The page shows the summary.
export type MaterialRow = Omit<ClassMaterial, "text">;

// lastNotedAt: noted_at of the newest note tagged to the student, null when none has named
// them yet. unsureCount: open mentions the student is a candidate for.
export type RosterStudent = Student & { noteCount: number; unsureCount: number; lastNotedAt: string | null };
export type StudentDetail = { student: Student; notes: Note[]; grades: GradeSummary | null };

// What /api/notes returns: a note with its student tags and any open mentions.
export type NoteWithTags = Note & {
  students: Pick<NoteStudent, "studentId" | "quotes">[];
  mentions: Omit<NoteMention, "noteId" | "createdAt">[];
};
export type TaggingStatus = "done" | "failed";
// What POST /api/notes, POST /api/notes/voice, and POST /api/notes/:id/retag return.
export type TaggedNoteResponse = NoteWithTags & { tagging: TaggingStatus };
// What a contextual document is: about the course (stored as course material), about
// students (one note per student), or both.
export type DocumentKind = "course" | "students" | "both";
// What POST /api/documents returns. materials: one row per picked class when the document
// is about the course. notes: one per student it was about, plus a note with an open
// mention for each name it could not settle. replaced: ids of the notes an earlier import
// of the same file into these classes made, now gone (its materials go too). splitFailed:
// a document of both kinds whose students could not be read out; the material was kept.
export type DocumentImportResult = {
  name: string;
  kind: DocumentKind;
  classIds: string[];
  materials: MaterialRow[];
  notes: NoteWithTags[];
  replaced: string[];
  splitFailed?: true;
};
// The steps of an import, in the order they start; summarise and split run side by side.
export type DocumentStep = "read" | "sort" | "summarise" | "split" | "save";
// One line of the import's stream: a step starting or ending, then the outcome.
export type DocumentProgress = { step: DocumentStep; done?: true } | { status: 200 | 201; result: DocumentImportResult } | { status: number; error: string };

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

// Grade book import. Same route as the roster: the browser sends the grid, the Worker reads
// it. wide = one row per student and a column per assignment; long = one row per score.
export type GradebookShape = "wide" | "long" | "none";
// students/assignments: distinct ones written; entries: rows written (missing included);
// guessedMax: assignments whose points possible were not in the file.
export type GradeImportResult = { shape: GradebookShape; students: number; assignments: number; entries: number; missing: number; skipped: SkippedRow[]; guessedMax: string[] };

// What the student page shows, computed in code from grade_entries (worker/grades.ts).
// Percents are 0–100, rounded to one decimal. Missing work is counted, not averaged.
export type GradeEntryView = { assignment: string; category: string | null; score: number | null; maxScore: number; pct: number | null; dueDate: string | null };
export type CategorySummary = { category: string; weight: number | null; count: number; missing: number; mean: number | null };
export type Standout = { assignment: string; pct: number; classMean: number | null };
export type GradeTrend = { label: "rising" | "steady" | "slipping"; from: number; to: number };
export type GradeSummary = {
  overall: number;
  weighted: boolean; // overall follows the syllabus weights (every scored category has one)
  count: number; // scored entries
  missing: number;
  byCategory: CategorySummary[]; // best mean first
  strongest: string | null;
  weakest: string | null;
  trend: GradeTrend | null; // first half of the timeline vs the second
  biggestWin: Standout | null; // furthest above the student's own mean, with the class mean there
  biggestLoss: Standout | null;
  entries: GradeEntryView[]; // timeline order
};

// The structured summary of one student over one date range (worker/synthesis-model.ts):
// what the teacher reads before writing the report themselves. Every point cites evidence,
// and each citation is a copy of what it cites taken when the summary was made, so the page
// renders without lookups and a later edit or deletion cannot change what a point rested on.
export type Citation =
  | { type: "note"; noteId: string; notedAt: string; kind: NoteKind; sourceName: string | null; quotes: string[] }
  | { type: "grade"; assignment: string; category: string | null; score: number | null; maxScore: number; pct: number | null; classMean: number | null; dueDate: string | null }
  | { type: "grades" }; // the grade summary, stored once on the synthesis
export type CitedPoint = { point: string; evidence: Citation[] };
export type Highlight = { title: string; story: string; evidence: Citation[] };
export type GoalStatus = "met" | "partly" | "not_yet" | "no_evidence";
export type GoalProgress = { goal: string; status: GoalStatus; point: string; evidence: Citation[] };
// Where the evidence is thin, why, and the question that would fill it.
export type Gap = { area: string; why: string; ask: string };
// How much the summary rests on, counted in code (worker/evidence.ts), never by the model.
export type CoverageLabel = "well_supported" | "thin" | "very_thin";
export type Coverage = {
  label: CoverageLabel;
  notes: number;
  bySource: Partial<Record<NoteKind, number>>;
  lastNotedAt: string | null;
  daysSinceLastNote: number | null; // to the end of the range, or today if that is sooner
  longestSilenceDays: number; // longest run of days in the range with no note
  emptyMonths: string[]; // YYYY-MM months in the range (up to today) with no note
  grades: number; // scored entries
  missing: number;
  undatedGrades: boolean; // entries with no due date, counted in every range
};
export type Synthesis = {
  overview: string; // 200–300 words: how the student is doing, in order, before the detail
  highlights: Highlight[];
  strengths: CitedPoint[];
  growth: CitedPoint[];
  change: CitedPoint[];
  goals: GoalProgress[]; // empty when no course material states goals
  gaps: Gap[];
  coverage: Coverage;
  grades: GradeSummary | null;
};

// The Reports tab. none: never generated for this range; current: the saved summary read
// exactly what is there now; stale: the evidence has changed since; empty: nothing to read.
// newNotes counts notes in the range written after the saved summary. reportId is the newest
// report written from that summary, null when none has been (or the summary was remade).
export type SynthesisStatus = "none" | "current" | "stale" | "empty";
export type SynthesisRosterRow = Pick<Student, "firstName" | "lastName"> & {
  studentId: string;
  status: SynthesisStatus;
  synthesisId: string | null;
  createdAt: string | null;
  newNotes: number;
  reportId: string | null;
};
export type SynthesisView = Omit<SynthesisRow, "inputHash" | "version">;
// cached: the saved summary was returned because nothing had changed; no model call.
export type SynthesisResult = SynthesisView & { cached: boolean };

// The report: the parent-facing comment Opus writes from one saved evidence summary
// (worker/report-model.ts), which the teacher edits before it goes out. generatedText is
// never changed after the write; editedText is the teacher's, null until they touch it.
export type ReportView = ReportRow;

// How a class's reports should read, set by the teacher (settings.report_rules). Every field
// is optional: the prompt has a default for each.
export type ReportRules = {
  sentences?: number; // target length, 2–12
  avoid?: string[]; // phrases the report must not use
  notes?: string; // anything else the writer should know
};
// GET/PUT /api/classes/:id/settings. styleSamples: past comments the teacher pasted, for the voice.
export type ClassSettingsView = { reportRules: ReportRules | null; styleSamples: string | null };
