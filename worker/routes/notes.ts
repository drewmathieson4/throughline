// Notes: what the teacher captured, plus which students each note is about. Text notes
// arrive as JSON; voice notes arrive as raw audio, are transcribed, and are stored as the
// transcript (the audio is discarded). Both kinds are tagged the same way.
//
// Tagging runs inside the create request (one Haiku call, roughly 1 to 3 s) so the response
// already carries the suggestions. A failed call never loses the note: it is saved first and
// comes back with `tagging: "failed"`; POST /:noteId/retag tries again.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { Note, NoteStudent } from "../db/schema";
import type { NoteWithTags, TaggedNoteResponse, TaggingStatus } from "../api";
import type { AppEnv, Db } from "../db/client";
import { requireClass, requireClassmate, requireNote, selectRoster } from "../db/queries";
import { validate } from "../validate";
import { quoteLocator, tagNote, union, type TagResult } from "../tagging";
import { transcribe } from "../transcribe";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Shared by text and voice notes. A backstop, not a product limit: a five-minute clip
// transcribes to roughly 5,000 characters. See DECISIONS.md.
const MAX_BODY_CHARS = 50_000;

// Well above what 5 minutes of 32 kbps speech produces (~1.2 MB), under Workers AI's input cap.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const classQuery = z.object({ classId: z.uuid() });
const noteParam = z.object({ noteId: z.uuid() });
const noteStudentParam = z.object({ noteId: z.uuid(), studentId: z.uuid() });
const mentionParam = z.object({ noteId: z.uuid(), mentionId: z.uuid() });
const quotes = z.array(z.string().trim().min(1).max(2000)).max(50);

const createNote = z.object({
  classId: z.uuid(),
  body: z.string().trim().min(1, "body is required").max(MAX_BODY_CHARS, "body is too long"),
  // When the observation happened; defaults to now. Re-serialized so every stored
  // value has the same shape and ORDER BY noted_at sorts chronologically. Bounded so a
  // typo like 9999-… cannot sit at the top of the list for the rest of the term.
  notedAt: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString())
    .refine((s) => Date.parse(s) <= Date.now() + ONE_DAY_MS, "notedAt is in the future")
    .optional(),
});
const addStudent = z.object({ studentId: z.uuid(), quotes: quotes.optional() });
const assignMention = z.object({ studentId: z.uuid() });

// Composite keys of the two tag tables.
const tagKey = (noteId: string, studentId: string) =>
  and(eq(schema.noteStudents.noteId, noteId), eq(schema.noteStudents.studentId, studentId));
const mentionKey = (noteId: string, mentionId: string) =>
  and(eq(schema.noteMentions.id, mentionId), eq(schema.noteMentions.noteId, noteId));

// Single write path for every note kind, so rows always get the same id/timestamp shape.
function insertNote(db: Db, values: { classId: string; kind: schema.NoteKind; body: string; notedAt?: string }) {
  const now = new Date().toISOString();
  return db
    .insert(schema.notes)
    .values({ id: crypto.randomUUID(), ...values, notedAt: values.notedAt ?? now, createdAt: now })
    .returning()
    .get();
}

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
async function attachTags(db: Db, where: SQL, rows: Note[]): Promise<NoteWithTags[]> {
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
  for (const { row } of students) byId.get(row.noteId)?.students.push({ studentId: row.studentId, confirmed: row.confirmed, quotes: row.quotes });
  for (const { row } of mentions) {
    byId.get(row.noteId)?.mentions.push({ id: row.id, mentionText: row.mentionText, quotes: row.quotes, candidateIds: row.candidateIds });
  }
  return [...byId.values()];
}

const withTags = async (db: Db, note: Note) => (await attachTags(db, eq(schema.notes.id, note.id), [note]))[0]!;

// The statement that puts a student on a note: a new row, or new quotes folded into the one
// that exists. Confirmed rows are never downgraded; `confirm` only ever raises the flag.
function tagStatement(db: Db, existing: NoteStudent | undefined, noteId: string, studentId: string, quotes: string[], confirm: boolean) {
  if (!existing) {
    return db.insert(schema.noteStudents).values({ noteId, studentId, confirmed: confirm ? 1 : 0, quotes });
  }
  return db
    .update(schema.noteStudents)
    .set({ confirmed: confirm ? 1 : existing.confirmed, quotes: union(existing.quotes, quotes) })
    .where(tagKey(noteId, studentId));
}

