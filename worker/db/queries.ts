// Lookups more than one route needs. The require* guards throw the 404 that app.onError
// turns into { error }, so routes read as one guard per rule.
import { HTTPException } from "hono/http-exception";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { Note } from "./schema";
import type { Db } from "./client";
import type { RosterStudent, TagClass } from "../tagging";

export async function requireClass(db: Db, classId: string) {
  const row = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId)).get();
  if (!row) throw new HTTPException(404, { message: "class not found" });
}

export async function requireNote(db: Db, noteId: string): Promise<Note> {
  const row = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId)).get();
  if (!row) throw new HTTPException(404, { message: "note not found" });
  return row;
}

// A student the teacher names must exist. Any class is allowed: a note may span classes.
export async function requireStudent(db: Db, studentId: string) {
  const row = await db.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.id, studentId)).get();
  if (!row) throw new HTTPException(404, { message: "student not found" });
}

// What the tagger (and the roster endpoint) sees about each student: one class, or every
// class when none is given. Returns the query, not a promise, so callers can db.batch() it.
export function selectRoster(db: Db, classId?: string) {
  return db
    .select({
      id: schema.students.id,
      classId: schema.students.classId,
      firstName: schema.students.firstName,
      lastName: schema.students.lastName,
      aliases: schema.students.aliases,
    } satisfies Record<keyof RosterStudent, unknown>)
    .from(schema.students)
    .where(classId ? eq(schema.students.classId, classId) : undefined)
    .orderBy(asc(schema.students.lastName), asc(schema.students.firstName));
}

export function selectClasses(db: Db) {
  return db
    .select({ id: schema.classes.id, name: schema.classes.name } satisfies Record<keyof TagClass, unknown>)
    .from(schema.classes)
    .orderBy(asc(schema.classes.name));
}
