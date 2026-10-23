import { expect, test, vi } from "vitest";
import app from "../index";
import type { Note } from "../db/schema";
import { SEED_CLASS_ID, UNKNOWN_ID, jsonInit, setupTestDb } from "../test-db";

const db = setupTestDb();

const getNotes = (classId: string) => db.request(`/api/notes?classId=${classId}`);
const postNote = (body: unknown) => db.request("/api/notes", jsonInit("POST", body));
const listNotes = () => db.json<Note[]>(`/api/notes?classId=${SEED_CLASS_ID}`);

// Voice notes: the AI binding is replaced with a fake that returns `text`, or throws.
function fakeAi(text: string | Error) {
  return {
    run: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return { text };
    }),
  };
}

// Goes through app.request directly because the env needs the fake AI swapped in.
function postVoice(
  classId: string,
  audio: BodyInit,
  opts: { ai?: ReturnType<typeof fakeAi>; type?: string; headers?: Record<string, string> } = {},
) {
  const ai = opts.ai ?? fakeAi("Transcribed.");
  return app.request(
    `/api/notes/voice?classId=${classId}`,
    { method: "POST", headers: { "content-type": opts.type ?? "audio/webm;codecs=opus", ...opts.headers }, body: audio },
    { ...db.env, AI: ai as unknown as Ai },
  );
}

test("GET /api/notes requires a uuid classId", async () => {
  expect((await db.request("/api/notes")).status).toBe(400);
  expect((await getNotes("not-a-uuid")).status).toBe(400);
});

test("GET /api/notes returns 404 for an unknown class", async () => {
  expect((await getNotes(UNKNOWN_ID)).status).toBe(404);
});

test("GET /api/notes returns an empty list for the seeded class", async () => {
  const res = await getNotes(SEED_CLASS_ID);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /api/notes stores a text note and GET lists it newest first", async () => {
  const first = await postNote({ classId: SEED_CLASS_ID, body: "Older note", notedAt: "2026-10-01T09:00:00Z" });
  expect(first.status).toBe(201);
  expect(((await first.json()) as Note).notedAt).toBe("2026-10-01T09:00:00.000Z");

  const second = await postNote({ classId: SEED_CLASS_ID, body: "  Newer note  " });
  expect(second.status).toBe(201);
  const created = (await second.json()) as Note;
  expect(created).toMatchObject({ classId: SEED_CLASS_ID, kind: "text", body: "Newer note" });
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

  expect((await listNotes()).map((n) => n.body)).toEqual(["Newer note", "Older note"]);
});

test("POST /api/notes rejects an empty body with a message", async () => {
  const res = await postNote({ classId: SEED_CLASS_ID, body: "   " });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is required" });
});

test("POST /api/notes rejects a body over 50,000 characters", async () => {
  expect((await postNote({ classId: SEED_CLASS_ID, body: "x".repeat(50_000) })).status).toBe(201);
  const res = await postNote({ classId: SEED_CLASS_ID, body: "x".repeat(50_001) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is too long" });
});

test("POST /api/notes rejects a notedAt more than a day in the future", async () => {
  const res = await postNote({ classId: SEED_CLASS_ID, body: "x", notedAt: "9999-12-31T00:00:00Z" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "notedAt is in the future" });
});

test("POST /api/notes rejects malformed JSON", async () => {
  const res = await postNote("{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
});

test("POST /api/notes returns 404 for an unknown class", async () => {
  expect((await postNote({ classId: UNKNOWN_ID, body: "x" })).status).toBe(404);
});

test("POST /api/notes/voice transcribes the audio and stores a voice note", async () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
  const ai = fakeAi("  Maya finished the lab early.  ");
  const res = await postVoice(SEED_CLASS_ID, bytes, { ai });
  expect(res.status).toBe(201);
  const created = (await res.json()) as Note;
  expect(created).toMatchObject({ classId: SEED_CLASS_ID, kind: "voice", body: "Maya finished the lab early.", audioKey: null });

  // Whisper got the right model and the exact bytes, base64-encoded.
  expect(ai.run).toHaveBeenCalledTimes(1);
  const [model, input] = ai.run.mock.calls[0] as unknown as [string, { audio: string }];
  expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
  expect(Uint8Array.fromBase64(input.audio)).toEqual(bytes);

  expect((await listNotes()).map((n) => n.kind)).toEqual(["voice"]);
});

test("POST /api/notes/voice accepts Safari's audio/mp4", async () => {
  const res = await postVoice(SEED_CLASS_ID, new Uint8Array([1]), { type: "audio/mp4" });
  expect(res.status).toBe(201);
});

test("POST /api/notes/voice rejects an empty transcript and writes nothing", async () => {
  const res = await postVoice(SEED_CLASS_ID, new Uint8Array([1]), { ai: fakeAi("   ") });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "nothing was heard" });
  expect(await listNotes()).toEqual([]);
});

test("POST /api/notes/voice rejects an over-long transcript and writes nothing", async () => {
  const res = await postVoice(SEED_CLASS_ID, new Uint8Array([1]), { ai: fakeAi("x".repeat(50_001)) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "transcript is too long" });
  expect(await listNotes()).toEqual([]);
});

test("POST /api/notes/voice rejects an empty body without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(SEED_CLASS_ID, new Uint8Array(0), { ai });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "nothing was heard" });
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice rejects a non-audio content type", async () => {
  const res = await postVoice(SEED_CLASS_ID, "hello", { type: "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "unsupported audio type" });
});

test("POST /api/notes/voice rejects an oversized recording", async () => {
  const ai = fakeAi("x");
  const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
  const res = await postVoice(SEED_CLASS_ID, tooBig, { ai });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "recording is too large" });
  expect(ai.run).not.toHaveBeenCalled();

  // A lying content-length is caught before the body is read.
  const declared = await postVoice(SEED_CLASS_ID, new Uint8Array([1]), { ai, headers: { "content-length": "99999999" } });
  expect(declared.status).toBe(413);
});

test("POST /api/notes/voice returns 404 for an unknown class without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(UNKNOWN_ID, new Uint8Array([1]), { ai });
  expect(res.status).toBe(404);
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice returns 502 when Whisper fails and writes nothing", async () => {
  const res = await postVoice(SEED_CLASS_ID, new Uint8Array([1]), { ai: fakeAi(new Error("model unavailable")) });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "transcription failed" });
  expect(await listNotes()).toEqual([]);
});
