// Demo mode: a visitor with no account gets their own copy of two small synthetic classes
// and a capped allowance of notes and summaries, so the product can be tried without
// signing in and without an open-ended bill. The copy is cut from worker/demo-template.json,
// a snapshot of the seed classes written by `npm run demo:snapshot`: four students each, the
// notes about them, their grades, the course material and the saved summaries, so every
// visitor sees the same demo and Reports reads as current from the first visit. Every date
// in the copy is moved forward by whole weeks so the newest note is in the last seven days
// and each note keeps its weekday. Everything is a new row under a new user, so the ordinary
// ownership checks keep each visitor to their own copy. See DECISIONS.md.
import { HTTPException } from "hono/http-exception";
import { and, eq, exists, inArray, notExists, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { ClassMaterial, ClassRow, GradeEntry, Note, NoteMention, NoteStudent, Student, SynthesisRow, User } from "./db/schema";
import type { Db } from "./db/client";
import { insertChunks } from "./db/helpers";
import type { DemoAllowance } from "./api-types";
import { sessionLive } from "./auth";
import { buildEvidence, daysBetween, loadEvidence, shiftDay, shiftIso, todayUtc } from "./evidence";
import { inputHash } from "./synthesis-model";
import templateJson from "./demo-template.json";

export const DEMO_SESSION_DAYS = 7;
// Per visitor: notes created (typed, spoken or cut from a document; a course document counts
// one) and summaries that called Opus. A summary served from the cache is free. Four summaries
// is the half of the template that has none saved, so a visitor can finish the class.
export const DEMO_LIMITS = { notes: 30, reports: 4 } as const;
export type Allowance = keyof typeof DEMO_LIMITS;
// Visitors with a live session at once. Beyond this the demo says it is busy: the per-visitor
// caps bound one visitor, this bounds all of them.
export const DEMO_MAX_LIVE = 100;

// What scripts/demo/snapshot.ts writes: the rows as Drizzle reads them, minus the columns the
// clone sets for each copy (owner_id, client_id, input_hash). Ids are the source's; the clone
// mints new ones.
export type DemoTemplate = {
  snapshotDay: string;
  classes: Omit<ClassRow, "ownerId">[];
  students: Student[];
  notes: Omit<Note, "ownerId" | "clientId">[];
  tags: NoteStudent[];
  mentions: NoteMention[];
  materials: ClassMaterial[];
  grades: GradeEntry[];
  settings: (typeof schema.settings.$inferSelect)[];
  syntheses: Omit<SynthesisRow, "inputHash">[];
};
export const template = templateJson as unknown as DemoTemplate;

// Rows per insert statement, under D1's 100 bound parameters: 100 / columns, rounded down.
const CHUNK = { students: 12, notes: 10, noteStudents: 33, noteMentions: 16, gradeEntries: 12, syntheses: 11 };

// How many days to move the template forward so its newest note falls in the week before
// `today`: whole weeks only, so a Tuesday note is still on a Tuesday. Never backwards.
export function shiftFor(newestDay: string, today: string): number {
  const toYesterday = daysBetween(newestDay, shiftDay(today, -1));
  return toYesterday < 0 ? 0 : Math.floor(toYesterday / 7) * 7;
}

// A date string moved by `days`: a YYYY-MM-DD day or a full ISO instant.
const shifted = (value: string, days: number) => (value.length === 10 ? shiftDay(value, days) : shiftIso(value, days));
const shiftedOrNull = (value: string | null, days: number) => (value === null ? null : shifted(value, days));

// Dates inside a saved summary's JSON: the citations' notedAt and dueDate and the coverage's
// lastNotedAt. Prose that names a date is left alone (DECISIONS.md: accepted drift).
const DATE_KEYS = new Set(["notedAt", "dueDate", "lastNotedAt"]);
export function shiftDates<T>(value: T, days: number): T {
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days)) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, DATE_KEYS.has(k) && typeof v === "string" ? shifted(v, days) : shiftDates(v, days)]),
  ) as T;
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

