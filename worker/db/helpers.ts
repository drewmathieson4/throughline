// Lookups shared by several route files. The require* guards throw the 404 that
// app.onError turns into { error }, so routes read as one guard per rule.
//
// Every lookup takes the signed-in user's id and answers only for rows they own. A row that
// exists but is someone else's reads as not found, never as forbidden, so an id proves
// nothing. Classes and notes carry owner_id; everything else is owned through its class.
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

// A student the teacher names must be in one of their classes. Any of them: a note may span
// classes. The predicate is for routes that fold the check into their own statement.
export const ownedStudent = (db: Db, userId: string, studentId: string) => and(eq(schema.students.id, studentId), inArray(schema.students.classId, ownedClasses(db, userId)));

// A report the teacher owns, through its summary's student's class. A predicate, so GET and
// PATCH fold it into their own statement and a miss reads as not found.
export const ownedReport = (db: Db, userId: string, reportId: string) =>
  and(
    eq(schema.reports.id, reportId),
    inArray(
      schema.reports.synthesisId,
      db
        .select({ id: schema.syntheses.id })
        .from(schema.syntheses)
        .innerJoin(schema.students, eq(schema.students.id, schema.syntheses.studentId))
        .where(inArray(schema.students.classId, ownedClasses(db, userId))),
    ),
  );

// Map.groupBy, which the worker's lib setting predates.
export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

// After a student or a class is deleted: an open mention on a surviving note may still name
// the gone students in candidate_ids, a JSON list no foreign key reaches, and would go on
// offering them. A mention whose every candidate is gone is deleted (it was only the model's
// guess at them); one with some left keeps those. Mentions that never had a candidate are
// left alone. Two statements, for the caller's batch after its delete.
export function pruneMentions(db: Db, userId: string) {
  const m = schema.noteMentions;
  const mine = inArray(m.noteId, db.select({ id: schema.notes.id }).from(schema.notes).where(eq(schema.notes.ownerId, userId)));
  const enrolled = db.select({ id: schema.students.id }).from(schema.students).where(inArray(schema.students.classId, ownedClasses(db, userId)));
  const someGone = sql`exists (select 1 from json_each(${m.candidateIds}) where json_each.value not in ${enrolled})`;
  const someLeft = sql`exists (select 1 from json_each(${m.candidateIds}) where json_each.value in ${enrolled})`;
  const kept = sql`(select json_group_array(json_each.value) from json_each(${m.candidateIds}) where json_each.value in ${enrolled})`;
  return [
    db.delete(m).where(and(mine, someGone, sql`not ${someLeft}`)),
    db.update(m).set({ candidateIds: kept }).where(and(mine, someGone)),
  ];
}

export async function requireStudent(db: Db, userId: string, studentId: string): Promise<{ id: string; classId: string }> {
  const row = await db.select({ id: schema.students.id, classId: schema.students.classId }).from(schema.students).where(ownedStudent(db, userId, studentId)).get();
  if (!row) throw notFound("student");
  return row;
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
