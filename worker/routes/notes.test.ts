import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { getPlatformProxy, unstable_splitSqlQuery as splitSql } from "wrangler";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import app from "../index";
import type { Note } from "../db/schema";
import seed from "../../scripts/seed-dev.sql?raw";

// Real D1 (Miniflare, in memory) built from the committed migrations plus the dev seed,
// so these tests exercise the actual schema and SQL rather than a mock.
const CLASS_ID = "11111111-1111-4111-8111-111111111111";
const UNKNOWN_CLASS_ID = "99999999-9999-4999-8999-999999999999";

let env: Env;
let dispose = async () => {};

beforeAll(async () => {
  // remoteBindings: false keeps the AI binding from dialing Cloudflare; voice tests swap it
  // for a fake anyway, so Whisper is never called and the suite runs offline.
  const proxy = await getPlatformProxy<Env>({ persist: false, remoteBindings: false });
  env = proxy.env;
  dispose = proxy.dispose;
  await migrate(drizzle(env.DB), { migrationsFolder: "drizzle" });
  // Same splitter `wrangler d1 execute --file` uses, so the seed file has one loader contract.
  await env.DB.batch(splitSql(seed).map((s) => env.DB.prepare(s)));
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM notes").run();
});

afterAll(() => dispose());

function getNotes(classId: string) {
  return app.request(`/api/notes?classId=${classId}`, {}, env);
}

// A string body is sent verbatim so tests can post malformed JSON.
function postNote(body: unknown) {
  return app.request(
    "/api/notes",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );
}

// Voice notes: the AI binding is replaced with a fake that returns `text`, or throws.
function fakeAi(text: string | Error) {
  return {
    run: vi.fn(async () => {
      if (text instanceof Error) throw text;
      return { text };
    }),
  };
}

function postVoice(
  classId: string,
  audio: BodyInit,
  opts: { ai?: ReturnType<typeof fakeAi>; type?: string; headers?: Record<string, string> } = {},
) {
  const ai = opts.ai ?? fakeAi("Transcribed.");
  return app.request(
    `/api/notes/voice?classId=${classId}`,
    { method: "POST", headers: { "content-type": opts.type ?? "audio/webm;codecs=opus", ...opts.headers }, body: audio },
    { ...env, AI: ai as unknown as Ai },
  );
}

test("GET /api/notes requires a uuid classId", async () => {
  expect((await app.request("/api/notes", {}, env)).status).toBe(400);
  expect((await getNotes("not-a-uuid")).status).toBe(400);
});

test("GET /api/notes returns 404 for an unknown class", async () => {
  expect((await getNotes(UNKNOWN_CLASS_ID)).status).toBe(404);
});

test("GET /api/notes returns an empty list for the seeded class", async () => {
  const res = await getNotes(CLASS_ID);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /api/notes stores a text note and GET lists it newest first", async () => {
  const first = await postNote({ classId: CLASS_ID, body: "Older note", notedAt: "2026-10-01T09:00:00Z" });
  expect(first.status).toBe(201);
  expect(((await first.json()) as Note).notedAt).toBe("2026-10-01T09:00:00.000Z");

  const second = await postNote({ classId: CLASS_ID, body: "  Newer note  " });
  expect(second.status).toBe(201);
  const created = (await second.json()) as Note;
  expect(created).toMatchObject({ classId: CLASS_ID, kind: "text", body: "Newer note" });
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

  const list = (await (await getNotes(CLASS_ID)).json()) as Note[];
  expect(list.map((n) => n.body)).toEqual(["Newer note", "Older note"]);
});

test("POST /api/notes rejects an empty body with a message", async () => {
  const res = await postNote({ classId: CLASS_ID, body: "   " });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is required" });
});

test("POST /api/notes rejects a body over 50,000 characters", async () => {
  expect((await postNote({ classId: CLASS_ID, body: "x".repeat(50_000) })).status).toBe(201);
  const res = await postNote({ classId: CLASS_ID, body: "x".repeat(50_001) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "body is too long" });
});