const existingTag = (db: Db, noteId: string, studentId: string) =>
  db.select().from(schema.noteStudents).where(tagKey(noteId, studentId)).get();

// Ask the model which students the note is about. null when it could not be asked or did
// not answer usably; the caller decides what that means for existing rows.
async function suggestTags(db: Db, apiKey: string | undefined, note: Note): Promise<TagResult | null> {
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY is not set; note saved without tags", note.id);
    return null;
  }
  const roster = await selectRoster(db, note.classId);
  try {
    return await tagNote({ body: note.body, roster, client: new Anthropic({ apiKey }) });
  } catch (err) {
    console.error("tagging failed for note", note.id, err);
    return null;
  }
}

// Swap the note's unconfirmed suggestions and open mentions for the model's latest, in one
// atomic batch. Confirmed rows survive and only gain quotes. On a fresh note there is nothing
// to swap out, so create and retag are the same operation.
async function storeTags(db: Db, note: Note, result: TagResult) {
  const confirmed = await db
    .select()
    .from(schema.noteStudents)
    .where(and(eq(schema.noteStudents.noteId, note.id), eq(schema.noteStudents.confirmed, 1)));
  const confirmedById = new Map(confirmed.map((r) => [r.studentId, r]));
  const now = new Date().toISOString();
  await db.batch([
    db.delete(schema.noteStudents).where(and(eq(schema.noteStudents.noteId, note.id), eq(schema.noteStudents.confirmed, 0))),
    db.delete(schema.noteMentions).where(eq(schema.noteMentions.noteId, note.id)),
    ...result.students.map((s) => tagStatement(db, confirmedById.get(s.studentId), note.id, s.studentId, s.quotes, false)),
    ...result.mentions.map((m) =>
      db.insert(schema.noteMentions).values({
        id: crypto.randomUUID(),
        noteId: note.id,
        mentionText: m.mentionText,
        quotes: m.quotes,
        candidateIds: m.candidateIds,
        createdAt: now,
      }),
    ),
  ]);
}

// Suggest and store. "failed" means the note's tags are untouched: either the model could not
// be asked, or the rows could not be written (logged; the note itself is already saved).
async function runTagging(db: Db, apiKey: string | undefined, note: Note): Promise<TaggedNoteResponse> {
  const result = await suggestTags(db, apiKey, note);
  let tagging: TaggingStatus = "failed";
  if (result) {
    try {
      await storeTags(db, note, result);
      tagging = "done";
    } catch (err) {
      console.error("storing tags failed for note", note.id, err);
    }
  }
  return { ...(await withTags(db, note)), tagging };
}

const notes = new Hono<AppEnv>();

// GET /api/notes?classId=… → newest first, each with its students and open mentions
notes.get("/", validate("query", classQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, classId);
  const inClass = eq(schema.notes.classId, classId);
  const rows = await c.var.db
    .select()
    .from(schema.notes)
    .where(inClass)
    .orderBy(desc(schema.notes.notedAt), desc(schema.notes.createdAt));
  return c.json(await attachTags(c.var.db, inClass, rows));
});

// POST /api/notes { classId, body, notedAt? } → 201 with the stored note, its tags, and
// whether tagging ran: { ...note, students, mentions, tagging: "done" | "failed" }
notes.post("/", validate("json", createNote), async (c) => {
  const { classId, body, notedAt } = c.req.valid("json");
  await requireClass(c.var.db, classId);
  const note = await insertNote(c.var.db, { classId, kind: "text", body, notedAt });
  return c.json(await runTagging(c.var.db, c.env.ANTHROPIC_API_KEY, note), 201);
});

// Rejects on a declared content-length over the cap, otherwise stops reading the body as
// soon as it passes the cap, so an oversized upload is never fully buffered.
const audioLimit = bodyLimit({
  maxSize: MAX_AUDIO_BYTES,
  onError: () => {
    throw new HTTPException(413, { message: "recording is too large" });
  },
});

