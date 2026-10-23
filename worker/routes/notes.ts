// Notes: what the teacher captured, plus which students each note is about. Text notes
// arrive as JSON; voice notes arrive as raw audio, are transcribed, and are stored as the
// transcript (the audio is discarded). Both kinds are tagged the same way.
//
// A note needs no class. Tagging looks across every class; the note's class is set from the
// students it finds (when they agree) or from a class named in the text. See DECISIONS.md.
//
// Tagging runs inside the create request (one Haiku call, roughly 1 to 3 s) so the response
// already carries the suggestions. A failed call never loses the note: it is saved first and
// comes back with `tagging: "failed"`; POST /:noteId/retag tries again.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import * as schema from "../db/schema";
import type { Note, NoteStudent } from "../db/schema";
import type { DocumentImportResult, NoteWithTags, TaggedNoteResponse, TaggingStatus } from "../api-types";
import type { AppEnv, Db } from "../db/client";
import { requireClass, requireNote, requireStudent, selectClasses, selectRoster } from "../db/helpers";
import { pastDatetime } from "../fields";
import { validate } from "../validate";
import { quoteLocator, tagNote, union, type OpenMention, type TagResult } from "../tagging";
import { splitDocument, type SplitResult } from "../documents";
import { transcribe } from "../transcribe";
import { limitBody, readUpload, uploadLimit, uploadName } from "../upload";

// Shared by text and voice notes. A backstop, not a product limit: a five-minute clip
// transcribes to roughly 5,000 characters. See DECISIONS.md.
const MAX_BODY_CHARS = 50_000;

// Well above what 5 minutes of 32 kbps speech produces (~1.2 MB), under Workers AI's input cap.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const classQuery = z.object({ classId: z.uuid().optional() });
// A document's file name and, as a fallback date, when the file was last modified.
const documentQuery = z.object({ name: uploadName, modified: pastDatetime("modified").optional() });
const noteParam = z.object({ noteId: z.uuid() });
const noteStudentParam = z.object({ noteId: z.uuid(), studentId: z.uuid() });
const mentionParam = z.object({ noteId: z.uuid(), mentionId: z.uuid() });
const quotes = z.array(z.string().trim().min(1).max(2000)).max(50);

const createNote = z.object({
  classId: z.uuid().optional(),
  body: z.string().trim().min(1, "body is required").max(MAX_BODY_CHARS, "body is too long"),
  // When the observation happened; defaults to now.
  notedAt: pastDatetime("notedAt").optional(),
});
const addStudent = z.object({ studentId: z.uuid(), quotes: quotes.optional() });
const assignMention = z.object({ studentId: z.uuid() });

// Composite keys of the two tag tables.
const tagKey = (noteId: string, studentId: string) =>
  and(eq(schema.noteStudents.noteId, noteId), eq(schema.noteStudents.studentId, studentId));
const mentionKey = (noteId: string, mentionId: string) =>
  and(eq(schema.noteMentions.id, mentionId), eq(schema.noteMentions.noteId, noteId));

// The row for a new note, whatever its kind: the one place that mints ids and timestamps.
// A classId, when given, has already been checked with requireClass by the route.
type NoteValues = { classId?: string | null; kind: schema.NoteKind; body: string; notedAt?: string; sourceName?: string };
function noteRow(values: NoteValues, now = new Date().toISOString()): Note {
  return {
    id: crypto.randomUUID(),
    classId: values.classId ?? null,
    kind: values.kind,
    body: values.body,
    audioKey: null,
    sourceName: values.sourceName ?? null,
    notedAt: values.notedAt ?? now,
    createdAt: now,
  };
}
const insertNote = (db: Db, values: NoteValues) => db.insert(schema.notes).values(noteRow(values)).returning().get();

// The row for an open mention on a note.
const mentionRow = (noteId: string, m: OpenMention, now: string) => ({ id: crypto.randomUUID(), noteId, mentionText: m.mentionText, quotes: m.quotes, candidateIds: m.candidateIds, createdAt: now });

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