test("POST /api/notes rejects a notedAt more than a day in the future", async () => {
  const res = await postNote({ classId: CLASS_ID, body: "x", notedAt: "9999-12-31T00:00:00Z" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "notedAt is in the future" });
});

test("POST /api/notes rejects malformed JSON", async () => {
  const res = await postNote("{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
});

test("POST /api/notes returns 404 for an unknown class", async () => {
  expect((await postNote({ classId: UNKNOWN_CLASS_ID, body: "x" })).status).toBe(404);
});

test("POST /api/notes/voice transcribes the audio and stores a voice note", async () => {
  const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
  const ai = fakeAi("  Maya finished the lab early.  ");
  const res = await postVoice(CLASS_ID, bytes, { ai });
  expect(res.status).toBe(201);
  const created = (await res.json()) as Note;
  expect(created).toMatchObject({ classId: CLASS_ID, kind: "voice", body: "Maya finished the lab early.", audioKey: null });

  // Whisper got the right model and the exact bytes, base64-encoded.
  expect(ai.run).toHaveBeenCalledTimes(1);
  const [model, input] = ai.run.mock.calls[0] as unknown as [string, { audio: string }];
  expect(model).toBe("@cf/openai/whisper-large-v3-turbo");
  expect(Uint8Array.fromBase64(input.audio)).toEqual(bytes);

  const list = (await (await getNotes(CLASS_ID)).json()) as Note[];
  expect(list.map((n) => n.kind)).toEqual(["voice"]);
});

test("POST /api/notes/voice accepts Safari's audio/mp4", async () => {
  const res = await postVoice(CLASS_ID, new Uint8Array([1]), { type: "audio/mp4" });
  expect(res.status).toBe(201);
});

test("POST /api/notes/voice rejects an empty transcript and writes nothing", async () => {
  const res = await postVoice(CLASS_ID, new Uint8Array([1]), { ai: fakeAi("   ") });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "nothing was heard" });
  expect(await (await getNotes(CLASS_ID)).json()).toEqual([]);
});

test("POST /api/notes/voice rejects an over-long transcript and writes nothing", async () => {
  const res = await postVoice(CLASS_ID, new Uint8Array([1]), { ai: fakeAi("x".repeat(50_001)) });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "transcript is too long" });
  expect(await (await getNotes(CLASS_ID)).json()).toEqual([]);
});

test("POST /api/notes/voice rejects an empty body without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(CLASS_ID, new Uint8Array(0), { ai });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "nothing was heard" });
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice rejects a non-audio content type", async () => {
  const res = await postVoice(CLASS_ID, "hello", { type: "text/plain" });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "unsupported audio type" });
});

test("POST /api/notes/voice rejects an oversized recording", async () => {
  const ai = fakeAi("x");
  const tooBig = new Uint8Array(10 * 1024 * 1024 + 1);
  const res = await postVoice(CLASS_ID, tooBig, { ai });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "recording is too large" });
  expect(ai.run).not.toHaveBeenCalled();

  // A lying content-length is caught before the body is read.
  const declared = await postVoice(CLASS_ID, new Uint8Array([1]), { ai, headers: { "content-length": "99999999" } });
  expect(declared.status).toBe(413);
});

test("POST /api/notes/voice returns 404 for an unknown class without calling Whisper", async () => {
  const ai = fakeAi("x");
  const res = await postVoice(UNKNOWN_CLASS_ID, new Uint8Array([1]), { ai });
  expect(res.status).toBe(404);
  expect(ai.run).not.toHaveBeenCalled();
});

test("POST /api/notes/voice returns 502 when Whisper fails and writes nothing", async () => {
  const res = await postVoice(CLASS_ID, new Uint8Array([1]), { ai: fakeAi(new Error("model unavailable")) });
  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "transcription failed" });
  expect(await (await getNotes(CLASS_ID)).json()).toEqual([]);
});
