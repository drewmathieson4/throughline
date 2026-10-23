// Students: one row per child in a class. Leaving the class sets left_at rather than
// deleting, so notes tagged to the student keep their evidence.
import { Hono } from "hono";
import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { AppEnv } from "../db/client";
import type { RosterStudent, StudentDetail } from "../api-types";
import { notFound, requireClass } from "../db/helpers";
import { classIdQuery, dateField, nameField, notInFuture } from "../fields";
import { validate } from "../validate";

const idParam = z.object({ id: z.uuid() });

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

const students = new Hono<AppEnv>();

// Sorted here rather than in SQL: SQLite's NOCASE collation folds ASCII only, so "Álvarez"
// would land after "Zed". A roster is a few dozen rows, so the JS sort is free.
const byName = new Intl.Collator("en");

// GET /api/students?classId=… → the whole roster, departed students included (left_at set),
// ordered by last name then first name. noteCount is teacher-confirmed tags only;
// pendingCount is AI suggestions awaiting confirmation, kept separate so the number the
// teacher reads for report-readiness is never inflated. The client decides whether to show
// who has left.
students.get("/", validate("query", classIdQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, classId);
  const s = schema.students;
  const ns = schema.noteStudents;
  const rows = await c.var.db
    .select({
      ...getTableColumns(s),
      noteCount: sql<number>`count(CASE WHEN ${ns.confirmed} = 1 THEN 1 END)`.mapWith(Number),
      pendingCount: sql<number>`count(CASE WHEN ${ns.confirmed} = 0 THEN 1 END)`.mapWith(Number),
    })
    .from(s)
    .leftJoin(ns, eq(ns.studentId, s.id))
    .where(eq(s.classId, classId))
    .groupBy(s.id);
  rows.sort((a, b) => byName.compare(a.lastName, b.lastName) || byName.compare(a.firstName, b.firstName));
  return c.json(rows satisfies RosterStudent[]);
});

// POST /api/students { classId, firstName, lastName } → 201 with the stored row
students.post("/", validate("json", createStudent), async (c) => {
  const { classId, firstName, lastName } = c.req.valid("json");
  await requireClass(c.var.db, classId);
  const row = await c.var.db
    .insert(schema.students)
    .values({ id: crypto.randomUUID(), classId, firstName, lastName, createdAt: new Date().toISOString() })
    .returning()
    .get();
  return c.json(row, 201);
});

// GET /api/students/:id → { student, notes } where notes are the ones tagged to this
// student, newest first, each carrying the tag's confirmed flag.
students.get("/:id", validate("param", idParam), async (c) => {
  const { id } = c.req.valid("param");
  const n = schema.notes;
  // Both queries only need the id, so they go to D1 in one batch.
  const [[student], notes] = await c.var.db.batch([
    c.var.db.select().from(schema.students).where(eq(schema.students.id, id)),
    c.var.db
      .select({ ...getTableColumns(n), confirmed: schema.noteStudents.confirmed })
      .from(schema.noteStudents)
      .innerJoin(n, eq(n.id, schema.noteStudents.noteId))
      .where(eq(schema.noteStudents.studentId, id))
      .orderBy(desc(n.notedAt), desc(n.createdAt)),
  ]);
  if (!student) throw notFound("student");
  return c.json({ student, notes } satisfies StudentDetail);
});

// PATCH /api/students/:id { firstName?, lastName?, leftAt? } → the updated row
students.patch("/:id", validate("param", idParam), validate("json", patchStudent), async (c) => {
  const { id } = c.req.valid("param");
  const patch = c.req.valid("json");
  const row = await c.var.db.update(schema.students).set(patch).where(eq(schema.students.id, id)).returning().get();
  if (!row) throw notFound("student");
  return c.json(row);
});

export default students;