// POST /api/notes/voice?classId=… with a raw audio body → transcribes, stores a voice note,
// and tags it, all in one request; 201 with the same shape as a text note. notedAt is the
// save time: a clip is at most five minutes long, so the gap from when the teacher started
// talking is not worth a browser-supplied timestamp.
notes.post("/voice", validate("query", classQuery), audioLimit, async (c) => {
  const { classId } = c.req.valid("query");

  // The audio is never stored or served back, so any audio/* type is fine to hand to
  // Whisper; the check only turns a wrong upload into a clear error.
  const mediaType = (c.req.header("content-type") ?? "").trim().toLowerCase();
  if (!mediaType.startsWith("audio/")) throw new HTTPException(400, { message: "unsupported audio type" });

  await requireClass(c.var.db, classId);
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

// POST /api/notes/:noteId/retag → tag again. On success the unconfirmed suggestions and open
// mentions are replaced; a failed call leaves what was there, so a retry during an outage
// never strips a note.
notes.post("/:noteId/retag", validate("param", noteParam), async (c) => {
  const note = await requireNote(c.var.db, c.req.valid("param").noteId);
  return c.json(await runTagging(c.var.db, c.env.ANTHROPIC_API_KEY, note));
});

// POST /api/notes/:noteId/students { studentId, quotes? } → the teacher adds a student the
// model missed. Written as confirmed; 201 with the note.
notes.post("/:noteId/students", validate("param", noteParam), validate("json", addStudent), async (c) => {
  const note = await requireNote(c.var.db, c.req.valid("param").noteId);
  const { studentId, quotes } = c.req.valid("json");
  await requireClassmate(c.var.db, note, studentId);
  const existing = await existingTag(c.var.db, note.id, studentId);
  await tagStatement(c.var.db, existing, note.id, studentId, verifyQuotes(note.body, quotes), true);
  return c.json(await withTags(c.var.db, note), 201);
});

// POST /api/notes/:noteId/students/:studentId/confirm → the teacher approves a suggestion
notes.post("/:noteId/students/:studentId/confirm", validate("param", noteStudentParam), async (c) => {
  const { noteId, studentId } = c.req.valid("param");
  const note = await requireNote(c.var.db, noteId);
  const updated = await c.var.db.update(schema.noteStudents).set({ confirmed: 1 }).where(tagKey(noteId, studentId)).returning().get();
  if (!updated) throw new HTTPException(404, { message: "tag not found" });
  return c.json(await withTags(c.var.db, note));
});

// DELETE /api/notes/:noteId/students/:studentId → remove a tag, suggested or confirmed
notes.delete("/:noteId/students/:studentId", validate("param", noteStudentParam), async (c) => {
  const { noteId, studentId } = c.req.valid("param");
  await requireNote(c.var.db, noteId);
  const deleted = await c.var.db.delete(schema.noteStudents).where(tagKey(noteId, studentId)).returning().get();
  if (!deleted) throw new HTTPException(404, { message: "tag not found" });
  return c.body(null, 204);
});

// POST /api/notes/:noteId/mentions/:mentionId/assign { studentId } → the teacher says who an
// unresolved name meant. The mention's quotes move to a confirmed tag and the mention closes.
notes.post(
  "/:noteId/mentions/:mentionId/assign",
  validate("param", mentionParam),
  validate("json", assignMention),
  async (c) => {
    const { noteId, mentionId } = c.req.valid("param");
    const { studentId } = c.req.valid("json");
    const note = await requireNote(c.var.db, noteId);
    const mention = await c.var.db.select().from(schema.noteMentions).where(mentionKey(noteId, mentionId)).get();
    if (!mention) throw new HTTPException(404, { message: "mention not found" });
    await requireClassmate(c.var.db, note, studentId);
    const existing = await existingTag(c.var.db, noteId, studentId);
    await c.var.db.batch([
      tagStatement(c.var.db, existing, noteId, studentId, mention.quotes, true),
      c.var.db.delete(schema.noteMentions).where(mentionKey(noteId, mentionId)),
    ]);
    return c.json(await withTags(c.var.db, note));
  },
);

// DELETE /api/notes/:noteId/mentions/:mentionId → the name was nobody on the roster
notes.delete("/:noteId/mentions/:mentionId", validate("param", mentionParam), async (c) => {
  const { noteId, mentionId } = c.req.valid("param");
  await requireNote(c.var.db, noteId);
  const deleted = await c.var.db.delete(schema.noteMentions).where(mentionKey(noteId, mentionId)).returning().get();
  if (!deleted) throw new HTTPException(404, { message: "mention not found" });
  return c.body(null, 204);
});

export default notes;