// Ask the model which students the note is about, across every class. null when it could not
// be asked or did not answer usably; the caller decides what that means for existing rows.
async function suggestTags(db: Db, apiKey: string | undefined, note: Note): Promise<TagResult | null> {
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY is not set; note saved without tags", note.id);
    return null;
  }
  const [roster, classes] = await db.batch([selectRoster(db), selectClasses(db)]);
  try {
    return await tagNote({ body: note.body, roster, classes, client: new Anthropic({ apiKey }) });
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
async function runTagging(db: Db, apiKey: string | undefined, note: Note): Promise<TaggedNoteResponse> {
  const result = await suggestTags(db, apiKey, note);
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

const notes = new Hono<AppEnv>();

// GET /api/notes[?classId=…] → newest first, each with its students and open mentions.
// Without a filter every note comes back, unassigned ones included (single-teacher scale).
notes.get("/", validate("query", classQuery), async (c) => {
  const { classId } = c.req.valid("query");
  if (classId) await requireClass(c.var.db, classId);
  const where = classId ? eq(schema.notes.classId, classId) : undefined;
  const rows = await c.var.db
    .select()
    .from(schema.notes)
    .where(where)
    .orderBy(desc(schema.notes.notedAt), desc(schema.notes.createdAt));
  return c.json(await attachTags(c.var.db, where, rows));
});

// POST /api/notes { body, notedAt?, classId? } → 201 with the stored note, its tags, and
// whether tagging ran: { ...note, students, mentions, tagging: "done" | "failed" }
notes.post("/", validate("json", createNote), async (c) => {
  const { classId, body, notedAt } = c.req.valid("json");
  if (classId) await requireClass(c.var.db, classId);
  const note = await insertNote(c.var.db, { classId, kind: "text", body, notedAt });
  return c.json(await runTagging(c.var.db, c.env.ANTHROPIC_API_KEY, note), 201);
});

const audioLimit = limitBody(MAX_AUDIO_BYTES, "recording is too large");

// POST /api/notes/voice[?classId=…] with a raw audio body → transcribes, stores a voice note,
// and tags it, all in one request; 201 with the same shape as a text note. notedAt is the
// save time: a clip is at most five minutes long, so the gap from when the teacher started
// talking is not worth a browser-supplied timestamp.
notes.post("/voice", validate("query", classQuery), audioLimit, async (c) => {
  const { classId } = c.req.valid("query");

  // The audio is never stored or served back, so any audio/* type is fine to hand to
  // Whisper; the check only turns a wrong upload into a clear error.
  const mediaType = (c.req.header("content-type") ?? "").trim().toLowerCase();
  if (!mediaType.startsWith("audio/")) throw new HTTPException(400, { message: "unsupported audio type" });

  if (classId) await requireClass(c.var.db, classId);
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

  const note = await insertNote(c.var.db, { classId, kind: "voice", body: text });
  return c.json(await runTagging(c.var.db, c.env.ANTHROPIC_API_KEY, note), 201);
});

// The passages that fit one note body: later ones are dropped once it is full, and a first
// one that is itself over the cap is cut to fit. A backstop (it takes a 50,000-character
// document about one student to reach), not a product limit.
function fittingPassages(passages: string[]): string[] {
  const kept: string[] = [];
  let length = 0;
  for (const p of passages) {
    const next = length + (kept.length ? 2 : 0) + p.length; // joined with "\n\n"
    if (next > MAX_BODY_CHARS) {
      if (kept.length === 0) kept.push(p.slice(0, MAX_BODY_CHARS).trim());
      break;
    }
    kept.push(p);
    length = next;
  }
  return kept;
}

// POST /api/notes/document?name=…[&modified=…] with the file as the body → one note of kind
// progress_report per roster student the document is about, tagged to them with the passages
// about them as quotes; a name it could not settle becomes an unassigned note with an open
// mention. 201 with the notes written, 200 with none when the document named nobody; 400
// when the file cannot be read and 502 when the split fails, with nothing written either
// way. The notes an earlier upload of the same file made are replaced; `replaced` lists
// their ids. Why these choices, and how the notes are dated: see DECISIONS.md.
notes.post("/document", validate("query", documentQuery), uploadLimit, async (c) => {
  const { name, modified } = c.req.valid("query");
  const db = c.var.db;

  const unreadable = () => new HTTPException(502, { message: "could not read the students out of that document" });
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Checked before the file is read: without the model there is nothing to do with it.
    console.warn("ANTHROPIC_API_KEY is not set; document not imported", name);
    throw unreadable();
  }
  const [text, [roster, classes]] = await Promise.all([readUpload(c, name), db.batch([selectRoster(db), selectClasses(db)])]);
  let split: SplitResult;
  try {
    split = await splitDocument({ text, roster, classes, client: new Anthropic({ apiKey }) });
  } catch (err) {
    console.error("splitting failed for document", name, err);
    throw unreadable();
  }

  const now = new Date().toISOString();
  // A date the document states is stored at noon UTC so it shows as that day everywhere.
  const notedAt = split.documentDate ? `${split.documentDate}T12:00:00.000Z` : (modified ?? now);
  const removal = db
    .delete(schema.notes)
    .where(and(eq(schema.notes.sourceName, name), eq(schema.notes.kind, "progress_report")))
    .returning({ id: schema.notes.id });
  const inserts: BatchItem<"sqlite">[] = [];
  const written: NoteWithTags[] = [];
  // An entry whose passages could not be verified has no evidence and gets no note.
  for (const s of split.students) {
    const quotes = fittingPassages(s.quotes);
    if (quotes.length === 0) continue;
    const note = noteRow({ classId: s.classId, kind: "progress_report", body: quotes.join("\n\n"), sourceName: name, notedAt }, now);
    inserts.push(db.insert(schema.notes).values(note), db.insert(schema.noteStudents).values({ noteId: note.id, studentId: s.studentId, quotes }));
    written.push({ ...note, students: [{ studentId: s.studentId, quotes }], mentions: [] });
  }
  for (const m of split.mentions) {
    const quotes = fittingPassages(m.quotes);
    if (quotes.length === 0) continue;
    const note = noteRow({ kind: "progress_report", body: quotes.join("\n\n"), sourceName: name, notedAt }, now);
    const mention = mentionRow(note.id, { ...m, quotes }, now);
    inserts.push(db.insert(schema.notes).values(note), db.insert(schema.noteMentions).values(mention));
    written.push({ ...note, students: [], mentions: [{ id: mention.id, mentionText: mention.mentionText, quotes, candidateIds: mention.candidateIds }] });
  }
  // One transaction: the earlier set goes even when this upload found nobody, because the
  // file is what the teacher just said these notes should stand for.
  const [deleted] = await db.batch([removal, ...inserts]);
  const result: DocumentImportResult = { name, notes: written, replaced: deleted.map((r) => r.id) };
  return c.json(result, written.length > 0 ? 201 : 200);
});

// POST /api/notes/:noteId/retag → tag a note that has no tags and no open mentions, the state
// a failed tagging call leaves. A tagged note is refused (409): nothing records which tags the
// teacher settled, so replacing them would discard that work.
notes.post("/:noteId/retag", validate("param", noteParam), async (c) => {
  const note = await requireNote(c.var.db, c.req.valid("param").noteId);
  const current = await withTags(c.var.db, note);
  if (current.students.length > 0 || current.mentions.length > 0) throw new HTTPException(409, { message: "note is already tagged" });
  return c.json(await runTagging(c.var.db, c.env.ANTHROPIC_API_KEY, note));
});

// POST /api/notes/:noteId/students { studentId, quotes? } → the teacher adds a student the
// model missed. 201 with the note.
notes.post("/:noteId/students", validate("param", noteParam), validate("json", addStudent), async (c) => {
  const note = await requireNote(c.var.db, c.req.valid("param").noteId);
  const { studentId, quotes } = c.req.valid("json");
  await requireStudent(c.var.db, studentId);
  const existing = await existingTag(c.var.db, note.id, studentId);
  await c.var.db.batch([
    tagStatement(c.var.db, existing, note.id, studentId, verifyQuotes(note.body, quotes)),
    settleClassFrom(c.var.db, note.id, studentId),
  ]);
  return c.json(await withTags(c.var.db, await requireNote(c.var.db, note.id)), 201);
});

// DELETE /api/notes/:noteId/students/:studentId → remove a tag; 200 with the note
notes.delete("/:noteId/students/:studentId", validate("param", noteStudentParam), async (c) => {
  const { noteId, studentId } = c.req.valid("param");
  const note = await requireNote(c.var.db, noteId);
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
    await requireNote(c.var.db, noteId);
    const mention = await c.var.db.select().from(schema.noteMentions).where(mentionKey(noteId, mentionId)).get();
    if (!mention) throw new HTTPException(404, { message: "mention not found" });
    await requireStudent(c.var.db, studentId);
    const existing = await existingTag(c.var.db, noteId, studentId);
    await c.var.db.batch([
      tagStatement(c.var.db, existing, noteId, studentId, mention.quotes),
      c.var.db.delete(schema.noteMentions).where(mentionKey(noteId, mentionId)),
      settleClassFrom(c.var.db, noteId, studentId),
    ]);
    return c.json(await withTags(c.var.db, await requireNote(c.var.db, noteId)));
  },
);

// DELETE /api/notes/:noteId/mentions/:mentionId → the name was nobody on the roster; 200 with the note
notes.delete("/:noteId/mentions/:mentionId", validate("param", mentionParam), async (c) => {
  const { noteId, mentionId } = c.req.valid("param");
  const note = await requireNote(c.var.db, noteId);
  const deleted = await c.var.db.delete(schema.noteMentions).where(mentionKey(noteId, mentionId)).returning().get();
  if (!deleted) throw new HTTPException(404, { message: "mention not found" });
  return c.json(await withTags(c.var.db, note));
});

export default notes;
