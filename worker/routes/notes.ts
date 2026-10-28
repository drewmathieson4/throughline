// Notes: what the teacher captured, plus which students each note is about. Text notes
// arrive as JSON; voice notes arrive as raw audio, are transcribed, and are stored as the
// transcript (the audio is discarded). Both kinds are tagged the same way.
//
// A note needs no class. Tagging looks across every class; the note's class is set from the
// students it finds (when they agree) or from a class named in the text. See DECISIONS.md.
//
// Tagging runs inside the create request (one Haiku call, roughly 1 to 3 s) so the response
// already carries the suggestions. A failed call never loses the note: it is saved first and
// comes back with `tagging: "failed"`; POST /:noteId/retag tries again. The same when the
// model cannot be called at all (no key, or the account is over its spend cap).
//
// Text and voice notes may carry a clientId the browser minted when the note was captured.
// A second send with the same id (the offline queue flushing again, or a retry after a lost
// response) gets the stored note back with a 200 and makes no Whisper or Haiku call.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { Note, NoteStudent } from "../db/schema";
import type { NoteWithTags, TaggedNoteResponse, TaggingStatus } from "../api-types";
import type { Db, UserEnv } from "../db/client";
import { requireClass, requireNote, requireStudent, selectClasses, selectRoster } from "../db/helpers";
import { assertAllowance, refund, reserve } from "../demo";
import { MAX_BODY_CHARS, mentionRow, noteRow, type NoteValues } from "../note-rows";
import { pastDatetime } from "../fields";
import { modelAccess } from "../spend";
import { validate } from "../validate";
import { quoteLocator, tagNote, union, type TagResult } from "../tagging";
import { transcribe } from "../transcribe";
import { limitBody } from "../upload";

// Well above what 5 minutes of 32 kbps speech produces (~1.2 MB), under Workers AI's input cap.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const classQuery = z.object({ classId: z.uuid().optional() });
const noteParam = z.object({ noteId: z.uuid() });
const noteStudentParam = z.object({ noteId: z.uuid(), studentId: z.uuid() });
const mentionParam = z.object({ noteId: z.uuid(), mentionId: z.uuid() });
const quotes = z.array(z.string().trim().min(1).max(2000)).max(50);

// When the observation happened (defaults to now), and the browser's id for a captured note.
const captured = { notedAt: pastDatetime("notedAt").optional(), clientId: z.uuid().optional() };
const createNote = z.object({
  classId: z.uuid().optional(),
  body: z.string().trim().min(1, "body is required").max(MAX_BODY_CHARS, "body is too long"),
  ...captured,
});
const voiceQuery = classQuery.extend(captured);
const addStudent = z.object({ studentId: z.uuid(), quotes: quotes.optional() });
const assignMention = z.object({ studentId: z.uuid() });

// Composite keys of the two tag tables.
const tagKey = (noteId: string, studentId: string) =>
  and(eq(schema.noteStudents.noteId, noteId), eq(schema.noteStudents.studentId, studentId));
const mentionKey = (noteId: string, mentionId: string) =>
  and(eq(schema.noteMentions.id, mentionId), eq(schema.noteMentions.noteId, noteId));


// A teacher's action on a student settles the note's class when it had none: the statement
// copies that student's class onto the note, and only if the note still has no class, so it
// is safe to batch with the tag write and safe against two actions racing.
const settleClassFrom = (db: Db, noteId: string, studentId: string) =>
  db
    .update(schema.notes)
    .set({ classId: sql`(select class_id from ${schema.students} where ${schema.students.id} = ${studentId})` })
    .where(and(eq(schema.notes.id, noteId), isNull(schema.notes.classId)));

// Quotes the teacher supplies must be in the note too, same rule as the AI's.
function verifyQuotes(body: string, input: string[] | undefined): string[] {
  const locate = quoteLocator(body);
  const found = (input ?? []).map((q) => {
    const hit = locate(q);
    if (!hit) throw new HTTPException(400, { message: `quote not found in note: ${q.slice(0, 40)}` });
    return hit;
  });
  return union([], found);
}

