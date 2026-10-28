// Demo mode: a visitor with no account gets their own copy of two small synthetic classes
// and a capped allowance of notes and summaries, so the product can be tried without
// signing in and without an open-ended bill. The copy is cut from the seed classes by their
// fixed ids (scripts/seed-dev.sql), whoever owns them: four students each, the notes about
// them, their grades, the course material, and the saved summaries, so Reports reads as
// current from the first visit. Everything is a new row under a new user, so the ordinary
// ownership checks keep each visitor to their own copy. See DECISIONS.md.
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, exists, gt, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { Note, NoteMention, NoteStudent, SynthesisRow, User } from "./db/schema";
import type { Db } from "./db/client";
import { insertChunks } from "./db/helpers";
import type { DemoAllowance } from "./api-types";
import { buildEvidence, loadEvidence } from "./evidence";
import { inputHash } from "./synthesis-model";

export const DEMO_SESSION_DAYS = 7;
// Per visitor: notes created (typed, spoken or cut from a document; a course document counts
// one) and summaries that called Opus. A summary served from the cache is free.
export const DEMO_LIMITS = { notes: 30, reports: 3 } as const;
export type Allowance = keyof typeof DEMO_LIMITS;
// Visitors with a live session at once. Beyond this the demo says it is busy: the per-visitor
// caps bound one visitor, this bounds all of them.
export const DEMO_MAX_LIVE = 100;

// The template: two seed classes and four students of each, by the seed's fixed ids. Alex
// Marsh and Alex Ruiz are kept on purpose: a note that says just "Alex" is the tagger's
// showcase, an open mention for the visitor to settle.
const seedStudent = (n: string) => `22222222-2222-4222-8222-2222222222${n}`;
export const DEMO_TEMPLATE = [
  // Period 3 Humanities: Rowan Pell, Ember Castellane, Marlowe Finchley, Alex Marsh
  { classId: "11111111-1111-4111-8111-111111111111", students: ["02", "06", "05", "09"].map(seedStudent) },
  // B Block Humanities: Imogen Hale, Theo Brightwater, Ronan Pike, Alex Ruiz
  { classId: "11111111-1111-4111-8111-111111112222", students: ["15", "14", "13", "10"].map(seedStudent) },
];
const TEMPLATE_CLASSES = DEMO_TEMPLATE.map((t) => t.classId);
const TEMPLATE_STUDENTS = DEMO_TEMPLATE.flatMap((t) => t.students);

// Rows per insert statement, under D1's 100 bound parameters: 100 / columns, rounded down.
const CHUNK = { students: 12, notes: 10, noteStudents: 33, noteMentions: 16, gradeEntries: 12, syntheses: 11 };

const today = () => new Date().toISOString().slice(0, 10);

// Which of the template owner's notes the copy takes. In a template class: the class-level
// ones (no tags) and any tagged to a kept student. Not yet assigned to a class: any tagged to
// a kept student, or with an open mention a kept student is a candidate for (a note that only
// says "Alex", or one spanning both classes). Only the template owner can tag or be offered
// these students, so no owner check is needed.
function templateNotes(db: Db) {
  const n = schema.notes;
  const ns = schema.noteStudents;
  const m = schema.noteMentions;
  const anyTag = db.select({ one: sql`1` }).from(ns).where(eq(ns.noteId, n.id));
  const keptTag = db
    .select({ one: sql`1` })
    .from(ns)
    .where(and(eq(ns.noteId, n.id), inArray(ns.studentId, TEMPLATE_STUDENTS)));
  const keptCandidate = sql`exists (select 1 from ${m}, json_each(${m.candidateIds}) where ${m.noteId} = ${n.id} and json_each.value in ${TEMPLATE_STUDENTS})`;
  return or(
    and(inArray(n.classId, TEMPLATE_CLASSES), or(notExists(anyTag), exists(keptTag))),
    and(isNull(n.classId), or(exists(keptTag), keptCandidate)),
  );
}

// The class that every kept tag of a note points at, when they agree; how tagging settles a
// note's class (routes/notes.ts inferClass), applied to the copy's smaller roster.
function settledClass(tags: NoteStudent[], classOf: Map<string, string>): string | null {
  const classes = new Set(tags.map((t) => classOf.get(t.studentId)!));
  return classes.size === 1 ? [...classes][0]! : null;
}

// Every old id in a summary's JSON replaced with the copy's: citations name the notes they quote.
function remapJson(json: SynthesisRow["json"], ids: Map<string, string>): SynthesisRow["json"] {
  let text = JSON.stringify(json);
  for (const [from, to] of ids) text = text.replaceAll(from, to);
  return JSON.parse(text) as SynthesisRow["json"];
}

