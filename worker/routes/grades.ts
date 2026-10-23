// Grade book import. The browser sends the spreadsheet as a grid of cells (the same path as
// the roster import); the Worker reads it (worker/gradebook.ts), matches each row to the
// class roster, fills in categories, and upserts one row per student per assignment. No
// preview: the summary says what was written and what was skipped. See DECISIONS.md.
import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { AppEnv } from "../db/client";
import type { GradeImportResult } from "../api-types";
import { requireClass, selectRoster } from "../db/helpers";
import { OTHER, categorise, defaultCategories, matchStudents, parseGradebook, type MatchedEntry } from "../gradebook";
import { categoriseAssignments } from "../gradebook-model";
import { gradingWeights, selectMaterialSummaries } from "../materials";
import { validate } from "../validate";

// A term's grade book: a few hundred rows of students or scores, a column per assignment.
const MAX_IMPORT_LINES = 600;
const MAX_IMPORT_COLUMNS = 200;
const importBody = z.object({
  classId: z.uuid(),
  grid: z
    .array(z.array(z.string().max(200, "a cell is too long")).max(MAX_IMPORT_COLUMNS, "too many columns"))
    .min(1, "nothing to import")
    .max(MAX_IMPORT_LINES, `at most ${MAX_IMPORT_LINES} lines per import`),
});

// D1 binds at most 100 parameters per statement; an entry binds eight.
const UPSERT_CHUNK = 12;

// Categories for the entries whose file did not state one: the rules on the title, then
// Haiku for the titles left (titles only, never scores or names), then "other". A model
// failure is logged and costs only the categories, like the roster's column mapping.
async function fillCategories(entries: MatchedEntry[], syllabus: string[] | null, apiKey: string | undefined): Promise<void> {
  const unplaced = new Set<string>();
  for (const e of entries) {
    if (e.category !== null) continue;
    e.category = categorise(e.assignment, syllabus);
    if (e.category === null) unplaced.add(e.assignment);
  }
  let fromModel = new Map<string, string>();
  if (unplaced.size > 0 && apiKey) {
    try {
      fromModel = await categoriseAssignments({ titles: [...unplaced], categories: syllabus ?? defaultCategories, client: new Anthropic({ apiKey }) });
    } catch (err) {
      console.error("categorising assignments failed", err);
    }
  }
  for (const e of entries) if (e.category === null) e.category = fromModel.get(e.assignment) ?? OTHER;
}

const grades = new Hono<AppEnv>();

// POST /api/grades/import { classId, grid } → what was written and which lines were skipped.
// Students are matched to the class roster by name and never created. Importing the same
// file twice writes the same rows: (student, assignment) is unique and the second import
// updates them in place. Entries missing from a later file are kept.
grades.post("/import", validate("json", importBody), async (c) => {
  const { classId, grid } = c.req.valid("json");
  const db = c.var.db;
  await requireClass(db, classId);
  const [roster, materials] = await db.batch([selectRoster(db, classId), selectMaterialSummaries(db, classId)]);

  const parsed = parseGradebook(grid);
  const empty: GradeImportResult = { shape: parsed.shape, students: 0, assignments: 0, entries: 0, missing: 0, skipped: [], guessedMax: [] };
  if (parsed.shape === "none") return c.json(empty);

  const { matched, skipped } = matchStudents(parsed.entries, roster);
  const weights = gradingWeights(materials);
  await fillCategories(matched, weights ? weights.map((w) => w.category) : null, c.env.ANTHROPIC_API_KEY);

  // The last line wins when a file names the same student and assignment twice.
  const byKey = new Map<string, MatchedEntry>();
  for (const e of matched) byKey.set(`${e.studentId}\u0000${e.assignment}`, e);
  const rows = [...byKey.values()].map(
    (e): typeof schema.gradeEntries.$inferInsert => ({
      id: crypto.randomUUID(),
      studentId: e.studentId,
      assignment: e.assignment,
      category: e.category,
      score: e.score,
      maxScore: e.maxScore,
      dueDate: e.dueDate,
      position: e.position,
    }),
  );
  const g = schema.gradeEntries;
  const statements = Array.from({ length: Math.ceil(rows.length / UPSERT_CHUNK) }, (_, i) =>
    db
      .insert(g)
      .values(rows.slice(i * UPSERT_CHUNK, (i + 1) * UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [g.studentId, g.assignment],
        set: { category: sql`excluded.category`, score: sql`excluded.score`, maxScore: sql`excluded.max_score`, dueDate: sql`excluded.due_date`, position: sql`excluded.position` },
      }),
  );
  if (statements.length > 0) await db.batch([statements[0]!, ...statements.slice(1)]);

  const all = [...parsed.skipped, ...skipped].sort((a, b) => a.line - b.line);
  return c.json({
    shape: parsed.shape,
    students: new Set(rows.map((r) => r.studentId)).size,
    assignments: new Set(rows.map((r) => r.assignment)).size,
    entries: rows.length,
    missing: rows.filter((r) => r.score === null).length,
    skipped: all,
    guessedMax: parsed.guessedMax,
  } satisfies GradeImportResult);
});

export default grades;