// A new user owning a fresh copy of the template, dated to this week, written in one
// transaction so a failure leaves nothing behind. Then the copied summaries' hashes are
// computed: a hash covers the ids and dates of the notes a summary read, which are new in
// the copy, and without this every summary would show as out of date.
export async function cloneDemo(db: Db): Promise<User> {
  const { classes, students, notes, tags, mentions, materials, grades, settings, syntheses } = template;
  const today = todayUtc();
  const days = shiftFor(notes.reduce((max, n) => (n.notedAt > max ? n.notedAt : max), "").slice(0, 10), today);

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const user: User = {
    id,
    googleSub: `demo:${id}`,
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

  // Old id → new id, one map per table that something else points at.
  const fresh = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, crypto.randomUUID()]));
  const classIds = fresh(classes);
  const studentIds = fresh(students);
  const noteIds = fresh(notes);
  const classOf = new Map(students.map((st) => [st.id, st.classId]));

  const tagsByNote = new Map<string, NoteStudent[]>();
  for (const t of tags) if (noteIds.has(t.noteId)) tagsByNote.set(t.noteId, [...(tagsByNote.get(t.noteId) ?? []), t]);

  const newClasses: ClassRow[] = classes.map((k) => ({
    ...k,
    id: classIds.get(k.id)!,
    ownerId: user.id,
    termStart: shiftedOrNull(k.termStart, days),
    termEnd: shiftedOrNull(k.termEnd, days),
    createdAt: shifted(k.createdAt, days),
  }));
  const newStudents = students.map((st) => ({ ...st, id: studentIds.get(st.id)!, classId: classIds.get(st.classId)!, createdAt: shifted(st.createdAt, days) }));
  const newNotes: Note[] = notes.map((n) => ({
    ...n,
    id: noteIds.get(n.id)!,
    ownerId: user.id,
    classId: classIds.get(n.classId ?? settledClass(tagsByNote.get(n.id) ?? [], classOf) ?? "") ?? null,
    clientId: null,
    notedAt: shifted(n.notedAt, days),
    createdAt: shifted(n.createdAt, days),
  }));
  const newTags = [...tagsByNote.values()].flat().map((t) => ({ ...t, noteId: noteIds.get(t.noteId)!, studentId: studentIds.get(t.studentId)! }));
  const newMentions: NoteMention[] = mentions.map((m) => ({
    ...m,
    id: crypto.randomUUID(),
    noteId: noteIds.get(m.noteId)!,
    candidateIds: m.candidateIds.flatMap((cid) => studentIds.get(cid) ?? []),
    createdAt: shifted(m.createdAt, days),
  }));
  const newMaterials = materials.map((mat) => ({ ...mat, id: crypto.randomUUID(), classId: classIds.get(mat.classId)!, createdAt: shifted(mat.createdAt, days) }));
  const newGrades = grades.map((g) => ({ ...g, id: crypto.randomUUID(), studentId: studentIds.get(g.studentId)!, dueDate: shiftedOrNull(g.dueDate, days) }));
  const newSettings = settings.map((row) => ({ ...row, classId: classIds.get(row.classId)! }));
  // The hash is filled in below, once the copy is written and its evidence can be read back.
  const newSyntheses: SynthesisRow[] = syntheses.map((row) => ({
    ...row,
    id: crypto.randomUUID(),
    studentId: studentIds.get(row.studentId)!,
    periodStart: shifted(row.periodStart, days),
    periodEnd: shifted(row.periodEnd, days),
    createdAt: shifted(row.createdAt, days),
    json: shiftDates(remapJson(row.json, noteIds), days),
    inputHash: "",
  }));

  await db.batch([
    db.insert(schema.users).values(user),
    db.insert(schema.classes).values(newClasses),
    ...insertChunks(db, schema.students, newStudents, CHUNK.students),
    ...insertChunks(db, schema.notes, newNotes, CHUNK.notes),
    ...insertChunks(db, schema.noteStudents, newTags, CHUNK.noteStudents),
    ...insertChunks(db, schema.noteMentions, newMentions, CHUNK.noteMentions),
    ...newMaterials.map((mat) => db.insert(schema.classMaterials).values(mat)),
    ...insertChunks(db, schema.gradeEntries, newGrades, CHUNK.gradeEntries),
    ...insertChunks(db, schema.syntheses, newSyntheses, CHUNK.syntheses),
    ...newSettings.map((row) => db.insert(schema.settings).values(row)),
  ]);

  // Hashes: one evidence load per class and period, then one update per copied summary.
  const groups = new Map<string, SynthesisRow[]>();
  const classOfNew = new Map(newStudents.map((st) => [st.id, st.classId]));
  for (const row of newSyntheses) {
    const key = `${classOfNew.get(row.studentId)}|${row.periodStart}|${row.periodEnd}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const hashes = await Promise.all(
    [...groups.values()].map(async (rows) => {
      const first = rows[0]!;
      const loaded = await loadEvidence(db, classOfNew.get(first.studentId)!, { from: first.periodStart, to: first.periodEnd });
      return Promise.all(
        rows.map(async (row) => {
          const student = loaded.students.find((st) => st.id === row.studentId)!;
          return { id: row.id, hash: await inputHash(buildEvidence(loaded.rowsFor(student), today)) };
        }),
      );
    }),
  );
  const updates = hashes.flat().map(({ id: sid, hash }) => db.update(schema.syntheses).set({ inputHash: hash }).where(eq(schema.syntheses.id, sid)));
  if (updates.length > 0) await db.batch([updates[0]!, ...updates.slice(1)]);
  return user;
}

// The users column that counts each kind.
const USED = { notes: "demoNotesUsed", reports: "demoReportsUsed" } as const satisfies Record<Allowance, keyof User>;
const capReached = (kind: Allowance) =>
  new HTTPException(403, { message: `The demo allows ${DEMO_LIMITS[kind]} ${kind}; sign in with Google to use your own classes` });

// Take `n` of a demo visitor's allowance, or 403 when it would go over. The check and the
// count are one statement, so two requests at the limit cannot both get through. Nothing
// happens for a teacher.
export async function reserve(db: Db, user: User, kind: Allowance, n = 1): Promise<void> {
  if (!user.demo || n === 0) return;
  const key = USED[kind];
  const col = schema.users[key];
  const row = await db
    .update(schema.users)
    .set({ [key]: sql`${col} + ${n}` })
    .where(and(eq(schema.users.id, user.id), sql`${col} + ${n} <= ${DEMO_LIMITS[kind]}`))
    .returning({ id: schema.users.id })
    .get();
  if (!row) throw capReached(kind);
}

// Give back what a request reserved and then did not use (a model call that failed, a resend
// that turned out to be a repeat).
export async function refund(db: Db, user: User, kind: Allowance, n = 1): Promise<void> {
  if (!user.demo || n === 0) return;
  const key = USED[kind];
  const col = schema.users[key];
  await db
    .update(schema.users)
    .set({ [key]: sql`${col} - ${n}` })
    .where(and(eq(schema.users.id, user.id), sql`${col} >= ${n}`));
}

// Run `work` against `n` of a demo visitor's allowance: reserved first, given back when the
// work throws or `kept` says nothing new was written (a resend that was a repeat). A teacher's
// allowance is unlimited, so for them this is just `work()`.
export async function reserved<T>(db: Db, user: User, kind: Allowance, n: number, work: () => Promise<T>, kept: (result: T) => boolean = () => true): Promise<T> {
  await reserve(db, user, kind, n);
  let result: T;
  try {
    result = await work();
  } catch (err) {
    await refund(db, user, kind, n);
    throw err;
  }
  if (!kept(result)) await refund(db, user, kind, n);
  return result;
}

// 403 when a demo visitor has nothing left, checked before work that would be wasted (a
// transcription, reading a document). Reads the row the request already loaded; reserve()
// still decides at the write.
export function assertAllowance(user: User, kind: Allowance): void {
  if (user.demo && user[USED[kind]] >= DEMO_LIMITS[kind]) throw capReached(kind);
}

// What is left, for /api/auth/me. Null for a teacher.
export const allowanceOf = (user: User): DemoAllowance | null =>
  user.demo ? { notesLeft: Math.max(0, DEMO_LIMITS.notes - user.demoNotesUsed), reportsLeft: Math.max(0, DEMO_LIMITS.reports - user.demoReportsUsed) } : null;

// A session of this user's that has not expired.
const liveSession = (db: Db) =>
  db
    .select({ one: sql`1` })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, schema.users.id), sessionLive()));

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