// A new user owning a fresh copy of the template, written in one transaction so a failure
// leaves nothing behind. Then the copied summaries' hashes are recomputed: a hash covers the
// ids of the notes a summary read, which are new in the copy, and without this every summary
// would show as out of date. 503 when the template classes are not in this database.
export async function cloneDemo(db: Db): Promise<User> {
  const s = schema.students;
  const [classes, students, notes, tags, mentions, materials, grades, settings, saved] = await db.batch([
    db.select().from(schema.classes).where(inArray(schema.classes.id, TEMPLATE_CLASSES)),
    db.select().from(s).where(inArray(s.id, TEMPLATE_STUDENTS)),
    db.select().from(schema.notes).where(templateNotes(db)),
    db.select().from(schema.noteStudents).where(inArray(schema.noteStudents.studentId, TEMPLATE_STUDENTS)),
    db
      .select({ row: schema.noteMentions })
      .from(schema.noteMentions)
      .innerJoin(schema.notes, eq(schema.notes.id, schema.noteMentions.noteId))
      .where(templateNotes(db)),
    db.select().from(schema.classMaterials).where(inArray(schema.classMaterials.classId, TEMPLATE_CLASSES)),
    db.select().from(schema.gradeEntries).where(inArray(schema.gradeEntries.studentId, TEMPLATE_STUDENTS)),
    db.select().from(schema.settings).where(inArray(schema.settings.classId, TEMPLATE_CLASSES)),
    db.select().from(schema.syntheses).where(inArray(schema.syntheses.studentId, TEMPLATE_STUDENTS)).orderBy(desc(schema.syntheses.createdAt)),
  ]);
  if (classes.length !== TEMPLATE_CLASSES.length) throw new HTTPException(503, { message: "the demo is not set up" });

  const now = new Date().toISOString();
  const user: User = {
    id: crypto.randomUUID(),
    googleSub: "",
    email: "",
    name: "Demo",
    pictureUrl: null,
    createdAt: now,
    lastSigninAt: now,
    demo: 1,
    demoNotesUsed: 0,
    demoReportsUsed: 0,
    aiSpentMicro: 0,
  };
  user.googleSub = `demo:${user.id}`;

  // Old id → new id, one map per table that something else points at.
  const fresh = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, crypto.randomUUID()]));
  const classIds = fresh(classes);
  const studentIds = fresh(students);
  const noteIds = fresh(notes);
  const classOf = new Map(students.map((st) => [st.id, st.classId]));

  const tagsByNote = new Map<string, NoteStudent[]>();
  for (const t of tags) if (noteIds.has(t.noteId)) tagsByNote.set(t.noteId, [...(tagsByNote.get(t.noteId) ?? []), t]);

  const newClasses = classes.map((k) => ({ ...k, id: classIds.get(k.id)!, ownerId: user.id }));
  const newStudents = students.map((st) => ({ ...st, id: studentIds.get(st.id)!, classId: classIds.get(st.classId)! }));
  const newNotes: Note[] = notes.map((n) => ({
    ...n,
    id: noteIds.get(n.id)!,
    ownerId: user.id,
    classId: classIds.get(n.classId ?? settledClass(tagsByNote.get(n.id) ?? [], classOf) ?? "") ?? null,
    clientId: null,
  }));
  const newTags = [...tagsByNote.values()].flat().map((t) => ({ ...t, noteId: noteIds.get(t.noteId)!, studentId: studentIds.get(t.studentId)! }));
  const newMentions: NoteMention[] = mentions.map(({ row: m }) => ({
    ...m,
    id: crypto.randomUUID(),
    noteId: noteIds.get(m.noteId)!,
    candidateIds: m.candidateIds.flatMap((id) => studentIds.get(id) ?? []),
  }));
  const newMaterials = materials.map((mat) => ({ ...mat, id: crypto.randomUUID(), classId: classIds.get(mat.classId)! }));
  const newGrades = grades.map((g) => ({ ...g, id: crypto.randomUUID(), studentId: studentIds.get(g.studentId)! }));
  const newSettings = settings.map((row) => ({ ...row, classId: classIds.get(row.classId)! }));
  // The newest summary per student and period is the one Reports shows; older runs stay behind.
  const seen = new Set<string>();
  const newSyntheses = saved
    .filter((row) => {
      const key = `${row.studentId}|${row.periodStart}|${row.periodEnd}`;
      return !seen.has(key) && seen.add(key);
    })
    .map((row) => ({ ...row, id: crypto.randomUUID(), studentId: studentIds.get(row.studentId)!, json: remapJson(row.json, noteIds) }));

  await db.batch([
    db.insert(schema.users).values(user),
    db.insert(schema.classes).values(newClasses),
    ...insertChunks(db, s, newStudents, CHUNK.students),
    ...insertChunks(db, schema.notes, newNotes, CHUNK.notes),
    ...insertChunks(db, schema.noteStudents, newTags, CHUNK.noteStudents),
    ...insertChunks(db, schema.noteMentions, newMentions, CHUNK.noteMentions),
    ...newMaterials.map((mat) => db.insert(schema.classMaterials).values(mat)),
    ...insertChunks(db, schema.gradeEntries, newGrades, CHUNK.gradeEntries),
    ...insertChunks(db, schema.syntheses, newSyntheses, CHUNK.syntheses),
    ...newSettings.map((row) => db.insert(schema.settings).values(row)),
  ]);

  // Hashes: one evidence load per class and period, then one update per copied summary.
  const groups = new Map<string, typeof newSyntheses>();
  const classOfNew = new Map(newStudents.map((st) => [st.id, st.classId]));
  for (const row of newSyntheses) {
    const key = `${classOfNew.get(row.studentId)}|${row.periodStart}|${row.periodEnd}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const updates = [];
  for (const rows of groups.values()) {
    const first = rows[0]!;
    const loaded = await loadEvidence(db, classOfNew.get(first.studentId)!, { from: first.periodStart, to: first.periodEnd });
    for (const row of rows) {
      const student = loaded.students.find((st) => st.id === row.studentId)!;
      const hash = await inputHash(buildEvidence(loaded.rowsFor(student), today()));
      updates.push(db.update(schema.syntheses).set({ inputHash: hash }).where(eq(schema.syntheses.id, row.id)));
    }
  }
  if (updates.length > 0) await db.batch([updates[0]!, ...updates.slice(1)]);
  return user;
}

const used = { notes: schema.users.demoNotesUsed, reports: schema.users.demoReportsUsed } as const;
const capReached = (kind: Allowance) =>
  new HTTPException(403, { message: `The demo allows ${DEMO_LIMITS[kind]} ${kind}; sign in with Google to use your own classes` });

// Take `n` of a demo visitor's allowance, or 403 when it would go over. The check and the
// count are one statement, so two requests at the limit cannot both get through. Nothing
// happens for a teacher.
export async function reserve(db: Db, user: User, kind: Allowance, n = 1): Promise<void> {
  if (!user.demo || n === 0) return;
  const col = used[kind];
  const row = await db
    .update(schema.users)
    .set({ [kind === "notes" ? "demoNotesUsed" : "demoReportsUsed"]: sql`${col} + ${n}` })
    .where(and(eq(schema.users.id, user.id), sql`${col} + ${n} <= ${DEMO_LIMITS[kind]}`))
    .returning({ id: schema.users.id })
    .get();
  if (!row) throw capReached(kind);
}

// Give back what a request reserved and then did not use (a model call that failed, a resend
// that turned out to be a repeat).
export async function refund(db: Db, user: User, kind: Allowance, n = 1): Promise<void> {
  if (!user.demo || n === 0) return;
  const col = used[kind];
  await db
    .update(schema.users)
    .set({ [kind === "notes" ? "demoNotesUsed" : "demoReportsUsed"]: sql`${col} - ${n}` })
    .where(and(eq(schema.users.id, user.id), sql`${col} >= ${n}`));
}

// 403 when a demo visitor has nothing left, checked before work that would be wasted (a
// transcription, reading a document). reserve() still decides at the write.
export async function assertAllowance(db: Db, user: User, kind: Allowance): Promise<void> {
  if (!user.demo) return;
  const row = await db.select({ n: used[kind] }).from(schema.users).where(eq(schema.users.id, user.id)).get();
  if (!row || row.n >= DEMO_LIMITS[kind]) throw capReached(kind);
}

// What is left, for /api/auth/me. Null for a teacher.
export const allowanceOf = (user: User): DemoAllowance | null =>
  user.demo ? { notesLeft: Math.max(0, DEMO_LIMITS.notes - user.demoNotesUsed), reportsLeft: Math.max(0, DEMO_LIMITS.reports - user.demoReportsUsed) } : null;

// A session of this user's that has not expired.
const liveSession = (db: Db) =>
  db
    .select({ one: sql`1` })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, schema.users.id), gt(schema.sessions.expiresAt, new Date().toISOString())));

export async function liveDemoCount(db: Db): Promise<number> {
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.users)
    .where(and(eq(schema.users.demo, 1), exists(liveSession(db))))
    .get();
  return row?.n ?? 0;
}

// Delete demo users, with everything they own. Notes and classes go first: owner_id points at
// users without a cascade. Deleting a class takes its students, grades, materials, tags and
// summaries; deleting a user takes its sessions.
function deleteDemoUsers(db: Db, which: ReturnType<typeof and>) {
  const gone = db.select({ id: schema.users.id }).from(schema.users).where(which);
  return db.batch([
    db.delete(schema.notes).where(inArray(schema.notes.ownerId, gone)),
    db.delete(schema.classes).where(inArray(schema.classes.ownerId, gone)),
    db.delete(schema.users).where(which),
  ]);
}

// Visitors whose sessions have all expired, run when a new demo starts. The Worker has no
// scheduled jobs; a demo that nobody starts leaves nothing to clean up.
export const purgeExpiredDemos = (db: Db) => deleteDemoUsers(db, and(eq(schema.users.demo, 1), notExists(liveSession(db))));

// One visitor, when they sign in with Google: their copy is not carried over.
export const deleteDemoUser = (db: Db, id: string) => deleteDemoUsers(db, and(eq(schema.users.id, id), eq(schema.users.demo, 1)));
