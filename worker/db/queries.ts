// Lookups more than one route needs. The require* guards throw the 404/400 that
// app.onError turns into { error }, so routes read as one guard per rule.
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import * as schema from "./schema";
import type { Note } from "./schema";
import type { Db } from "./client";
import type { RosterStudent } from "../tagging";

export async function requireClass(db: Db, classId: string) {
  const row = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId)).get();
  if (!row) throw new HTTPException(404, { message: "class not found" });
}

export async function requireNote(db: Db, noteId: string): Promise<Note> {
  const row = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId)).get();
  if (!row) throw new HTTPException(404, { message: "note not found" });
  return row;
}

// A student the teacher names must exist and be in the note's class.
export async function requireClassmate(db: Db, note: Note, studentId: string) {
  const row = await db
    .select({ classId: schema.students.classId })
    .from(schema.students)
    .where(and(eq(schema.students.id, studentId)))
    .get();
  if (!row) throw new HTTPException(404, { message: "student not found" });
  if (row.classId !== note.classId) throw new HTTPException(400, { message: "student is not in this class" });
}

// What the tagger (and the roster endpoint) sees about each student in a class.
export function selectRoster(db: Db, classId: string): Promise<RosterStudent[]> {
  return db
    .select({
      id: schema.students.id,
      firstName: schema.students.firstName,
      lastName: schema.students.lastName,
      aliases: schema.students.aliases,
    })
    .from(schema.students)
    .where(eq(schema.students.classId, classId))
    .orderBy(asc(schema.students.lastName), asc(schema.students.firstName));
}
