// Students: one row per child in a class. Leaving the class sets left_at rather than
// deleting, so notes tagged to the student keep their evidence; DELETE is for a student
// who should not be here at all.
import { Hono } from "hono";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { UserEnv } from "../db/client";
import type { ImportedClass, RosterImportResult, RosterStudent, StudentDetail } from "../api-types";
import { insertChunks, notFound, ownedClasses, ownedStudent, pruneMentions, requireClass, requireStudent, selectClasses, selectRoster } from "../db/helpers";
import { classIdQuery, dateField, idParam, nameField, notInFuture } from "../fields";
import { summarise } from "../grades";
import { gradingWeights, selectMaterialSummaries } from "../materials";
import { applyMapping, detectTable, hasNameColumn, planImport, type Grid, type ParsedRow, type Table } from "../roster";
import { suggestMapping } from "../roster-model";
import { modelAccess } from "../spend";
import { validate } from "../validate";


const createStudent = z.object({
  classId: z.uuid(),
  firstName: nameField("firstName"),
  lastName: nameField("lastName"),
});

const patchStudent = z
  .object({
    firstName: nameField("firstName").optional(),
    lastName: nameField("lastName").optional(),
    // A date marks the student as left; null brings them back. Bounded so a year typo
    // cannot hide a student who is still in the room.
    leftAt: dateField("leftAt").refine(notInFuture, "leftAt is in the future").nullish(),
  })
  .refine((p) => Object.keys(p).length > 0, "nothing to update");

// A pasted or uploaded roster. Lines, not students: an export carries metadata rows around
// the table. Cells are capped so a stray notes column cannot balloon the request; names
// themselves are checked per row in applyMapping.
const MAX_IMPORT_LINES = 600;
const MAX_IMPORT_COLUMNS = 30;
const importBody = z.object({
  classId: z.uuid(),
  grid: z
    .array(z.array(z.string().max(200, "a cell is too long")).max(MAX_IMPORT_COLUMNS, "too many columns"))
    .min(1, "nothing to import")
    .max(MAX_IMPORT_LINES, `at most ${MAX_IMPORT_LINES} lines per import`),
});

// D1 binds at most 100 parameters per statement; a student row binds six.
const INSERT_CHUNK = 16;

// The rules first; the model only when they give up, and only when it can be called (a key,
// and the account under its spend cap). A model failure is logged and the import reports
// that it found no names, as with tagging: the import must not depend on it.
async function findTable(grid: Grid, client: Anthropic | null): Promise<Table | null> {
  const table = detectTable(grid);
  if (table) return table;
  if (!client) return null;
  try {
    const m = await suggestMapping({ sample: grid, client });
    return hasNameColumn(m.roles) ? { roles: m.roles, start: m.hasHeader ? 1 : 0, end: grid.length, source: "model" } : null;
  } catch (err) {
    console.error("column mapping failed", err);
    return null;
  }
}

const students = new Hono<UserEnv>();

// POST /api/students/import { classId, grid } → what was added, per class, and which lines
// were skipped and why. No preview: the teacher asked for the file to be imported, and a
// wrong guess is cheaper to fix on the students page than to confirm every time. Students go
// to the class on screen unless the file names several classes (a "Section" column), in which
// case each is matched by name or created. Names already enrolled are skipped, so importing
// the same file twice adds nobody.
students.post("/import", validate("json", importBody), async (c) => {
  const { classId, grid } = c.req.valid("json");
  const db = c.var.db;
  const uid = c.var.user.id;
  const [classes, roster] = await db.batch([selectClasses(db, uid), selectRoster(db, uid)]);
  const selected = classes.find((k) => k.id === classId);
  if (!selected) throw notFound("class");

  const table = await findTable(grid, (await modelAccess(c)).client);
  if (!table) return c.json({ source: "none", classes: [], skipped: [] } satisfies RosterImportResult);
  const parsed = applyMapping(grid, table);

  const now = new Date().toISOString();
  const newClasses: (typeof schema.classes.$inferInsert)[] = [];
  const classByName = new Map(classes.map((k) => [k.name.toLocaleLowerCase(), k]));
  const resolveClass = (name: string) => {
    const key = name.toLocaleLowerCase();
    let k = classByName.get(key);
    if (!k) {
      k = { id: crypto.randomUUID(), name };
      classByName.set(key, k);
      newClasses.push({ ...k, ownerId: uid, createdAt: now });
    }
    return k;
  };
  // One class named (or none) means the file is this class's roster, whatever it calls it.
  // Compare the same way resolveClass does, so "7A" and "7a" count as one class.
  const classNames = new Set(parsed.rows.flatMap((r) => (r.className === null ? [] : [r.className.toLocaleLowerCase()])));
  const multiClass = classNames.size > 1;
  const groups = new Map<string, { id: string; name: string; rows: ParsedRow[] }>();
  for (const row of parsed.rows) {
    const k = multiClass && row.className ? resolveClass(row.className) : selected;
    let g = groups.get(k.id);
    if (!g) groups.set(k.id, (g = { ...k, rows: [] }));
    g.rows.push(row);
  }

  const skipped = [...parsed.skipped];
  const result: ImportedClass[] = [];
  const inserts: (typeof schema.students.$inferInsert)[] = [];
  for (const g of groups.values()) {
    const plan = planImport(g.rows, roster.filter((s) => s.classId === g.id));
    skipped.push(...plan.skipped);
    inserts.push(...plan.added.map((s) => ({ id: crypto.randomUUID(), classId: g.id, createdAt: now, ...s })));
    result.push({ id: g.id, name: g.name, created: newClasses.some((n) => n.id === g.id), added: plan.added, existing: plan.existing });
  }
  // Classes first (students reference them), then students in chunks, all in one transaction.
  const statements = [
    ...newClasses.map((k) => db.insert(schema.classes).values(k)),
    ...insertChunks(db, schema.students, inserts, INSERT_CHUNK),
  ];
  if (statements.length > 0) await db.batch([statements[0]!, ...statements.slice(1)]);
  skipped.sort((a, b) => a.line - b.line);
  return c.json({ source: table.source, classes: result, skipped } satisfies RosterImportResult);
});

