// Notes: what the teacher captured. Text notes arrive as JSON; voice notes arrive as raw
// audio, are transcribed, and are stored as the transcript (the audio is discarded).
// AI tagging arrives later and plugs into the same table.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import type { AppEnv, Db } from "../db/client";
import { validate } from "../validate";
import { transcribe } from "../transcribe";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Shared by text and voice notes. A backstop, not a product limit: a five-minute clip
// transcribes to roughly 5,000 characters. See DECISIONS.md.
const MAX_BODY_CHARS = 50_000;

// Well above what 5 minutes of 32 kbps speech produces (~1.2 MB), under Workers AI's input cap.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const classQuery = z.object({ classId: z.uuid() });

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

async function requireClass(db: Db, classId: string) {
  const row = await db.select({ id: schema.classes.id }).from(schema.classes).where(eq(schema.classes.id, classId)).get();
  if (!row) throw new HTTPException(404, { message: "class not found" });
}

// Single write path for every note kind, so rows always get the same id/timestamp shape.
function insertNote(db: Db, values: { classId: string; kind: schema.NoteKind; body: string; notedAt?: string }) {
  const now = new Date().toISOString();
  return db
    .insert(schema.notes)
    .values({ id: crypto.randomUUID(), ...values, notedAt: values.notedAt ?? now, createdAt: now })
    .returning()
    .get();
}

const notes = new Hono<AppEnv>();

// GET /api/notes?classId=… → newest first
notes.get("/", validate("query", classQuery), async (c) => {
  const { classId } = c.req.valid("query");
  await requireClass(c.var.db, classId);
  const rows = await c.var.db
    .select()
    .from(schema.notes)
    .where(eq(schema.notes.classId, classId))
    .orderBy(desc(schema.notes.notedAt), desc(schema.notes.createdAt));
  return c.json(rows);
});

// POST /api/notes { classId, body, notedAt? } → 201 with the stored row
notes.post("/", validate("json", createNote), async (c) => {
  const { classId, body, notedAt } = c.req.valid("json");
  await requireClass(c.var.db, classId);
  const row = await insertNote(c.var.db, { classId, kind: "text", body, notedAt });
  return c.json(row, 201);
});

// Rejects on a declared content-length over the cap, otherwise stops reading the body as
// soon as it passes the cap, so an oversized upload is never fully buffered.
const audioLimit = bodyLimit({
  maxSize: MAX_AUDIO_BYTES,
  onError: () => {
    throw new HTTPException(413, { message: "recording is too large" });
  },
});

// POST /api/notes/voice?classId=… with a raw audio body → transcribes and stores a voice
// note in one request, 201 with the stored row. notedAt is the save time: a clip is at most
// five minutes long, so the gap from when the teacher started talking is not worth a
// browser-supplied timestamp.
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

  const row = await insertNote(c.var.db, { classId, kind: "voice", body: text });
  return c.json(row, 201);
});

export default notes;
