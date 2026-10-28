// Lookups shared by several route files. The require* guards throw the 404 that
// app.onError turns into { error }, so routes read as one guard per rule.
//
// Every lookup takes the signed-in user's id and answers only for rows they own. A row that
// exists but is someone else's reads as not found, never as forbidden, so an id proves
// nothing. Classes and notes carry owner_id; everything else is owned through its class.
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";
import type { Note } from "./schema";
import type { Db } from "./client";
import type { RosterEntry, TagClass } from "../tagging";

export const notFound = (what: string) => new HTTPException(404, { message: `${what} not found` });

// A multi-row insert as statements of `perStatement` rows each: D1 binds at most 100
// parameters per statement, so the caller picks the count from the table's column count.
// Nothing for an empty list; the caller batches what comes back.
export function insertChunks<T extends SQLiteTable>(db: Db, table: T, rows: T["$inferInsert"][], perStatement: number) {
  return Array.from({ length: Math.ceil(rows.length / perStatement) }, (_, i) => db.insert(table).values(rows.slice(i * perStatement, (i + 1) * perStatement)));
}

// The ids of the user's classes, as a subquery for rows that are owned through their class.
export const ownedClasses = (db: Db, userId: string) => db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.ownerId, userId));

export async function requireClass(db: Db, userId: string, classId: string) {
  const row = await db
    .select({ id: schema.classes.id })
    .from(schema.classes)
    .where(and(eq(schema.classes.id, classId), eq(schema.classes.ownerId, userId)))
    .get();
  if (!row) throw notFound("class");
}

export async function requireNote(db: Db, userId: string, noteId: string): Promise<Note> {
  const row = await db
    .select()
    .from(schema.notes)
    .where(and(eq(schema.notes.id, noteId), eq(schema.notes.ownerId, userId)))
    .get();
  if (!row) throw notFound("note");
  return row;
}

// A student the teacher names must be in one of their classes. Any of them: a note may span classes.
export async function requireStudent(db: Db, userId: string, studentId: string) {
  const row = await db
    .select({ id: schema.students.id })
    .from(schema.students)
    .where(and(eq(schema.students.id, studentId), inArray(schema.students.classId, ownedClasses(db, userId))))
    .get();
  if (!row) throw notFound("student");
}

// What the tagger sees about each student: the given classes, or every class of the user's
// when none are given. Returns the query, not a promise, so callers can db.batch() it.
export function selectRoster(db: Db, userId: string, classIds?: string[]) {
  return db
    .select({
      id: schema.students.id,
      classId: schema.students.classId,
      firstName: schema.students.firstName,
      lastName: schema.students.lastName,
      aliases: schema.students.aliases,
    } satisfies Record<keyof RosterEntry, unknown>)
    .from(schema.students)
    .where(and(inArray(schema.students.classId, ownedClasses(db, userId)), classIds ? inArray(schema.students.classId, classIds) : undefined))
    .orderBy(asc(schema.students.lastName), asc(schema.students.firstName));
}

export function selectClasses(db: Db, userId: string) {
  return db
    .select({ id: schema.classes.id, name: schema.classes.name } satisfies Record<keyof TagClass, unknown>)
    .from(schema.classes)
    .where(eq(schema.classes.ownerId, userId))
    .orderBy(asc(schema.classes.name));
}