// Sorted here rather than in SQL: SQLite's NOCASE collation folds ASCII only, so "Álvarez"
// would land after "Zed". A roster is a few dozen rows, so the JS sort is free.
const byName = new Intl.Collator("en");

// GET /api/students?classId=… → the whole roster, departed students included (left_at set),
// ordered by last name then first name. noteCount is every note tagged to the student and
// lastNotedAt the newest of them; unsureCount is open mentions that could be this student,
// the ones that need the teacher. The client decides whether to show who has left.
students.get("/", validate("query", classIdQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, c.var.user.id, classId);
  const s = schema.students;
  const ns = schema.noteStudents;
  const n = schema.notes;
  const rows = await c.var.db
    .select({
      ...getTableColumns(s),
      noteCount: sql<number>`count(${ns.studentId})`.mapWith(Number),
      lastNotedAt: sql<string | null>`max(${n.notedAt})`,
      // candidate_ids is a JSON array; json_each unnests it.
      unsureCount: sql<number>`(select count(*) from ${schema.noteMentions} m, json_each(m.candidate_ids) j where j.value = ${s.id})`.mapWith(Number),
    })
    .from(s)
    .leftJoin(ns, eq(ns.studentId, s.id))
    .leftJoin(n, eq(n.id, ns.noteId))
    .where(eq(s.classId, classId))
    .groupBy(s.id);
  rows.sort((a, b) => byName.compare(a.lastName, b.lastName) || byName.compare(a.firstName, b.firstName));
  return c.json(rows satisfies RosterStudent[]);
});

// POST /api/students { classId, firstName, lastName } → 201 with the stored row
students.post("/", validate("json", createStudent), async (c) => {
  const { classId, firstName, lastName } = c.req.valid("json");
  await requireClass(c.var.db, c.var.user.id, classId);
  const row = await c.var.db
    .insert(schema.students)
    .values({ id: crypto.randomUUID(), classId, firstName, lastName, createdAt: new Date().toISOString() })
    .returning()
    .get();
  return c.json(row, 201);
});

// GET /api/students/:id → { student, notes, grades }: the notes tagged to this student,
// newest first, and their grade summary (null until a grade book names them), weighted by
// the class's newest material that states grading weights.
students.get("/:id", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const db = c.var.db;
  const n = schema.notes;
  const g = schema.gradeEntries;
  const s = schema.students;
  // Every query only needs the id (the class comes in through subqueries), so one batch.
  // Only the first checks ownership: when it finds nobody the rest are thrown away.
  const mine = inArray(s.classId, ownedClasses(db, c.var.user.id));
  const classOf = db.select({ classId: s.classId }).from(s).where(eq(s.id, id));
  const classmates = db.select({ id: s.id }).from(s).where(inArray(s.classId, classOf));
  const [[student], notes, grades, classGrades, materials] = await db.batch([
    db.select().from(s).where(and(eq(s.id, id), mine)),
    db
      .select(getTableColumns(n))
      .from(schema.noteStudents)
      .innerJoin(n, eq(n.id, schema.noteStudents.noteId))
      .where(eq(schema.noteStudents.studentId, id))
      .orderBy(desc(n.notedAt), desc(n.createdAt)),
    db.select().from(g).where(eq(g.studentId, id)).orderBy(asc(g.position)),
    db.select().from(g).where(inArray(g.studentId, classmates)),
    selectMaterialSummaries(db, classOf),
  ]);
  if (!student) throw notFound("student");
  return c.json({ student, notes, grades: summarise(grades, classGrades, gradingWeights(materials) ?? []) } satisfies StudentDetail);
});

// PATCH /api/students/:id { firstName?, lastName?, leftAt? } → the updated row
students.patch("/:id", validate("param", idParam), validate("json", patchStudent), async (c) => {
  const { id } = c.req.valid("param");
  const patch = c.req.valid("json");
  const row = await c.var.db
    .update(schema.students)
    .set(patch)
    .where(ownedStudent(c.var.db, c.var.user.id, id))
    .returning()
    .get();
  if (!row) throw notFound("student");
  return c.json(row);
});

// DELETE /api/students/:id → 204. A hard delete, for a student who should not be in the app
// at all: their tags, grades, evidence and reports cascade with the row, and open mentions
// stop offering them. The notes stay; one left with no tags reads as class context, which is
// what an untagged note already means. A student who has merely left the class is marked
// (PATCH leftAt), so the evidence survives.
students.delete("/:id", validate("param", idParam), async (c) => {
  const db = c.var.db;
  const uid = c.var.user.id;
  const student = await requireStudent(db, uid, c.req.valid("param").id);
  await db.batch([db.delete(schema.students).where(eq(schema.students.id, student.id)), ...pruneMentions(db, uid)]);
  return c.body(null, 204);
});

export default students;