// The given notes with their tags and open mentions attached (empty lists when none).
// `where` is the same condition on the notes table that selected them; filtering through a
// join keeps each query to one bound parameter however many notes there are (D1 caps a
// statement at 100), and the two reads go in one round trip.
async function attachTags(db: Db, where: SQL | undefined, rows: Note[]): Promise<NoteWithTags[]> {
  const [students, mentions] = await db.batch([
    db
      .select({ row: schema.noteStudents })
      .from(schema.noteStudents)
      .innerJoin(schema.notes, eq(schema.notes.id, schema.noteStudents.noteId))
      .where(where),
    db
      .select({ row: schema.noteMentions })
      .from(schema.noteMentions)
      .innerJoin(schema.notes, eq(schema.notes.id, schema.noteMentions.noteId))
      .where(where),
  ]);
  const byId = new Map(rows.map((n): [string, NoteWithTags] => [n.id, { ...n, students: [], mentions: [] }]));
  for (const { row } of students) byId.get(row.noteId)?.students.push({ studentId: row.studentId, quotes: row.quotes });
  for (const { row } of mentions) {
    byId.get(row.noteId)?.mentions.push({ id: row.id, mentionText: row.mentionText, quotes: row.quotes, candidateIds: row.candidateIds });
  }
  return [...byId.values()];
}

const withTags = async (db: Db, note: Note) => (await attachTags(db, eq(schema.notes.id, note.id), [note]))[0]!;

// The note an earlier send with this clientId stored, as it stands now. Its tagging ran (or
// failed) on that first send; "done" here only says this request did not fail.
async function sentBefore(db: Db, userId: string, clientId: string | undefined): Promise<TaggedNoteResponse | undefined> {
  if (!clientId) return undefined;
  const note = await db
    .select()
    .from(schema.notes)
    .where(and(eq(schema.notes.ownerId, userId), eq(schema.notes.clientId, clientId)))
    .get();
  return note && { ...(await withTags(db, note)), tagging: "done" };
}

// The statement that puts a student on a note: a new row, or new quotes folded into the one
// that exists.
function tagStatement(db: Db, existing: NoteStudent | undefined, noteId: string, studentId: string, quotes: string[]) {
  if (!existing) return db.insert(schema.noteStudents).values({ noteId, studentId, quotes });
  return db
    .update(schema.noteStudents)
    .set({ quotes: union(existing.quotes, quotes) })
    .where(tagKey(noteId, studentId));
}

const existingTag = (db: Db, noteId: string, studentId: string) =>
  db.select().from(schema.noteStudents).where(tagKey(noteId, studentId)).get();

// Ask the model which students the note is about, across every class of the teacher's. null
// when it could not be asked or did not answer usably; the caller decides what that means
// for existing rows.
async function suggestTags(db: Db, client: Anthropic | null, userId: string, note: Note): Promise<TagResult | null> {
  if (!client) {
    console.warn("no model access (no API key, or over the spend cap); note saved without tags", note.id);
    return null;
  }
  const [roster, classes] = await db.batch([selectRoster(db, userId), selectClasses(db, userId)]);
  try {
    return await tagNote({ body: note.body, roster, classes, client });
  } catch (err) {
    console.error("tagging failed for note", note.id, err);
    return null;
  }
}

// The class a fresh suggestion settles for an unassigned note: the one class every suggested
// student is in, else a class the note named, else none. Students spanning two classes leave
// the note unassigned for the teacher.
function inferClass(result: TagResult): string | null {
  const classes = union([], result.students.map((s) => s.classId));
  if (classes.length === 1) return classes[0]!;
  if (classes.length === 0) return result.mentionedClassId;
  return null;
}

// Write the model's tags and open mentions for a note that has none, in one atomic batch,
// and settle the note's class if it had none. Returns the note as it now stands.
async function storeTags(db: Db, note: Note, result: TagResult): Promise<Note> {
  const classId = note.classId ?? inferClass(result);
  const now = new Date().toISOString();
  const [first, ...rest] = [
    // Only an unassigned note gets a class here; a set class is never touched.
    ...(!note.classId && classId
      ? [db.update(schema.notes).set({ classId }).where(and(eq(schema.notes.id, note.id), isNull(schema.notes.classId)))]
      : []),
    ...result.students.map((s) => db.insert(schema.noteStudents).values({ noteId: note.id, studentId: s.studentId, quotes: s.quotes })),
    ...result.mentions.map((m) => db.insert(schema.noteMentions).values(mentionRow(note.id, m, now))),
  ];
  if (first) await db.batch([first, ...rest]);
  return { ...note, classId };
}

// Suggest and store. "failed" means the note's tags are untouched: either the model could not
// be asked, or the rows could not be written (logged; the note itself is already saved).
async function runTagging(db: Db, client: Anthropic | null, userId: string, note: Note): Promise<TaggedNoteResponse> {
  const result = await suggestTags(db, client, userId, note);
  let tagging: TaggingStatus = "failed";
  if (result) {
    try {
      note = await storeTags(db, note, result);
      tagging = "done";
    } catch (err) {
      console.error("storing tags failed for note", note.id, err);
    }
  }
  return { ...(await withTags(db, note)), tagging };
}

// Store and tag a captured note: 201. Two sends of one clientId that both got past
// sentBefore meet at the unique index; the later one writes nothing and returns the first
// one's note: 200.
async function saveCaptured(db: Db, client: Anthropic | null, values: NoteValues): Promise<[TaggedNoteResponse, 200 | 201]> {
  const note = await db
    .insert(schema.notes)
    .values(noteRow(values))
    .onConflictDoNothing({ target: [schema.notes.ownerId, schema.notes.clientId] })
    .returning()
    .get();
  if (note) return [await runTagging(db, client, values.ownerId, note), 201];
  return [(await sentBefore(db, values.ownerId, values.clientId))!, 200];
}

// saveCaptured against a demo visitor's allowance: one note reserved first, given back when
// nothing new was written (a repeat, or a failure). A teacher's allowance is unlimited.
async function saveCounted(db: Db, client: Anthropic | null, user: schema.User, values: Omit<NoteValues, "ownerId">): Promise<[TaggedNoteResponse, 200 | 201]> {
  await reserve(db, user, "notes");
  let saved: [TaggedNoteResponse, 200 | 201];
  try {
    saved = await saveCaptured(db, client, { ownerId: user.id, ...values });
  } catch (err) {
    await refund(db, user, "notes");
    throw err;
  }
  if (saved[1] === 200) await refund(db, user, "notes");
  return saved;
}

const notes = new Hono<UserEnv>();

// GET /api/notes[?classId=…] → the teacher's notes, newest first, each with its students and
// open mentions. Without a filter every one of theirs comes back, unassigned ones included.
notes.get("/", validate("query", classQuery), async (c) => {
  const { classId } = c.req.valid("query");
  const uid = c.var.user.id;
  if (classId) await requireClass(c.var.db, uid, classId);
  const mine = eq(schema.notes.ownerId, uid);
  const where = classId ? and(mine, eq(schema.notes.classId, classId)) : mine;
  const rows = await c.var.db
    .select()
    .from(schema.notes)
    .where(where)
    .orderBy(desc(schema.notes.notedAt), desc(schema.notes.createdAt));
  return c.json(await attachTags(c.var.db, where, rows));
});

// POST /api/notes { body, notedAt?, classId?, clientId? } → 201 with the stored note, its
// tags, and whether tagging ran: { ...note, students, mentions, tagging: "done" | "failed" };
// 200 with the same shape when the clientId was sent before.
notes.post("/", validate("json", createNote), async (c) => {
  const { classId, body, notedAt, clientId } = c.req.valid("json");
  const uid = c.var.user.id;
  const repeat = await sentBefore(c.var.db, uid, clientId);
  if (repeat) return c.json(repeat, 200);
  if (classId) await requireClass(c.var.db, uid, classId);
  const [note, status] = await saveCounted(c.var.db, (await modelAccess(c)).client, c.var.user, { classId, kind: "text", body, notedAt, clientId });
  return c.json(note, status);
});

const audioLimit = limitBody(MAX_AUDIO_BYTES, "recording is too large");

// POST /api/notes/voice[?classId=&notedAt=&clientId=] with a raw audio body → transcribes,
// stores a voice note, and tags it, all in one request; 201 with the same shape as a text
// note, 200 when the clientId was sent before. notedAt is when the recording started, sent
// by the browser: a recording made offline can upload hours later, so the upload time would
// be wrong. Without it the note is dated now.
notes.post("/voice", validate("query", voiceQuery), audioLimit, async (c) => {
  const { classId, notedAt, clientId } = c.req.valid("query");

  // The audio is never stored or served back, so any audio/* type is fine to hand to
  // Whisper; the check only turns a wrong upload into a clear error.
  const mediaType = (c.req.header("content-type") ?? "").trim().toLowerCase();
  if (!mediaType.startsWith("audio/")) throw new HTTPException(400, { message: "unsupported audio type" });

  const uid = c.var.user.id;
  const repeat = await sentBefore(c.var.db, uid, clientId);
  if (repeat) return c.json(repeat, 200);
  if (classId) await requireClass(c.var.db, uid, classId);
  // A visitor with no notes left is told before the transcription, not after.
  await assertAllowance(c.var.db, c.var.user, "notes");
  const audio = await c.req.arrayBuffer();
  if (audio.byteLength === 0) throw new HTTPException(400, { message: "nothing was heard" });

  let text: string;
  try {
    text = await transcribe(c.env.AI, audio);
  } catch (err) {
    console.error("transcription failed", err);
    throw new HTTPException(502, { message: "transcription failed" });
  }
  if (!text) throw new HTTPException(400, { message: "nothing was heard" });
  // Only reachable by uploading a long audio file; the browser stops at five minutes.
  if (text.length > MAX_BODY_CHARS) throw new HTTPException(400, { message: "transcript is too long" });

  const [note, status] = await saveCounted(c.var.db, (await modelAccess(c)).client, c.var.user, { classId, kind: "voice", body: text, notedAt, clientId });
  return c.json(note, status);
});

// POST /api/notes/:noteId/retag → tag a note that has no tags and no open mentions, the state
// a failed tagging call leaves. A tagged note is refused (409): nothing records which tags the
// teacher settled, so replacing them would discard that work.
notes.post("/:noteId/retag", validate("param", noteParam), async (c) => {
  const uid = c.var.user.id;
  const note = await requireNote(c.var.db, uid, c.req.valid("param").noteId);
  const current = await withTags(c.var.db, note);
  if (current.students.length > 0 || current.mentions.length > 0) throw new HTTPException(409, { message: "note is already tagged" });
  return c.json(await runTagging(c.var.db, (await modelAccess(c)).client, uid, note));
});

// POST /api/notes/:noteId/students { studentId, quotes? } → the teacher adds a student the
// model missed. 201 with the note.
notes.post("/:noteId/students", validate("param", noteParam), validate("json", addStudent), async (c) => {
  const uid = c.var.user.id;
  const note = await requireNote(c.var.db, uid, c.req.valid("param").noteId);
  const { studentId, quotes } = c.req.valid("json");
  await requireStudent(c.var.db, uid, studentId);
  const existing = await existingTag(c.var.db, note.id, studentId);
  await c.var.db.batch([
    tagStatement(c.var.db, existing, note.id, studentId, verifyQuotes(note.body, quotes)),
    settleClassFrom(c.var.db, note.id, studentId),
  ]);
  return c.json(await withTags(c.var.db, await requireNote(c.var.db, uid, note.id)), 201);
});

// DELETE /api/notes/:noteId/students/:studentId → remove a tag; 200 with the note
notes.delete("/:noteId/students/:studentId", validate("param", noteStudentParam), async (c) => {
  const { noteId, studentId } = c.req.valid("param");
  const note = await requireNote(c.var.db, c.var.user.id, noteId);
  const deleted = await c.var.db.delete(schema.noteStudents).where(tagKey(noteId, studentId)).returning().get();
  if (!deleted) throw new HTTPException(404, { message: "tag not found" });
  return c.json(await withTags(c.var.db, note));
});

// POST /api/notes/:noteId/mentions/:mentionId/assign { studentId } → the teacher says who an
// unresolved name meant. The mention's quotes move to a tag and the mention closes.
notes.post(
  "/:noteId/mentions/:mentionId/assign",
  validate("param", mentionParam),
  validate("json", assignMention),
  async (c) => {
    const { noteId, mentionId } = c.req.valid("param");
    const { studentId } = c.req.valid("json");
    const uid = c.var.user.id;
    await requireNote(c.var.db, uid, noteId);
    const mention = await c.var.db.select().from(schema.noteMentions).where(mentionKey(noteId, mentionId)).get();
    if (!mention) throw new HTTPException(404, { message: "mention not found" });
    await requireStudent(c.var.db, uid, studentId);
    const existing = await existingTag(c.var.db, noteId, studentId);
    await c.var.db.batch([
      tagStatement(c.var.db, existing, noteId, studentId, mention.quotes),
      c.var.db.delete(schema.noteMentions).where(mentionKey(noteId, mentionId)),
      settleClassFrom(c.var.db, noteId, studentId),
    ]);
    return c.json(await withTags(c.var.db, await requireNote(c.var.db, uid, noteId)));
  },
);

// DELETE /api/notes/:noteId/mentions/:mentionId → the name was nobody on the roster; 200 with the note
notes.delete("/:noteId/mentions/:mentionId", validate("param", mentionParam), async (c) => {
  const { noteId, mentionId } = c.req.valid("param");
  const note = await requireNote(c.var.db, c.var.user.id, noteId);
  const deleted = await c.var.db.delete(schema.noteMentions).where(mentionKey(noteId, mentionId)).returning().get();
  if (!deleted) throw new HTTPException(404, { message: "mention not found" });
  return c.json(await withTags(c.var.db, note));
});

export default notes;
